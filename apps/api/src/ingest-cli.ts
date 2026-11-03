// Re-index documentation from the command line (development data in .local/data; stop
// npm run dev:api first, only one program can use the data folder):
//   npm run ingest -w @breadpilot/api [-- --force]
import { loadConfig } from "./config";
import { migrate } from "./db";
import { devKey, openDataDir } from "./datadir";
import { openAiEmbedder } from "./rag/embed";
import { ingestAll } from "./rag/ingest";

const config = loadConfig();
const data = await openDataDir({ dir: config.DATA_DIR, key: await devKey(config.DATA_DIR) });
const db = data.db;
try {
  await migrate(db, config.MIGRATIONS_DIR, console.log);
  const report = await ingestAll({
    db,
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
  await data.close();
}
