import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createPool, migrate } from "./db";
import { dbCheck, errorMessage, openAiModelLister } from "./health";
import { openAiEmbedder } from "./rag/embed";
import { createRagService } from "./rag/service";
import { createLlm } from "./agent/llm";
import { pgStore } from "./agent/project";
import { progressBus } from "./agent/progress";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const embedder = openAiEmbedder(config.LLM_BASE_URL, config.EMBED_MODEL);
let log: (msg: string) => void = () => {};
const rag = createRagService({ pool, embedder, repoDir: config.REPO_DIR, embedModel: config.EMBED_MODEL, log: (m) => log(m) });

const llm = createLlm({
  api: config.LLM_API,
  baseUrl: config.LLM_BASE_URL,
  model: config.LLM_MODEL,
  numCtx: config.LLM_NUM_CTX,
  temperature: config.LLM_TEMPERATURE,
  timeoutMs: config.LLM_TIMEOUT_MS,
});

// OpenAI's model, offered next to the local one only when a key is set.
const cloudLlm = config.OPENAI_API_KEY.trim()
  ? createLlm({
      api: "openai",
      baseUrl: config.OPENAI_BASE_URL,
      model: config.OPENAI_MODEL,
      numCtx: config.LLM_NUM_CTX,
      temperature: config.LLM_TEMPERATURE,
      timeoutMs: config.OPENAI_TIMEOUT_MS,
      apiKey: config.OPENAI_API_KEY.trim(),
      reasoningEffort: config.OPENAI_REASONING_EFFORT,
    })
  : undefined;

const app = buildApp({
  logLevel: config.LOG_LEVEL,
  allowedHosts: config.ALLOWED_HOSTS,
  rag,
  agent: {
    llm,
    cloudLlm,
    store: pgStore(pool),
    progress: progressBus(),
    search: async (q) => (await rag.search(q, { board: "pico-2-w", k: 2 })).hits.map((h) => ({ content: h.content, citation: h.citation })),
    log: (m) => log(m),
  },
  health: {
    checkDb: dbCheck(pool),
    listModels: openAiModelLister(config.LLM_BASE_URL),
    llmModel: config.LLM_MODEL,
    embedModel: config.EMBED_MODEL,
    checkDocs: async () => {
      const n = await rag.chunkCount();
      return n > 0
        ? { status: "ok", detail: `${n} documentation chunks indexed` }
        : { status: "down", detail: "no documentation indexed yet (POST /api/rag/reindex once the embedding model is pulled)" };
    },
  },
});
log = (m) => app.log.info(m);

try {
  await migrate(pool, config.MIGRATIONS_DIR, (msg) => app.log.info(msg));
  await app.listen({ host: config.API_HOST, port: config.API_PORT });
} catch (err) {
  app.log.fatal({ err }, "startup failed");
  await pool.end().catch(() => {});
  process.exit(1);
}

// Index new or changed documentation in the background; unchanged files are skipped by hash.
// Ollama often starts after the API (or is still loading the model), so failures are retried.
if (config.RAG_AUTO_INGEST) {
  const RETRY_MS = 30_000;
  const MAX_ATTEMPTS = 10;
  const attempt = (n: number) => {
    rag
      .reindex(false)
      .then((r) => {
        const summary = { indexed: r.indexed.length, unchanged: r.unchanged.length, skipped: r.skipped.length, failed: r.failed.length, removed: r.removed.length };
        if (r.failed.length && n < MAX_ATTEMPTS) {
          app.log.warn(summary, `rag: startup ingest attempt ${n} had failures; retrying in ${RETRY_MS / 1000}s`);
          setTimeout(() => attempt(n + 1), RETRY_MS).unref();
        } else app.log.info(summary, "rag: startup ingest done");
      })
      .catch((err) => {
        if (n >= MAX_ATTEMPTS) return app.log.error(`rag: startup ingest gave up after ${n} attempts: ${errorMessage(err)}`);
        app.log.warn(`rag: startup ingest attempt ${n} failed (${errorMessage(err)}); retrying in ${RETRY_MS / 1000}s`);
        setTimeout(() => attempt(n + 1), RETRY_MS).unref();
      });
  };
  attempt(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
