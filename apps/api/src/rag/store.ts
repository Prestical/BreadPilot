import type pg from "pg";
import type { Chunk } from "./chunk";
import { toVectorLiteral } from "./embed";

export interface DocumentRow {
  id: number;
  title: string;
  board: string;
  path: string;
  hash: string;
  ingestedAt: string;
  chunks: number;
}

export async function documentHash(pool: pg.Pool, path: string): Promise<string | null> {
  const { rows } = await pool.query<{ hash: string }>("SELECT hash FROM documents WHERE path = $1", [path]);
  return rows[0]?.hash ?? null;
}

/** Replaces a document and all its chunks in one transaction. */
export async function replaceDocument(
  pool: pg.Pool,
  doc: { title: string; board: string; path: string; hash: string },
  chunks: (Chunk & { embedding: number[] })[],
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ id: number }>(
      `INSERT INTO documents (title, board, path, hash, ingested_at) VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (path) DO UPDATE SET title = EXCLUDED.title, board = EXCLUDED.board, hash = EXCLUDED.hash, ingested_at = now()
       RETURNING id`,
      [doc.title, doc.board, doc.path, doc.hash],
    );
    const id = rows[0]!.id;
    await client.query("DELETE FROM chunks WHERE document_id = $1", [id]);
    for (const c of chunks) {
      await client.query(
        "INSERT INTO chunks (document_id, section, page, kind, content, embedding) VALUES ($1, $2, $3, $4, $5, $6::vector)",
        [id, c.section, c.page, c.kind, c.content, toVectorLiteral(c.embedding)],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function removePath(pool: pg.Pool, path: string): Promise<void> {
  await pool.query("DELETE FROM documents WHERE path = $1", [path]);
}

/** Removes documents whose files no longer exist. Returns removed paths. Refuses an empty keep-list. */
export async function removeMissing(pool: pg.Pool, keepPaths: string[]): Promise<string[]> {
  if (keepPaths.length === 0) throw new Error("removeMissing called with no paths; refusing to delete the whole index");
  const { rows } = await pool.query<{ path: string }>("DELETE FROM documents WHERE NOT (path = ANY($1::text[])) RETURNING path", [keepPaths]);
  return rows.map((r) => r.path);
}

export async function listDocuments(pool: pg.Pool): Promise<DocumentRow[]> {
  const { rows } = await pool.query<DocumentRow>(
    `SELECT d.id, d.title, d.board, d.path, d.hash, d.ingested_at AS "ingestedAt", count(c.id)::int AS chunks
     FROM documents d LEFT JOIN chunks c ON c.document_id = d.id
     GROUP BY d.id ORDER BY d.board, d.title`,
  );
  return rows;
}

export async function chunkCount(pool: pg.Pool): Promise<number> {
  const { rows } = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM chunks");
  return rows[0]?.n ?? 0;
}
