import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { errorMessage, hasModel, type CheckResult, type HealthDeps } from "../src/health";
import { loadConfig } from "../src/config";

const DB_OK: CheckResult = { status: "ok", detail: "postgres reachable, pgvector 0.8.0", latencyMs: 1 };
const DB_DOWN: CheckResult = { status: "down", detail: "connect ECONNREFUSED" };
const MODELS = ["qwen3:4b-instruct-2507-q4_K_M", "nomic-embed-text:latest"];

function deps(overrides: Partial<HealthDeps> = {}): HealthDeps {
  return {
    checkDb: async () => DB_OK,
    listModels: async () => MODELS,
    llmModel: "qwen3:4b-instruct-2507-q4_K_M",
    embedModel: "nomic-embed-text",
    ...overrides,
  };
}

let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});

async function getHealth(d: HealthDeps) {
  app = buildApp({ health: d });
  return app.inject({ method: "GET", url: "/api/health" });
}

describe("GET /api/health", () => {
  it("is ok when db, llm and embedding model are available", async () => {
    const res = await getHealth(deps());
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.checks.db.status).toBe("ok");
    expect(body.checks.llm.status).toBe("ok");
    expect(body.checks.embed.status).toBe("ok");
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("circuitCore");
  });

  it("is degraded (200) when the LLM endpoint is unreachable", async () => {
    const res = await getHealth(deps({ listModels: async () => { throw new Error("fetch failed"); } }));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("degraded");
    expect(body.checks.llm.status).toBe("down");
    expect(body.checks.llm.detail).toContain("unreachable");
  });

  it("is degraded and names the pull command when a model is missing", async () => {
    const res = await getHealth(deps({ listModels: async () => ["nomic-embed-text:latest"] }));
    const body = res.json();
    expect(body.status).toBe("degraded");
    expect(body.checks.llm.detail).toContain("ollama pull qwen3:4b-instruct-2507-q4_K_M");
    expect(body.checks.embed.status).toBe("ok");
  });

  it("is down (503) when the database is down", async () => {
    const res = await getHealth(deps({ checkDb: async () => DB_DOWN }));
    expect(res.statusCode).toBe(503);
    expect(res.json().status).toBe("down");
  });

  it("echoes or generates an x-request-id", async () => {
    app = buildApp({ health: deps() });
    const given = await app.inject({ method: "GET", url: "/api/health/live", headers: { "x-request-id": "abc-123" } });
    expect(given.headers["x-request-id"]).toBe("abc-123");
    const generated = await app.inject({ method: "GET", url: "/api/health/live" });
    expect(generated.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("GET /api/health/live", () => {
  it("returns ok without touching dependencies", async () => {
    const res = await getHealth(deps()); // warm app
    await app.close();
    app = buildApp({
      health: deps({
        checkDb: async () => { throw new Error("must not be called"); },
        listModels: async () => { throw new Error("must not be called"); },
      }),
    });
    const live = await app.inject({ method: "GET", url: "/api/health/live" });
    expect(res.statusCode).toBe(200);
    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: "ok" });
  });
});

describe("error format", () => {
  it("returns {code, message} for unknown routes", async () => {
    app = buildApp({ health: deps() });
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: "NOT_FOUND", message: "Route GET /api/nope not found" });
  });
});

describe("hasModel", () => {
  it("matches exact ids and the implicit :latest tag", () => {
    expect(hasModel(MODELS, "nomic-embed-text")).toBe(true);
    expect(hasModel(MODELS, "nomic-embed-text:latest")).toBe(true);
    expect(hasModel(MODELS, "qwen3:4b-instruct-2507-q4_K_M")).toBe(true);
    expect(hasModel(MODELS, "qwen3:8b")).toBe(false);
  });
});

describe("loadConfig", () => {
  it("applies defaults", () => {
    const c = loadConfig({ DATABASE_URL: "postgres://u:p@localhost:5433/db" });
    expect(c.API_PORT).toBe(3000);
    expect(c.LLM_NUM_CTX).toBe(16384);
    expect(c.API_HOST).toBe("127.0.0.1");
  });

  it("rejects a missing DATABASE_URL with a helpful message", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL[\s\S]*\.env\.example/);
  });
});

describe("errorMessage", () => {
  it("flattens AggregateError (empty message) into its inner errors", () => {
    const inner = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5433"), { code: "ECONNREFUSED" });
    const inner6 = Object.assign(new Error("connect ECONNREFUSED ::1:5433"), { code: "ECONNREFUSED" });
    expect(errorMessage(new AggregateError([inner, inner6], ""))).toBe(
      "connect ECONNREFUSED 127.0.0.1:5433; connect ECONNREFUSED ::1:5433",
    );
  });

  it("falls back to the error code when the message is empty", () => {
    expect(errorMessage(Object.assign(new Error(""), { code: "EPERM" }))).toBe("EPERM");
  });
});

describe("documentation check", () => {
  it("is degraded when no documentation is indexed", async () => {
    const res = await getHealth(deps({ checkDocs: async () => ({ status: "down", detail: "no documentation indexed yet" }) }));
    expect(res.json().status).toBe("degraded");
    expect(res.json().checks.docs.status).toBe("down");
  });
  it("is ok when docs are indexed", async () => {
    const res = await getHealth(deps({ checkDocs: async () => ({ status: "ok", detail: "57 chunks" }) }));
    expect(res.json().status).toBe("ok");
  });
  it("reports a failing docs check instead of crashing", async () => {
    const res = await getHealth(deps({ checkDocs: async () => { throw new Error("relation chunks does not exist"); } }));
    expect(res.json().checks.docs).toEqual({ status: "down", detail: "relation chunks does not exist" });
  });
});
