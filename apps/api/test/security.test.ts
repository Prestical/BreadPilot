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
const make = () => (app = buildApp({ agent: { llm, store: memoryStore() }, health }));
afterEach(async () => {
  await app?.close();
});

describe("Host check (DNS rebinding)", () => {
  it("answers localhost, 127.0.0.1 and [::1]", async () => {
    make();
    for (const host of ["localhost:8080", "127.0.0.1:3000", "[::1]:8080", "LOCALHOST:8080"]) {
      expect((await app.inject({ method: "GET", url: "/api/projects", headers: { host } })).statusCode, host).toBe(200);
    }
  });

  it("refuses *.localhost names (nothing uses them; review 16/11/2026)", async () => {
    make();
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: { host: "app.localhost:8080" } })).statusCode).toBe(421);
  });

  it("refuses any other host, for reads and changes", async () => {
    make();
    const read = await app.inject({ method: "GET", url: "/api/projects", headers: { host: "rebind.evil.example:8080" } });
    expect(read.statusCode).toBe(421);
    expect(read.json().code).toBe("WRONG_HOST");
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: { host: "rebind.evil.example:8080" }, payload: { idea: "blink an LED" } });
    expect(create.statusCode).toBe(421);
  });

  it("refuses the old Docker service name", async () => {
    make();
    expect((await app.inject({ method: "GET", url: "/api/projects", headers: { host: "api:3000" } })).statusCode).toBe(421);
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

  it("refuses changes from another port on this computer (same site, not this app)", async () => {
    make();
    const host = "127.0.0.1:52345";
    const cases: Record<string, string>[] = [
      { host, origin: "http://127.0.0.1:3000" }, // a dev server's page
      { host, origin: "http://localhost:52345" }, // right port, other name: another origin to the browser
      { host, origin: "http://evil.localhost:52345" },
      { host, origin: "https://127.0.0.1:52345" }, // the app is http only
      { host, "sec-fetch-site": "same-site" }, // another port, Origin left out
      { host, origin: "http://127.0.0.1:52345", "sec-fetch-site": "same-site" },
    ];
    for (const headers of cases) {
      const r = await app.inject({ method: "POST", url: "/api/projects/x/retry", headers });
      expect(r.statusCode, JSON.stringify(headers)).toBe(403);
      expect(r.json().code).toBe("FOREIGN_ORIGIN");
    }
  });

  it("accepts changes from the app's own host and port, on either address", async () => {
    make();
    for (const [host, origin] of [["127.0.0.1:52345", "http://127.0.0.1:52345"], ["localhost:8080", "http://localhost:8080"], ["[::1]:8080", "http://[::1]:8080"], ["localhost", "http://localhost"]]) {
      const r = await app.inject({ method: "POST", url: "/api/projects/x/retry", headers: { host, origin, "sec-fetch-site": "same-origin" } });
      expect(r.statusCode, origin).toBe(404); // reached the route
    }
    // Typed or bookmarked by the user (no page sent it): "none".
    expect((await app.inject({ method: "POST", url: "/api/projects/x/retry", headers: { host: "localhost:8080", "sec-fetch-site": "none" } })).statusCode).toBe(404);
  });

  it("accepts changes from the app's own page and from tools without an Origin", async () => {
    make();
    const own = await app.inject({ method: "POST", url: "/api/projects/x/retry", headers: { host: "localhost:8080", origin: "http://localhost:8080", "sec-fetch-site": "same-origin" } });
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
