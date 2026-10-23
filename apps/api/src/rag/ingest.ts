// Ingestion: docs/hardware/<board>/*.pdf and data/boards/<board>.pinout.generated.md
// → chunks → embeddings → Postgres. Idempotent: unchanged files (same content hash,
// chunker version and embedding model) are skipped, deleted files are removed.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";
import type pg from "pg";
import { getBoard } from "@breadpilot/circuit-core";
import { CHUNKER_VERSION, chunkMarkdown, chunkPages, type Chunk } from "./chunk";
import type { Embedder } from "./embed";
import { cleanPages, extractPdf, isImageOnly, parseToc } from "./extract";
import { documentHash, removeMissing, removePath, replaceDocument } from "./store";

export interface Source {
  /** Repo-relative path, used as the document key. */
  path: string;
  abs: string;
  board: string;
  title: string;
  kind: "pdf" | "markdown";
}

export interface IngestReport {
  indexed: { path: string; chunks: number }[];
  unchanged: string[];
  skipped: { path: string; reason: string }[];
  /** Documents that failed (e.g. corrupt PDF, embedding error). Other documents still run. */
  failed: { path: string; error: string }[];
  removed: string[];
}

const boardName = (id: string) => getBoard(id)?.name ?? id;
/** Board variants (pico-2-wh) are stored under their canonical id (pico-2-w). */
export const canonicalBoard = (id: string) => getBoard(id)?.id ?? id;

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

/** File names listed in a folder's `.ragignore` (one per line, # comments) are not indexed. */
async function ignored(dir: string): Promise<Set<string>> {
  try {
    const text = await readFile(join(dir, ".ragignore"), "utf8");
    return new Set(text.split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

export async function discoverSources(repoDir: string): Promise<Source[]> {
  const sources: Source[] = [];
  const hw = join(repoDir, "docs", "hardware");
  for (const board of (await listDir(hw)).sort()) {
    const dir = join(hw, board);
    const skip = await ignored(dir);
    for (const file of (await listDir(dir)).sort()) {
      if (!file.toLowerCase().endsWith(".pdf") || skip.has(file)) continue;
      const abs = join(dir, file);
      const topic = basename(file, ".pdf").replace(new RegExp(`^${board}-?`), "").replace(/[-_]+/g, " ").trim();
      // Board folders: "Raspberry Pi Pico 2 W datasheet"; part folders (e.g. components): "SH1106 datasheet".
      const title = getBoard(board) ? `${boardName(board)} ${topic || "document"}` : `${topic} datasheet`;
      sources.push({ path: relative(repoDir, abs), abs, board: canonicalBoard(board), title, kind: "pdf" });
    }
  }
  const boards = join(repoDir, "data", "boards");
  for (const file of (await listDir(boards)).sort()) {
    const m = /^(.+)\.pinout\.generated\.md$/.exec(file);
    if (!m) continue;
    const abs = join(boards, file);
    sources.push({ path: relative(repoDir, abs), abs, board: canonicalBoard(m[1]!), title: `${boardName(m[1]!)} pinout (verified data)`, kind: "markdown" });
  }
  return sources;
}

export async function chunkSource(source: Source): Promise<Chunk[] | { skip: string }> {
  if (source.kind === "markdown") return chunkMarkdown(await readFile(source.abs, "utf8"), source.title);
  const raw = await extractPdf(source.abs);
  const pages = cleanPages(raw);
  if (isImageOnly(pages)) return { skip: "image-only PDF (no extractable text); covered by the verified generated pinout" };
  return chunkPages(pages, parseToc(raw), source.title);
}

type IngestOptions = { pool: pg.Pool; embedder: Embedder; repoDir: string; embedModel: string; force?: boolean; log?: (msg: string) => void };

let running: Promise<IngestReport> | null = null;
let queuedForce: Promise<IngestReport> | null = null;

/**
 * Runs ingestion. Callers during a run share its result, except a forced run, which is
 * queued to start right after the current one (so `force` is never silently ignored).
 */
export function ingestAll(opts: IngestOptions): Promise<IngestReport> {
  if (!running) {
    running = run(opts).finally(() => {
      running = null;
    });
    return running;
  }
  if (!opts.force) return running;
  queuedForce ??= running
    .catch(() => undefined)
    .then(() => {
      queuedForce = null;
      return ingestAll(opts);
    });
  return queuedForce;
}

async function run({ pool, embedder, repoDir, embedModel, force = false, log = () => {} }: IngestOptions): Promise<IngestReport> {
  const report: IngestReport = { indexed: [], unchanged: [], skipped: [], failed: [], removed: [] };
  const sources = await discoverSources(repoDir);
  if (sources.length === 0) {
    // A missing docs/ folder (wrong REPO_DIR, broken build) must never wipe the index.
    log(`rag: no documents found under ${repoDir}; index left unchanged`);
    return report;
  }
  for (const src of sources) {
    try {
      const bytes = await readFile(src.abs);
      const hash = createHash("sha256").update(bytes).update(`|chunker:${CHUNKER_VERSION}|model:${embedModel}`).digest("hex");
      if (!force && (await documentHash(pool, src.path)) === hash) {
        report.unchanged.push(src.path);
        continue;
      }
      const chunks = await chunkSource(src);
      if (!Array.isArray(chunks)) {
        // Drop any older indexed version so stale text can't be retrieved.
        await removePath(pool, src.path);
        report.skipped.push({ path: src.path, reason: chunks.skip });
        log(`rag: skipped ${src.path}: ${chunks.skip}`);
        continue;
      }
      const vectors = await embedder.documents(chunks.map((c) => c.content));
      await replaceDocument(pool, { title: src.title, board: src.board, path: src.path, hash }, chunks.map((c, i) => ({ ...c, embedding: vectors[i]! })));
      report.indexed.push({ path: src.path, chunks: chunks.length });
      log(`rag: indexed ${src.path} (${chunks.length} chunks)`);
    } catch (err) {
      report.failed.push({ path: src.path, error: (err as Error).message });
      log(`rag: FAILED ${src.path}: ${(err as Error).message}`);
    }
  }
  report.removed = await removeMissing(pool, sources.map((s) => s.path));
  return report;
}
