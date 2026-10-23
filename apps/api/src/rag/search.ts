// Hybrid retrieval: vector similarity + Postgres full-text, merged
// with Reciprocal Rank Fusion. Full-text catches exact tokens like "GP26" or
// "ADC_VREF" that embeddings blur; vectors catch paraphrases ("analog input").
// If the embedding model is down, search degrades to full-text only.

import type pg from "pg";
import { getBoard } from "@breadpilot/circuit-core";
import { toVectorLiteral, type Embedder } from "./embed";

export interface SearchHit {
  chunkId: number;
  content: string;
  section: string | null;
  page: number | null;
  kind: string;
  document: { title: string; path: string; board: string };
  score: number;
  /** Rank in each retriever (1-based), for debugging. */
  ranks: { vector?: number; fulltext?: number };
  /** Cosine similarity to the query (vector hits only). RRF scores only order hits; use this to judge relevance. */
  similarity?: number;
  citation: string;
}

export interface SearchResult {
  mode: "hybrid" | "fulltext";
  hits: SearchHit[];
  warning?: string;
}

interface Row {
  id: number;
  distance?: number;
  content: string;
  section: string | null;
  page: number | null;
  kind: string;
  title: string;
  path: string;
  board: string;
}

const RRF_K = 60;
const CANDIDATES = 20;

/** Reciprocal Rank Fusion over ranked id lists. */
export function rrf(lists: { name: "vector" | "fulltext"; ids: number[] }[]): { id: number; score: number; ranks: SearchHit["ranks"] }[] {
  const acc = new Map<number, { score: number; ranks: SearchHit["ranks"] }>();
  for (const list of lists) {
    list.ids.forEach((id, i) => {
      const e = acc.get(id) ?? { score: 0, ranks: {} };
      e.score += 1 / (RRF_K + i + 1);
      e.ranks[list.name] = i + 1;
      acc.set(id, e);
    });
  }
  return [...acc].map(([id, e]) => ({ id, ...e })).sort((a, b) => b.score - a.score || a.id - b.id);
}

export function citationOf(r: { title: string; page: number | null; section: string | null }): string {
  return [r.title, r.page ? `p.${r.page}` : null, r.section].filter(Boolean).join(", ");
}

const COLUMNS = "c.id, c.content, c.section, c.page, c.kind, d.title, d.path, d.board";

/** Full-text with OR semantics: any matching (stemmed) word counts, ranked by cover density. */
export const FULLTEXT_SQL = `WITH query AS (SELECT replace(plainto_tsquery('english', $1)::text, '&', '|')::tsquery AS q)
  SELECT ${COLUMNS}
  FROM chunks c JOIN documents d ON d.id = c.document_id CROSS JOIN query
  WHERE ($2::text IS NULL OR d.board = $2) AND c.tsv @@ query.q
  ORDER BY ts_rank_cd(c.tsv, query.q) DESC, c.id
  LIMIT $3`;

/** Nearest chunks by cosine distance ($1 is a pgvector literal). */
export const VECTOR_SQL = `SELECT ${COLUMNS}, c.embedding <=> $1::vector AS distance
  FROM chunks c JOIN documents d ON d.id = c.document_id
  WHERE ($2::text IS NULL OR d.board = $2) AND c.embedding IS NOT NULL
  ORDER BY c.embedding <=> $1::vector, c.id
  LIMIT $3`;

export async function hybridSearch(
  pool: pg.Pool,
  embedder: Embedder | null,
  query: string,
  opts: { board?: string; k?: number } = {},
): Promise<SearchResult> {
  const k = opts.k ?? 5;
  // Variants (pico-2-wh) share the canonical board's documents (pico-2-w).
  const board = opts.board ? (getBoard(opts.board)?.id ?? opts.board) : null;
  const rows = new Map<number, Row>();

  const fts = await pool.query<Row>(FULLTEXT_SQL, [query, board, CANDIDATES]);
  fts.rows.forEach((r) => rows.set(r.id, r));

  let vectorIds: number[] = [];
  let warning: string | undefined;
  if (embedder) {
    try {
      const v = await embedder.query(query);
      const vec = await pool.query<Row>(VECTOR_SQL, [toVectorLiteral(v), board, CANDIDATES]);
      vec.rows.forEach((r) => rows.set(r.id, { ...r, distance: Number(r.distance) }));
      vectorIds = vec.rows.map((r) => r.id);
    } catch (err) {
      warning = `Vector search unavailable (${(err as Error).message}); using full-text only.`;
    }
  }

  const merged = rrf([
    { name: "vector", ids: vectorIds },
    { name: "fulltext", ids: fts.rows.map((r) => r.id) },
  ]).slice(0, k);

  return {
    mode: vectorIds.length ? "hybrid" : "fulltext",
    hits: merged.map((m) => {
      const r = rows.get(m.id)!;
      return {
        chunkId: r.id,
        content: r.content,
        section: r.section,
        page: r.page,
        kind: r.kind,
        document: { title: r.title, path: r.path, board: r.board },
        score: Number(m.score.toFixed(5)),
        ranks: m.ranks,
        ...(r.distance !== undefined ? { similarity: Number((1 - r.distance).toFixed(4)) } : {}),
        citation: citationOf(r),
      };
    }),
    ...(warning ? { warning } : {}),
  };
}
