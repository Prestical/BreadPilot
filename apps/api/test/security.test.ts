// Security review 23/10/2026: the API answers only requests for this app (DNS rebinding), and
// changes only from the app's own page (cross-site requests).
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { memoryStore } from "../src/agent/project";
import type { LlmClient } from "../src/agent/llm";

const llm: LlmClient = {
  model: "fake",
  async json() {
    throw new Error("not used");
  },
};
const health = { checkDb: async () => ({ status: "ok" as const, detail: "" }), listModels: async () => [], llmModel: "m", embedModel: "e" };
let app: FastifyInstance;
const make = (allowedHosts?: string[]) => (app = buildApp({ agent: { llm, store: memoryStore() }, health, allowedHosts }));
afterEach(async () => {
  await app?.close();
});

describe("Host check (DNS rebinding)", () => {
  it("answers localhost, 127.0.0.1, [::1], *.localhost and the Docker service name", async () => {
    make();
    for (const host of ["localhost:8080", "127.0.0.1:3000", "[::1]:8080", "app.localhost:8080", "api:3000"]) {
      expect((await app.inject({ method: "GET", url: "/api/projects", headers: { host } })).statusCode, host).toBe(200);
    }
  });

  it("refuses any other host, for reads and changes", async () => {
    make();
    const read = await app.inject({ method: "GET", url: "/api/projects", headers: { host: "rebind.evil.example:8080" } });
    expect(read.statusCode).toBe(421);
    expect(read.json().code).toBe("WRONG_HOST");
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: { host: "rebind.evil.example:8080" }, payload: { idea: "blink an LED" } });
    expect(create.statusCode).toBe(421);
  });

  it("accepts extra hosts from ALLOWED_HOSTS", async () => {
    make(["MyPi.lan"]);
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: { host: "mypi.lan:8080" } })).statusCode).toBe(200);
  });
});

describe("Origin check (cross-site changes)", () => {
  it("refuses changes sent by another website, including body-less ones", async () => {
    make();
    for (const url of ["/api/projects/x/retry", "/api/projects/x/approve", "/api/projects/x/stop", "/api/rag/reindex"]) {
      const r = await app.inject({ method: "POST", url, headers: { origin: "https://evil.example" } });
      expect(r.statusCode, url).toBe(403);
      expect(r.json().code).toBe("FOREIGN_ORIGIN");
    }
    expect((await app.inject({ method: "DELETE", url: "/api/projects/x", headers: { origin: "null" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/projects/x/retry", headers: { "sec-fetch-site": "cross-site" } })).statusCode).toBe(403);
  });

  it("accepts changes from the app's own page and from tools without an Origin", async () => {
    make();
    const own = await app.inject({ method: "POST", url: "/api/projects/x/retry", headers: { origin: "http://localhost:8080", "sec-fetch-site": "same-origin" } });
    expect(own.statusCode).toBe(404); // reached the route: the project just doesn't exist
    const tool = await app.inject({ method: "POST", url: "/api/projects/x/retry" });
    expect(tool.statusCode).toBe(404);
  });

  it("still lets other websites read nothing: no CORS headers", async () => {
    make();
    const r = await app.inject({ method: "GET", url: "/api/projects", headers: { origin: "https://evil.example" } });
    expect(r.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
