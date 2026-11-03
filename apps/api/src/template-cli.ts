// Builds the desktop app's ready-made database (D7): a brand-new PGlite with the migrations applied
// and the documentation indexed with the real search model, so a first start is instant and has
// full documentation search. Built in memory from scratch, never from anyone's data folder; it is
// refused unless it holds documentation only (no projects, no messages, only the known tables). It
// doesn't read .env: it needs no key, only the local search model at its default address.
//
//   npm run template -w @breadpilot/api                 (needs Ollama with nomic-embed-text)
//   npm run template -w @breadpilot/api -- --allow-text-only   (keyword search only; not for releases)

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { loadConfig } from "./config";
import { migrate } from "./db";
import { createPglite, pgliteDb } from "./pglite";
import { openAiEmbedder } from "./rag/embed";
import { ingestAll } from "./rag/ingest";

const OUT = resolve(process.cwd(), "../desktop/build/template.tar.gz");
/** The only tables a template may have (from db/migrations); a new migration adds its tables here. */
const TABLES = ["chunks", "components", "documents", "project_messages", "projects", "schema_migrations"];

const config = loadConfig();
const allowTextOnly = process.argv.includes("--allow-text-only");

const pg = await createPglite();
const db = pgliteDb(pg);
try {
  await migrate(db, config.MIGRATIONS_DIR, (m) => console.log(m));
  const report = await ingestAll({
    db,
    embedder: openAiEmbedder(config.LLM_BASE_URL, config.EMBED_MODEL),
    repoDir: config.REPO_DIR,
    embedModel: config.EMBED_MODEL,
    force: true,
    log: (m) => console.log(m),
  });
  if (report.failed.length) throw new Error(`documents failed: ${report.failed.map((f) => f.path).join(", ")}`);
  if (report.textOnly.length && !allowTextOnly) {
    throw new Error(`the search model (${config.EMBED_MODEL} at ${config.LLM_BASE_URL}) wasn't reachable, so ${report.textOnly.length} documents have no vectors. Start Ollama with ${config.EMBED_MODEL}, or pass --allow-text-only for a test build.`);
  }

  // Documentation only: nothing a user ever typed can be in here.
  const count = async (table: string) => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows[0]!.n;
  for (const table of ["projects", "project_messages", "components"]) {
    if ((await count(table)) !== 0) throw new Error(`refusing: table ${table} isn't empty`);
  }
  const tables = (await db.query<{ t: string }>("SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")).rows.map((r) => r.t);
  if (JSON.stringify(tables) !== JSON.stringify(TABLES)) throw new Error(`refusing: unexpected tables ${tables.join(", ")} (expected ${TABLES.join(", ")})`);
  const docs = await count("documents");
  const chunks = await count("chunks");
  const withVectors = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM chunks WHERE embedding IS NOT NULL")).rows[0]!.n;
  if (docs === 0 || chunks === 0) throw new Error("refusing: no documentation was indexed");
  // Asked of the database itself: long text is stored compressed, so a byte scan of the file could
  // miss a local path in it. Document paths are repo-relative; nothing may name this computer's folders.
  const local = [homedir(), `${sep}${userInfo().username}${sep}`];
  const named = (await db.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM documents d LEFT JOIN chunks c ON c.document_id = d.id WHERE d.path LIKE ANY($1) OR d.title LIKE ANY($1) OR c.content LIKE ANY($1) OR c.section LIKE ANY($1)",
    [local.map((s) => `%${s.replace(/[\\%_]/g, "\\$&")}%`)],
  )).rows[0]!.n;
  if (named !== 0) throw new Error("refusing: the documentation mentions this computer's folders");

  const dump = Buffer.from(await (await pg.dumpDataDir("gzip")).arrayBuffer());
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, dump);
  console.log(
    `template written: ${OUT}\n  ${docs} documents, ${chunks} chunks (${withVectors} with vectors from ${config.EMBED_MODEL}), 0 projects\n  ${(dump.length / 1048576).toFixed(1)} MB, sha256 ${createHash("sha256").update(dump).digest("hex")}`,
  );
} catch (err) {
  console.error(`template not written: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
