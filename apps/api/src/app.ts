import { createHash, timingSafeEqual } from "node:crypto";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from "fastify";
import { CIRCUIT_CORE_VERSION } from "@breadpilot/circuit-core";
import { registerCircuitRoutes } from "./circuit";
import { registerAgentRoutes } from "./agent/routes";
import type { AgentDeps } from "./agent/pipeline";
import { runHealthChecks, type HealthDeps } from "./health";
import { registerRagRoutes } from "./rag/routes";
import type { RagService } from "./rag/service";

export const API_VERSION = "0.0.1";

export interface AppDeps {
  health: HealthDeps;
  /** Serve the web build from this folder (desktop app). */
  webDir?: string;
  /** Every request needs this session token as the bp_session cookie, set by GET /pair?t=<token>. */
  accessToken?: string;
  rag?: RagService;
  agent?: AgentDeps;
  logLevel?: string;
  /** Log every request (development). The desktop app's log keeps only the app's own messages. */
  requestLogs?: boolean;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

// Every response: everything comes from this app. 'wasm-unsafe-eval' is for the LittleFS WebAssembly
// that builds the UF2; inline styles are React's style attributes; data:/blob: are canvas textures and
// downloads. frame-ancestors/X-Frame-Options: other sites can't put the app in a frame (clickjacking).
export const SECURITY_HEADERS: Record<string, string> = {
  "content-security-policy":
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), usb=(), serial=()",
};

export const SESSION_COOKIE = "bp_session";

/** Equal-time comparison, so the token can't be guessed from response times. */
function sameSecret(a: string, b: string): boolean {
  const h = (v: string) => createHash("sha256").update(v).digest();
  return timingSafeEqual(h(a), h(b));
}

function cookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

/** The pairing link carries the token: never write it to a log. */
const redact = (url: string) => url.replace(/([?&]t=)[^&]*/g, "$1REDACTED");

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logLevel
      ? { level: deps.logLevel, serializers: { req: (req) => ({ method: req.method, url: redact(req.url), id: req.id }) } }
      : false,
    requestIdHeader: "x-request-id",
    genReqId: () => crypto.randomUUID(),
  });
  const token = deps.accessToken;
  // No request logs (desktop app): Fastify logs requests at "info" through each route's logger, so
  // routes log from "warn" up; the app's own messages (app.log) keep their level.
  if (deps.requestLogs === false) {
    app.addHook("onRoute", (route) => {
      route.logLevel = "warn"; // set outright: Fastify has already filled in the app's level here
    });
  }

  // Requests must be for this app. A website can point its own domain at 127.0.0.1 ("DNS
  // rebinding") and then read and change projects as if it were this page, so other Host names
  // are refused. Changes (POST/DELETE...) sent by another website are refused too: browsers name
  // the sending page in Origin, and a request from the app itself carries the app's own origin.
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  const hostOk = (value: string | undefined) => {
    if (!value) return false;
    const name = value.toLowerCase().replace(/:\d+$/, "");
    return hosts.has(name) || name.endsWith(".localhost");
  };
  app.addHook("onRequest", async (req, reply) => {
    if (!hostOk(req.headers.host)) {
      return reply.status(421).send({ code: "WRONG_HOST", message: "This API only answers requests for localhost." } satisfies ApiError);
    }
    // Session token (desktop app): other programs and users on this computer can't use the app
    // through its port. /pair sets the cookie; everything else needs it.
    if (token && req.url.split("?")[0] !== "/pair") {
      const given = cookie(req, SESSION_COOKIE);
      if (!given || !sameSecret(given, token)) {
        const message = "Open BreadPilot from its own window, or use the browser link in Settings.";
        if (req.url.startsWith("/api/")) return reply.status(401).send({ code: "LOCKED", message } satisfies ApiError);
        return reply.status(401).type("text/plain; charset=utf-8").send(`BreadPilot: ${message}`);
      }
    }
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    const origin = req.headers.origin;
    let fromOtherSite = req.headers["sec-fetch-site"] === "cross-site";
    if (origin !== undefined) {
      try {
        fromOtherSite ||= !hostOk(new URL(origin).host);
      } catch {
        fromOtherSite = true; // "null" or garbage
      }
    }
    if (fromOtherSite) {
      return reply.status(403).send({ code: "FOREIGN_ORIGIN", message: "Changes are only accepted from the BreadPilot page itself." } satisfies ApiError);
    }
  });

  app.addHook("onSend", async (req, reply) => {
    reply.header("x-request-id", req.id);
    reply.headers(SECURITY_HEADERS);
  });

  if (token) {
    app.get<{ Querystring: { t?: string } }>("/pair", async (req, reply) => {
      if (!req.query.t || !sameSecret(req.query.t, token)) {
        return reply.status(401).type("text/plain; charset=utf-8").send("BreadPilot: this link is out of date. Open a new one from Settings.");
      }
      // HttpOnly: page scripts can't read it. SameSite=Strict: other sites' requests don't carry it.
      reply.header("set-cookie", `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`);
      return reply.redirect("/", 303);
    });
  }

  app.setErrorHandler<FastifyError>((err, req, reply) => {
    const statusCode = err.statusCode ?? 500;
    if (statusCode >= 500) req.log.error({ err }, "request failed");
    const body: ApiError = {
      code: err.code ?? (statusCode >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST"),
      message: statusCode >= 500 ? "Internal server error" : err.message,
    };
    reply.status(statusCode).send(body);
  });

  if (deps.webDir) {
    // The web build. index.html names the current /assets/ files, so it's never cached; the
    // assets have content hashes in their names, so they can be cached for good.
    app.register(fastifyStatic, {
      root: deps.webDir,
      wildcard: false,
      setHeaders: (res, path) => res.header("cache-control", /[\\/]assets[\\/]/.test(path) ? "public, max-age=31536000, immutable" : "no-cache"),
    });
  }

  app.setNotFoundHandler((req, reply) => {
    // Page addresses that aren't files get the app itself (it has no other pages).
    if (deps.webDir && req.method === "GET" && !req.url.startsWith("/api/") && !req.url.startsWith("/assets/")) {
      return reply.header("cache-control", "no-cache").sendFile("index.html");
    }
    const body: ApiError = { code: "NOT_FOUND", message: `Route ${req.method} ${redact(req.url)} not found` };
    reply.status(404).send(body);
  });

  // Liveness: the process is up.
  app.get("/api/health/live", async () => ({ status: "ok" }));

  // Readiness: dependencies (DB, LLM, embedding model). 503 only when the DB is down.
  app.get("/api/health", async (_req, reply) => {
    const report = await runHealthChecks(deps.health, API_VERSION);
    reply.status(report.status === "down" ? 503 : 200);
    return { ...report, circuitCore: CIRCUIT_CORE_VERSION };
  });

  registerCircuitRoutes(app);
  if (deps.rag) registerRagRoutes(app, deps.rag);
  if (deps.agent) registerAgentRoutes(app, deps.agent);

  return app;
}
