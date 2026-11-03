// The app as the desktop window sees it (PLAN §19.3): the web build served by the API, security
// headers on every response, and the session token that only the app's own window (or a paired
// browser) has. Through app.inject, so no port is needed.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp, SECURITY_HEADERS, SESSION_COOKIE } from "../src/app";
import { memoryStore } from "../src/agent/project";
import type { LlmClient } from "../src/agent/llm";

const TOKEN = "a".repeat(64);
const llm: LlmClient = {
  model: "fake",
  async json() {
    throw new Error("not used");
  },
};
const health = { checkDb: async () => ({ status: "ok" as const, detail: "" }), listModels: async () => [], llmModel: "m", embedModel: "e" };
const signedIn = { cookie: `${SESSION_COOKIE}=${TOKEN}` };

let web: string;
let app: FastifyInstance;
beforeAll(async () => {
  web = await mkdtemp(join(tmpdir(), "breadpilot-web-"));
  await mkdir(join(web, "assets"));
  await writeFile(join(web, "index.html"), "<!doctype html><title>BreadPilot</title>");
  await writeFile(join(web, "assets", "index-abc123.js"), "console.log(1)");
  app = buildApp({ health, agent: { llm, store: memoryStore() }, webDir: web, accessToken: TOKEN });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  await rm(web, { recursive: true, force: true });
});

describe("session token", () => {
  it("locks the page and the API without the cookie", async () => {
    const page = await app.inject({ url: "/" });
    expect(page.statusCode).toBe(401);
    expect(page.body).not.toContain("<title>");
    const api = await app.inject({ url: "/api/projects" });
    expect(api.statusCode).toBe(401);
    expect(api.json().code).toBe("LOCKED");
    expect((await app.inject({ url: "/api/projects", headers: { cookie: `${SESSION_COOKIE}=${"b".repeat(64)}` } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/projects", payload: { idea: "x" } })).statusCode).toBe(401);
  });

  it("signs a window in through /pair with an HttpOnly, SameSite=Strict cookie", async () => {
    const wrong = await app.inject({ url: "/pair?t=nope" });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.headers["set-cookie"]).toBeUndefined();
    const pair = await app.inject({ url: `/pair?t=${TOKEN}` });
    expect(pair.statusCode).toBe(303);
    expect(pair.headers.location).toBe("/");
    expect(pair.headers["set-cookie"]).toBe(`${SESSION_COOKIE}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/`);
  });

  it("lets a signed-in window use the API", async () => {
    const res = await app.inject({ url: "/api/projects", headers: signedIn });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("never repeats the token from a URL", async () => {
    const res = await app.inject({ url: `/api/nothing?t=${TOKEN}`, headers: signedIn });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain(TOKEN);
    expect(res.json().message).toContain("t=REDACTED");
  });

  it("still refuses other host names first", async () => {
    expect((await app.inject({ url: "/", headers: { ...signedIn, host: "rebind.evil.example" } })).statusCode).toBe(421);
  });

  it("asks for no token when none is set (development)", async () => {
    const dev = buildApp({ health, agent: { llm, store: memoryStore() } });
    expect((await dev.inject({ url: "/api/projects" })).statusCode).toBe(200);
    expect((await dev.inject({ url: "/pair?t=x" })).statusCode).toBe(404);
    await dev.close();
  });
});

describe("web build", () => {
  it("serves index.html, never cached", async () => {
    const res = await app.inject({ url: "/", headers: signedIn });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<title>BreadPilot</title>");
    expect(res.headers["cache-control"]).toBe("no-cache");
  });

  it("serves hashed assets, cached for good", async () => {
    const res = await app.inject({ url: "/assets/index-abc123.js", headers: signedIn });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("answers other page addresses with the app, but missing assets and API routes with 404", async () => {
    const page = await app.inject({ url: "/projects/123", headers: signedIn });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("<title>BreadPilot</title>");
    expect((await app.inject({ url: "/assets/gone.js", headers: signedIn })).statusCode).toBe(404);
    const api = await app.inject({ url: "/api/nope", headers: signedIn });
    expect(api.statusCode).toBe(404);
    expect(api.json().code).toBe("NOT_FOUND");
  });

  it("refuses paths outside the web folder", async () => {
    const res = await app.inject({ url: "/../../../etc/passwd", headers: signedIn });
    expect(res.body).not.toContain("root:");
  });
});

describe("security headers", () => {
  it("are on pages, assets, API answers and refusals", async () => {
    for (const [url, headers] of [
      ["/", signedIn],
      ["/assets/index-abc123.js", signedIn],
      ["/api/projects", signedIn],
      ["/api/projects", {}],
    ] as const) {
      const res = await app.inject({ url, headers });
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(res.headers[name], `${url} ${name}`).toBe(value);
    }
  });
});

describe("logging in the desktop app", () => {
  it("leaves requests out of the log without Fastify's deprecated option", async () => {
    const warnings: string[] = [];
    const onWarning = (w: Error & { code?: string }) => warnings.push(w.code ?? w.message);
    process.on("warning", onWarning);
    const quiet = buildApp({ health, agent: { llm, store: memoryStore() }, logLevel: "info", requestLogs: false });
    const levels: string[] = [];
    quiet.addHook("onRequest", async (req) => {
      levels.push(req.log.level);
    });
    await quiet.inject({ url: "/api/health/live" });
    await quiet.close();
    await new Promise((r) => setTimeout(r, 10));
    process.off("warning", onWarning);
    expect(levels).toEqual(["warn"]); // request logs are "info": not written
    expect(quiet.log.level).toBe("info"); // the app's own messages still are
    expect(warnings).not.toContain("FSTDEP023");
  });
});

