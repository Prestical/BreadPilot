// Re-index documentation from the command line:
//   docker compose exec api node dist/ingest-cli.js [--force]
import { loadConfig } from "./config";
import { createPool, migrate } from "./db";
import { openAiEmbedder } from "./rag/embed";
import { ingestAll } from "./rag/ingest";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
try {
  await migrate(pool, config.MIGRATIONS_DIR, console.log);
  const report = await ingestAll({
    pool,
    embedder: openAiEmbedder(config.LLM_BASE_URL, config.EMBED_MODEL),
    repoDir: config.REPO_DIR,
    embedModel: config.EMBED_MODEL,
    force: process.argv.includes("--force"),
    log: console.log,
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.failed.length) process.exitCode = 1;
} catch (err) {
  console.error(`ingest failed: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
