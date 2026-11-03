// startApi over real ports: the desktop flow (pair, then use the app) and the optional Browser
// access listener (PLAN §19.3b). Skipped where local ports can't be opened (some sandboxes).
import { createServer } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import type { Db } from "../src/db";
import { createPglite, pgliteDb } from "../src/pglite";
import { defaultSettings, memorySettings } from "../src/settings";
import { PortInUseError, startApi, type RunningApi } from "../src/start";

const REPO = resolve(import.meta.dirname, "../../..");
const TOKEN = "c".repeat(64);

const canListen = await new Promise<boolean>((ok) => {
  const s = createServer();
  s.once("error", () => ok(false));
  s.listen(0, "127.0.0.1", () => s.close(() => ok(true)));
});

describe.skipIf(!canListen)("startApi (real ports)", () => {
  let db: Db;
  let web: string;
  let api: RunningApi;
  beforeAll(async () => {
    web = await mkdtemp(join(tmpdir(), "breadpilot-web-"));
    await writeFile(join(web, "index.html"), "<!doctype html><title>BreadPilot</title>");
    db = pgliteDb(await createPglite());
    const config = loadConfig({ REPO_DIR: REPO, MIGRATIONS_DIR: join(REPO, "db/migrations"), RAG_AUTO_INGEST: "false", LLM_BASE_URL: "http://127.0.0.1:9/v1" });
    const checkKey = async () => ({ ok: true, message: "The key works." });
    api = await startApi({ config, db, settings: memorySettings(defaultSettings(config, { withKey: false })), port: 0, webDir: web, accessToken: TOKEN, checkKey });
  }, 60_000);
  afterAll(async () => {
    await api?.close();
    await db?.close();
    await rm(web, { recursive: true, force: true });
  });

  /** Follows /pair like a browser and returns the cookie it got. */
  const pair = async (link: string) => {
    const res = await fetch(link, { redirect: "manual" });
    expect(res.status).toBe(303);
    return res.headers.get("set-cookie")!.split(";")[0]!;
  };

  it("listens on 127.0.0.1 on a free port and has run the migrations", async () => {
    expect(api.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(api.pairingUrl).toBe(`${api.url}pair?t=${TOKEN}`);
    const tables = await db.query("SELECT 1 FROM schema_migrations");
    expect(tables.rows.length).toBeGreaterThan(0);
  });

  it("serves the app after pairing, and nothing before", async () => {
    expect((await fetch(api.url)).status).toBe(401);
    const cookie = await pair(api.pairingUrl);
    const page = await fetch(api.url, { headers: { cookie } });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("BreadPilot");
    expect((await fetch(`${api.url}api/projects`, { headers: { cookie } })).status).toBe(200);
  });

  it("keeps Browser access closed until it is turned on, and closes it again", async () => {
    expect(api.browserAccess.url()).toBeNull();
    expect(api.browserAccess.pairingUrl()).toBeNull();
    const url = await api.browserAccess.enable(0);
    expect(url).toMatch(/^http:\/\/localhost:\d+\/$/);
    expect((await fetch(url)).status).toBe(401); // still needs the token
    const cookie = await pair(api.browserAccess.pairingUrl()!);
    expect((await fetch(`${url}api/projects`, { headers: { cookie } })).status).toBe(200);
    await api.browserAccess.disable();
    expect(api.browserAccess.url()).toBeNull();
    await expect(fetch(url)).rejects.toThrow();
    expect((await fetch(`${api.url}api/projects`, { headers: { cookie } })).status).toBe(200); // the window keeps working
  });

  it("offers OpenAI as soon as a key is saved in Settings, and stops when it's removed", async () => {
    const cookie = await pair(api.pairingUrl);
    const options = async () => (await (await fetch(`${api.url}api/llm-options`, { headers: { cookie } })).json()) as { openai: { available: boolean } };
    expect((await options()).openai.available).toBe(false);
    const key = `sk-proj-${"k".repeat(40)}`;
    const save = await fetch(`${api.url}api/settings/openai-key`, { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ key }) });
    expect(save.status).toBe(200);
    expect((await options()).openai.available).toBe(true);
    await fetch(`${api.url}api/settings/openai-key`, { method: "DELETE", headers: { cookie } });
    expect((await options()).openai.available).toBe(false);
  });

  it("turns Browser access on and off through Settings", async () => {
    const cookie = await pair(api.pairingUrl);
    const put = (body: unknown) => fetch(`${api.url}api/settings`, { method: "PUT", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
    const free = await new Promise<number>((ok) => {
      const s = createServer().listen(0, "127.0.0.1", () => {
        const p = (s.address() as { port: number }).port;
        s.close(() => ok(p));
      });
    });
    type View = { browserAccess: { url: string | null; pairingUrl: string | null } };
    const on = (await (await put({ browserAccess: { enabled: true, port: free } })).json()) as View;
    expect(on.browserAccess.url).toBe(`http://localhost:${free}/`);
    expect(on.browserAccess.pairingUrl).toBe(`http://localhost:${free}/pair?t=${TOKEN}`);
    const taken = await put({ browserAccess: { port: api.port } });
    expect(taken.status).toBe(409);
    expect(api.browserAccess.url()).toBe(`http://localhost:${free}/`); // still on the old port
    const off = (await (await put({ browserAccess: { enabled: false } })).json()) as View;
    expect(off.browserAccess.url).toBeNull();
  });

  it("says so when the chosen port is taken", async () => {
    await expect(api.browserAccess.enable(api.port)).rejects.toBeInstanceOf(PortInUseError);
    expect(api.browserAccess.url()).toBeNull();
  });
});
