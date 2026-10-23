import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
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
  /** Extra host names the API answers to, besides localhost (e.g. a LAN name you chose). */
  allowedHosts?: string[];
  rag?: RagService;
  agent?: AgentDeps;
  logLevel?: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logLevel ? { level: deps.logLevel } : false,
    requestIdHeader: "x-request-id",
    genReqId: () => crypto.randomUUID(),
  });

  // Requests must be for this app. A website can point its own domain at 127.0.0.1 ("DNS
  // rebinding") and then read and change projects as if it were this page, so other Host names
  // are refused. Changes (POST/DELETE...) sent by another website are refused too: browsers name
  // the sending page in Origin, and a request from the app itself carries the app's own origin.
  const hosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "api", ...(deps.allowedHosts ?? []).map((h) => h.toLowerCase())]);
  const hostOk = (value: string | undefined) => {
    if (!value) return false;
    const name = value.toLowerCase().replace(/:\d+$/, "");
    return hosts.has(name) || name.endsWith(".localhost");
  };
  app.addHook("onRequest", async (req, reply) => {
    if (!hostOk(req.headers.host)) {
      return reply.status(421).send({ code: "WRONG_HOST", message: "This API only answers requests for localhost." } satisfies ApiError);
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
  });

  app.setErrorHandler<FastifyError>((err, req, reply) => {
    const statusCode = err.statusCode ?? 500;
    if (statusCode >= 500) req.log.error({ err }, "request failed");
    const body: ApiError = {
      code: err.code ?? (statusCode >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST"),
      message: statusCode >= 500 ? "Internal server error" : err.message,
    };
    reply.status(statusCode).send(body);
  });

  app.setNotFoundHandler((req, reply) => {
    const body: ApiError = { code: "NOT_FOUND", message: `Route ${req.method} ${req.url} not found` };
    reply.status(404).send(body);
  });

  // Liveness: the process is up. Used by the Docker healthcheck.
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
