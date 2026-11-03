// Starts the API inside whatever runs it: the development server (server.ts) or the desktop app
// (desktop.ts). Migrates the database, wires the AI and documentation search from the settings
// (rebuilt when they change), listens on 127.0.0.1 and indexes new documentation in the background.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import type { Config } from "./config";
import { migrate, type Db } from "./db";
import { dbCheck, errorMessage, openAiModelLister, type HealthDeps } from "./health";
import { openAiEmbedder, type Embedder } from "./rag/embed";
import { createRagService } from "./rag/service";
import { createLlm, type LlmClient } from "./agent/llm";
import type { AgentDeps } from "./agent/pipeline";
import { dbStore } from "./agent/project";
import { progressBus } from "./agent/progress";
import { PortInUseError, type KeyCheck, type Settings, type SettingsStore } from "./settings";
import { registerSettingsRoutes } from "./settings-routes";
import { ollamaPuller, registerOllamaRoutes } from "./ollama";

export interface StartOptions {
  config: Config;
  /** An open database (see openDataDir). The caller closes it after close(). */
  db: Db;
  /** AI models, the OpenAI key and Browser access (settings.ts). */
  settings: SettingsStore;
  /** 0 = any free port. */
  port: number;
  /** Serve the web build from this folder (desktop). Without it, only /api answers (development). */
  webDir?: string;
  /** Every request needs this session token (desktop, set through /pair). Without it, none is asked. */
  accessToken?: string;
  /** Log the app's messages (stages, indexing, downloads, errors) to stdout. */
  logger?: boolean;
  /** Also log every request (development; off in the desktop app, whose page polls often). */
  requestLogs?: boolean;
  /** The desktop app (data in its app-data folder, key kept by the operating system). */
  desktop?: boolean;
  /** Tests: stands in for asking OpenAI whether a key works. */
  checkKey?: (key: string, model: string) => Promise<KeyCheck>;
}

/**
 * Optional "Browser access" (PLAN §19.3b): the same app on a fixed port so a normal browser can open
 * it while the desktop app runs. Off until enabled; still 127.0.0.1 only and still needs the token.
 */
export interface BrowserAccess {
  /** Opens the port (default 8080). Resolves with the address to open, e.g. http://localhost:8080/. */
  enable(port?: number): Promise<string>;
  disable(): Promise<void>;
  /** The address while open, else null. */
  url(): string | null;
  /** A link that signs a browser in (sets the session cookie); null while closed. */
  pairingUrl(): string | null;
}

export interface RunningApi {
  /** Where the app answers, e.g. http://127.0.0.1:53124/ */
  url: string;
  /** Opens the app with the session cookie set (desktop window). Same as url without a token. */
  pairingUrl: string;
  port: number;
  app: FastifyInstance;
  browserAccess: BrowserAccess;
  close(): Promise<void>;
}

export { PortInUseError };

const RETRY_MS = 30_000;
const MAX_ATTEMPTS = 10;

interface Clients {
  llm: LlmClient;
  cloudLlm?: LlmClient;
  embedder: Embedder;
  listModels: () => Promise<string[]>;
}

function clientsFor(config: Config, s: Settings): Clients {
  const key = s.openai.apiKey.trim();
  return {
    llm: createLlm({
      api: config.LLM_API,
      baseUrl: s.local.baseUrl,
      model: s.local.model,
      numCtx: s.local.numCtx,
      temperature: config.LLM_TEMPERATURE,
      timeoutMs: config.LLM_TIMEOUT_MS,
      keepAlive: `${s.local.keepAliveMin}m`,
    }),
    // OpenAI's model, offered next to the local one only when a key is set.
    cloudLlm: key
      ? createLlm({
          api: "openai",
          baseUrl: config.OPENAI_BASE_URL,
          model: s.openai.model,
          numCtx: s.local.numCtx,
          temperature: config.LLM_TEMPERATURE,
          timeoutMs: config.OPENAI_TIMEOUT_MS,
          apiKey: key,
          reasoningEffort: s.openai.reasoningEffort,
        })
      : undefined,
    embedder: openAiEmbedder(s.local.baseUrl, s.local.embedModel),
    listModels: openAiModelLister(s.local.baseUrl),
  };
}

export async function startApi(opts: StartOptions): Promise<RunningApi> {
  const { config, db, settings } = opts;
  // The services log through the app, which needs the services: `log` is set once the app exists.
  let log: (msg: string) => void = () => {};
  let clients = clientsFor(config, settings.get());

  // These objects stay the same; what they point to changes with the settings. A project that is
  // already running keeps the client it started with.
  const embedder: Embedder = { documents: (t) => clients.embedder.documents(t), query: (t) => clients.embedder.query(t) };
  const ragDeps = {
    db,
    embedder,
    repoDir: config.REPO_DIR,
    get embedModel() {
      return settings.get().local.embedModel;
    },
    log: (m: string) => log(m),
  };
  const rag = createRagService(ragDeps);
  const agent: AgentDeps = {
    llm: clients.llm,
    cloudLlm: clients.cloudLlm,
    store: dbStore(db),
    progress: progressBus(),
    search: async (q) => (await rag.search(q, { board: "pico-2-w", k: 2 })).hits.map((h) => ({ content: h.content, citation: h.citation })),
    log: (m) => log(m),
  };
  const health: HealthDeps = {
    checkDb: dbCheck(db),
    listModels: () => clients.listModels(),
    get llmModel() {
      return settings.get().local.model;
    },
    get embedModel() {
      return settings.get().local.embedModel;
    },
    checkDocs: async () => {
      const n = await rag.chunkCount();
      return n > 0
        ? { status: "ok", detail: `${n} documentation chunks indexed` }
        : { status: "down", detail: "no documentation indexed yet (POST /api/rag/reindex once the embedding model is pulled)" };
    },
  };

  const app = buildApp({ logLevel: opts.logger ? config.LOG_LEVEL : undefined, requestLogs: opts.requestLogs, webDir: opts.webDir, accessToken: opts.accessToken, rag, agent, health });
  log = (m) => app.log.info(m);
  const pair = (base: string) => (opts.accessToken ? `${base}pair?t=${opts.accessToken}` : base);

  // Browser access: a second listener feeding the same routes.
  let extra: { server: Server; url: string } | null = null;
  let browserError: string | null = null;
  const browserAccess: BrowserAccess = {
    async enable(wanted = 8080) {
      if (extra) return extra.url;
      const server = createServer((req, res) => app.routing(req, res));
      await new Promise<void>((ok, fail) => {
        server.once("error", (err: NodeJS.ErrnoException) => fail(err.code === "EADDRINUSE" ? new PortInUseError(wanted) : err));
        server.listen(wanted, "127.0.0.1", () => ok());
      });
      extra = { server, url: `http://localhost:${(server.address() as AddressInfo).port}/` };
      return extra.url;
    },
    async disable() {
      if (!extra) return;
      const { server } = extra;
      extra = null;
      server.closeAllConnections(); // open event streams would keep the port busy
      await new Promise<void>((ok) => server.close(() => ok()));
    },
    url: () => extra?.url ?? null,
    pairingUrl: () => (extra ? pair(extra.url) : null),
  };

  // Indexing runs again when the embedding model changes (the stored vectors are model-specific).
  let closed = false;
  const timers = new Set<NodeJS.Timeout>();
  const retry = (n: number) => {
    if (closed) return;
    const t = setTimeout(() => {
      timers.delete(t);
      attempt(n);
    }, RETRY_MS);
    t.unref();
    timers.add(t);
  };
  const attempt = (n: number) => {
    if (closed) return;
    rag
      .reindex(false)
      .then((r) => {
        const summary = { indexed: r.indexed.length, unchanged: r.unchanged.length, skipped: r.skipped.length, failed: r.failed.length, textOnly: r.textOnly.length, removed: r.removed.length };
        // Text-only documents are retried too: Ollama often starts after the app.
        if ((r.failed.length || r.textOnly.length) && n < MAX_ATTEMPTS) {
          const why = r.failed.length ? "some documents failed" : "the search model isn't reachable yet, so some documents only have keyword search";
          app.log.warn(summary, `rag: ${why}; trying again in ${RETRY_MS / 1000}s`);
          retry(n + 1);
        } else app.log.info(summary, "rag: ingest done");
      })
      .catch((err) => {
        if (closed) return;
        if (n >= MAX_ATTEMPTS) return app.log.error(`rag: ingest gave up after ${n} attempts: ${errorMessage(err)}`);
        app.log.warn(`rag: ingest attempt ${n} failed (${errorMessage(err)}); retrying in ${RETRY_MS / 1000}s`);
        retry(n + 1);
      });
  };

  registerSettingsRoutes(app, {
    settings,
    openAiBaseUrl: config.OPENAI_BASE_URL,
    dataHome: opts.desktop ? process.platform : null,
    checkKey: opts.checkKey,
    browser: () => ({ url: browserAccess.url(), pairingUrl: browserAccess.pairingUrl(), error: browserError }),
    // Called before a change is saved; throwing keeps the old settings (e.g. the port is taken).
    async apply(next, prev) {
      const b = next.browserAccess;
      const was = prev.browserAccess;
      if (!b.enabled) await browserAccess.disable();
      else if (!was.enabled || b.port !== was.port || !extra) {
        await browserAccess.disable();
        try {
          await browserAccess.enable(b.port);
        } catch (err) {
          if (was.enabled) await browserAccess.enable(was.port).catch(() => {});
          throw err;
        }
      }
      browserError = null;
      clients = clientsFor(config, next);
      agent.llm = clients.llm;
      agent.cloudLlm = clients.cloudLlm;
      if (next.local.embedModel !== prev.local.embedModel || next.local.baseUrl !== prev.local.baseUrl) attempt(1);
    },
  });

  // Model downloads from the page; a new documentation-search model indexes the docs right away.
  const puller = ollamaPuller({
    baseUrl: () => settings.get().local.baseUrl,
    onDone: (model) => {
      log(`ollama: downloaded ${model}`);
      if (model === settings.get().local.embedModel) attempt(1);
    },
  });
  registerOllamaRoutes(app, { puller, models: () => [settings.get().local.model, settings.get().local.embedModel] });

  await migrate(db, config.MIGRATIONS_DIR, log);
  await app.listen({ host: "127.0.0.1", port: opts.port });
  const port = (app.server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/`;
  if (config.RAG_AUTO_INGEST) attempt(1);
  if (settings.get().browserAccess.enabled) {
    await browserAccess.enable(settings.get().browserAccess.port).catch((err: Error) => {
      browserError = err.message;
      app.log.warn(`browser access: ${err.message}`);
    });
  }

  return {
    url,
    pairingUrl: pair(url),
    port,
    app,
    browserAccess,
    async close() {
      closed = true;
      timers.forEach(clearTimeout);
      puller.stop();
      await browserAccess.disable();
      await app.close();
    },
  };
}
