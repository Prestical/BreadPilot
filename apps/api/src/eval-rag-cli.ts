// Retrieval eval (Milestone 3 acceptance): each question's expected fact must be in the top 3.
//   docker compose exec api node dist/eval-rag-cli.js
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "./config";
import { createPool } from "./db";
import { openAiEmbedder } from "./rag/embed";
import { hybridSearch } from "./rag/search";
import { chunkCount } from "./rag/store";

interface Case {
  question: string;
  /** Any of these strings in a top-3 chunk counts as a hit (case-insensitive). */
  expect: string[];
}

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const TOP = 3;
try {
  const indexed = await chunkCount(pool);
  if (indexed === 0) {
    console.error("No documentation is indexed yet, so there is nothing to search.");
    console.error("Index now (shows progress or the exact error):  docker compose exec api node dist/ingest-cli.js");
    console.error("Or check the startup indexing log:              docker compose logs api | grep rag");
    process.exit(2);
  }
  console.log(`${indexed} chunks indexed\n`);
  const cases = (await readFile(join(config.REPO_DIR, "data/eval/rag.jsonl"), "utf8"))
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Case);
  const embedder = openAiEmbedder(config.LLM_BASE_URL, config.EMBED_MODEL);
  let hits = 0;
  for (const c of cases) {
    const res = await hybridSearch(pool, embedder, c.question, { board: "pico-2-w", k: TOP });
    const rank = res.hits.findIndex((h) => c.expect.some((e) => h.content.toLowerCase().includes(e.toLowerCase())));
    if (rank >= 0) hits++;
    console.log(`${rank >= 0 ? "✓" : "✗"} [${res.mode}] ${c.question}${rank >= 0 ? `  (rank ${rank + 1}: ${res.hits[rank]!.citation})` : `\n    top: ${res.hits.map((h) => h.citation).join(" | ")}`}`);
  }
  const pct = Math.round((hits / cases.length) * 100);
  console.log(`\nhit@${TOP}: ${hits}/${cases.length} (${pct}%)`);
  if (pct < 90) process.exitCode = 1;
} finally {
  await pool.end();
}
