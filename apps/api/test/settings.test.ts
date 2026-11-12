// Settings without .env (PLAN §19.2): the encrypted settings file, the Settings routes and the
// OpenAI key check. The key must never appear in an answer or in the file as plain text.
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { sealBox } from "../src/secretbox";
import {
  checkOpenAiKey,
  defaultSettings,
  fileSettings,
  memorySettings,
  PortInUseError,
  SettingsFileError,
  type KeyCheck,
  type Settings,
  type SettingsStore,
} from "../src/settings";
import { registerSettingsRoutes, type SettingsWriter } from "../src/settings-routes";

const KEY = `sk-proj-${"Ab1_-".repeat(30)}wxyz`;
const OTHER_KEY = `sk-proj-${"Zz9".repeat(20)}`;
const defaults = defaultSettings(loadConfig({}), { withKey: false });

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "breadpilot-settings-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("defaults", () => {
  it("never take the key from .env in the desktop app", () => {
    const config = loadConfig({ OPENAI_API_KEY: KEY });
    expect(defaultSettings(config, { withKey: false }).openai.apiKey).toBe("");
    expect(defaultSettings(config, { withKey: true }).openai.apiKey).toBe(KEY); // development server only
    expect(defaults.browserAccess).toEqual({ enabled: false, port: 8080 });
    expect(defaults.local.keepAliveMin).toBe(1); // the 4-5 GB model is freed a minute after its last answer
  });

  it("show the first-run setup in the desktop app, not on the development server", () => {
    expect(defaults.setupDone).toBe(false);
    expect(defaults.tourDone).toBe(false);
    expect(defaultSettings(loadConfig({}), { withKey: true, setupDone: true }).setupDone).toBe(true);
  });
});

describe("settings.enc", () => {
  const dataKey = randomBytes(32);

  it("starts from the defaults without writing a file", async () => {
    const file = join(dir, "a.enc");
    const store = await fileSettings({ file, key: dataKey, defaults });
    expect(store.get()).toEqual(defaults);
    await expect(stat(file)).rejects.toThrow();
  });

  it("saves encrypted (0600, no plain text) and reads back", async () => {
    const file = join(dir, "b.enc");
    const store = await fileSettings({ file, key: dataKey, defaults });
    await store.set({ ...defaults, openai: { ...defaults.openai, apiKey: KEY, model: "gpt-x" } });
    const raw = await readFile(file);
    expect(raw.subarray(0, 5).toString()).toBe("BPST1");
    expect(raw.includes(Buffer.from(KEY))).toBe(false);
    expect(raw.includes(Buffer.from("gpt-x"))).toBe(false);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const again = await fileSettings({ file, key: dataKey, defaults });
    expect(again.get().openai).toMatchObject({ apiKey: KEY, model: "gpt-x" });
  });

  it("refuses a file it can't decrypt and leaves it untouched", async () => {
    const file = join(dir, "b.enc");
    const before = await readFile(file);
    await expect(fileSettings({ file, key: randomBytes(32), defaults })).rejects.toBeInstanceOf(SettingsFileError);
    expect((await readFile(file)).equals(before)).toBe(true);
  });

  it("fills in settings that an older file doesn't have", async () => {
    const file = join(dir, "old.enc");
    await writeFile(file, sealBox(dataKey, "BPST1", Buffer.from(JSON.stringify({ version: 1, openai: { apiKey: KEY } }))));
    const store = await fileSettings({ file, key: dataKey, defaults });
    expect(store.get().openai.apiKey).toBe(KEY);
    expect(store.get().local).toEqual(defaults.local); // incl. keepAliveMin, which older files don't have
    expect(store.get().browserAccess).toEqual(defaults.browserAccess);
    expect(store.get().setupDone).toBe(false); // an app from before the setup screen shows it once
    expect(store.get().tourDone).toBe(false);
    expect(store.get().modelMemory).toEqual({}); // no measured models before 0.3
  });

  it("keeps measured model memory, and drops a damaged list without losing the other settings", async () => {
    const measured = { "qwen3:8b": { bytes: 6_400_000_000, numCtx: 16384, at: "2026-11-05T10:00:00.000Z" } };
    const good = join(dir, "memory.enc");
    await writeFile(good, sealBox(dataKey, "BPST1", Buffer.from(JSON.stringify({ ...defaults, modelMemory: measured, setupDone: true }))));
    expect((await fileSettings({ file: good, key: dataKey, defaults })).get().modelMemory).toEqual(measured);
    const bad = join(dir, "memory-bad.enc");
    await writeFile(bad, sealBox(dataKey, "BPST1", Buffer.from(JSON.stringify({ ...defaults, modelMemory: { "qwen3:8b": { bytes: -1 } }, setupDone: true }))));
    const store = await fileSettings({ file: bad, key: dataKey, defaults });
    expect(store.get().modelMemory).toEqual({});
    expect(store.get().setupDone).toBe(true);
  });

  it("with no keyring to protect it, drops a stored key and never writes one", async () => {
    const file = join(dir, "weak.enc");
    await writeFile(file, sealBox(dataKey, "BPST1", Buffer.from(JSON.stringify({ openai: { apiKey: KEY, model: "gpt-x" } }))));
    const store = await fileSettings({ file, key: dataKey, defaults, keyRefused: "no keyring" });
    expect(store.keyRefused).toBe("no keyring");
    expect(store.get().openai).toMatchObject({ apiKey: "", model: "gpt-x" });
    const reread = await fileSettings({ file, key: dataKey, defaults }); // the file itself no longer has it
    expect(reread.get().openai.apiKey).toBe("");
    await store.set({ ...defaults, openai: { ...defaults.openai, apiKey: KEY } });
    expect(store.get().openai.apiKey).toBe("");
    expect((await fileSettings({ file, key: dataKey, defaults })).get().openai.apiKey).toBe("");
  });

  it("refuses invalid settings before writing", async () => {
    const store = await fileSettings({ file: join(dir, "c.enc"), key: dataKey, defaults });
    await expect(store.set({ ...defaults, local: { ...defaults.local, numCtx: 5 } })).rejects.toThrow();
    expect(store.get()).toEqual(defaults);
  });
});

describe("settings routes", () => {
  let app: FastifyInstance;
  let store: SettingsStore;
  let applied: { next: Settings; prev: Settings }[];
  let checked: string[];
  let checkResult: KeyCheck;
  let applyError: Error | null;
  let writer: SettingsWriter;

  beforeEach(async () => {
    store = memorySettings(defaults);
    applied = [];
    checked = [];
    checkResult = { ok: true, message: "The key works." };
    applyError = null;
    app = Fastify();
    writer = registerSettingsRoutes(app, {
      settings: store,
      openAiBaseUrl: "https://api.openai.example/v1",
      browser: () => ({ url: null, pairingUrl: null, error: null }),
      apply: async (next, prev) => {
        if (applyError) throw applyError;
        applied.push({ next, prev });
      },
      checkKey: async (key) => {
        checked.push(key);
        return checkResult;
      },
    });
    await app.ready();
  });

  const put = (url: string, payload: unknown) => app.inject({ method: "PUT", url, payload: payload as object });

  it("shows the settings without any key", async () => {
    const res = await app.inject({ url: "/api/settings" });
    expect(res.json().openai).toEqual({ model: defaults.openai.model, reasoningEffort: defaults.openai.reasoningEffort, keySet: false, keyHint: null, keyRefused: null });
    expect(res.json().dataHome).toBeNull();
    expect(res.body).not.toContain("apiKey");
  });

  it("saves a key OpenAI accepts, applies it, and only ever shows its last 4 characters", async () => {
    const res = await put("/api/settings/openai-key", { key: `  ${KEY}\n` });
    expect(res.statusCode).toBe(200);
    expect(checked).toEqual([KEY]);
    expect(store.get().openai.apiKey).toBe(KEY);
    expect(applied.at(-1)?.next.openai.apiKey).toBe(KEY);
    expect(res.json().openai).toMatchObject({ keySet: true, keyHint: "…wxyz" });
    expect(res.body).not.toContain(KEY);
    const later = await app.inject({ url: "/api/settings" });
    expect(later.body).not.toContain(KEY);
  });

  it("doesn't save a key that isn't one, or that OpenAI refuses", async () => {
    for (const key of ["", "hello", "sk-short", `sk-${"a".repeat(30)} b`, `Bearer ${KEY}`]) {
      const res = await put("/api/settings/openai-key", { key });
      expect(res.statusCode, key).toBe(400);
      expect(res.json().code).toBe("BAD_KEY");
    }
    expect(checked).toEqual([]); // not even sent to OpenAI
    checkResult = { ok: false, message: "OpenAI rejected this key." };
    const refused = await put("/api/settings/openai-key", { key: KEY });
    expect(refused.statusCode).toBe(422);
    expect(refused.json().message).toBe("OpenAI rejected this key.");
    expect(refused.body).not.toContain(KEY);
    expect(store.get().openai.apiKey).toBe("");
    expect(applied).toEqual([]);
  });

  it("removes the key", async () => {
    await put("/api/settings/openai-key", { key: KEY });
    const res = await app.inject({ method: "DELETE", url: "/api/settings/openai-key" });
    expect(res.json().openai.keySet).toBe(false);
    expect(store.get().openai.apiKey).toBe("");
  });

  it("tests a pasted key or the saved one without saving or echoing it", async () => {
    expect((await app.inject({ method: "POST", url: "/api/settings/openai-key/test" })).json().code).toBe("NO_KEY");
    const pasted = await app.inject({ method: "POST", url: "/api/settings/openai-key/test", payload: { key: OTHER_KEY } });
    expect(pasted.json()).toEqual({ ok: true, message: "The key works." });
    expect(store.get().openai.apiKey).toBe("");
    await put("/api/settings/openai-key", { key: KEY });
    await app.inject({ method: "POST", url: "/api/settings/openai-key/test" });
    expect(checked).toEqual([OTHER_KEY, KEY, KEY]);
    const bad = await app.inject({ method: "POST", url: "/api/settings/openai-key/test", payload: { key: "nope" } });
    expect(bad.json().ok).toBe(false);
  });

  it("never takes the key through a normal settings update", async () => {
    const res = await put("/api/settings", { openai: { apiKey: KEY } });
    expect(res.statusCode).toBe(400);
    expect(store.get().openai.apiKey).toBe("");
  });

  it("updates models and Browser access, applying them before saving", async () => {
    const res = await put("/api/settings", { local: { model: "qwen3:8b", numCtx: 8192 }, openai: { reasoningEffort: "medium" }, browserAccess: { enabled: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json().local).toMatchObject({ model: "qwen3:8b", numCtx: 8192, baseUrl: defaults.local.baseUrl });
    expect(res.json().browserAccess).toMatchObject({ enabled: true, port: 8080 });
    expect(applied.at(-1)?.prev).toEqual(defaults);
    expect(store.get().openai.reasoningEffort).toBe("medium");
  });

  it("remembers that the first-run setup was finished", async () => {
    expect((await app.inject({ url: "/api/settings" })).json().setupDone).toBe(false);
    const res = await put("/api/settings", { setupDone: true });
    expect(res.json().setupDone).toBe(true);
    expect(store.get().setupDone).toBe(true);
    expect((await put("/api/settings", { setupDone: "yes" })).statusCode).toBe(400);
    expect((await put("/api/settings", { tourDone: true })).json().tourDone).toBe(true);
  });

  it("refuses invalid values and unknown fields", async () => {
    for (const body of [{ local: { keepAliveMin: 61 } }, { local: { keepAliveMin: -1 } }, { local: { numCtx: 10 } }, { local: { baseUrl: "file:///etc" } }, { browserAccess: { port: 80 } }, { openai: { reasoningEffort: "max" } }, { colour: "red" }]) {
      const res = await put("/api/settings", body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
    }
    expect(store.get()).toEqual(defaults);
    expect(applied).toEqual([]);
  });

  it("never lets the page write measured model memory", async () => {
    const res = await put("/api/settings", { modelMemory: { "qwen3:8b": { bytes: 1, numCtx: 16384, at: "x" } } });
    expect(res.statusCode).toBe(400);
    expect(store.get().modelMemory).toEqual({});
  });

  it("code changes (measured memory) wait in the same queue as the page's saves, so neither is lost", async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const realSet = store.set.bind(store);
    let first = true;
    store.set = async (next) => {
      if (first) {
        first = false;
        await slow;
      }
      return realSet(next);
    };
    const pageSave = put("/api/settings", { local: { keepAliveMin: 7 } });
    await new Promise((r) => setTimeout(r, 5));
    const measured = writer.update((cur) => ({ ...cur, modelMemory: { "qwen3:8b": { bytes: 6e9, numCtx: 16384, at: "x" } } }));
    release();
    await Promise.all([pageSave, measured]);
    expect(store.get().local.keepAliveMin).toBe(7);
    expect(store.get().modelMemory["qwen3:8b"]?.bytes).toBe(6e9);
  });

  it("keeps the old settings when the new ones can't be applied (port taken)", async () => {
    applyError = new PortInUseError(8080);
    const res = await put("/api/settings", { browserAccess: { enabled: true } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PORT_IN_USE");
    expect(store.get().browserAccess.enabled).toBe(false);
  });

  it("puts the old settings back into effect when saving fails", async () => {
    store.set = async () => {
      throw new Error("disk full");
    };
    const res = await put("/api/settings", { local: { model: "other" } });
    expect(res.statusCode).toBe(500);
    expect(applied.map((a) => a.next.local.model)).toEqual(["other", defaults.local.model]);
  });
});

describe("settings routes without a keyring", () => {
  it("refuses to save a key, says why, and never asks OpenAI", async () => {
    const checked: string[] = [];
    const store = await fileSettings({ file: join(dir, "weak-routes.enc"), key: randomBytes(32), defaults, keyRefused: "This computer has no keyring." });
    const app = Fastify();
    registerSettingsRoutes(app, {
      settings: store,
      openAiBaseUrl: "https://api.openai.example/v1",
      browser: () => ({ url: null, pairingUrl: null, error: null }),
      apply: async () => {},
      checkKey: async (key) => {
        checked.push(key);
        return { ok: true, message: "The key works." };
      },
    });
    const res = await app.inject({ method: "PUT", url: "/api/settings/openai-key", payload: { key: KEY } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ code: "KEY_STORAGE", message: "This computer has no keyring." });
    expect(checked).toEqual([]);
    expect(store.get().openai.apiKey).toBe("");
    expect((await app.inject({ url: "/api/settings" })).json().openai).toMatchObject({ keySet: false, keyRefused: "This computer has no keyring." });
    await app.close();
  });
});

describe("checkOpenAiKey", () => {
  const fake = (status: number, body: unknown = {}) => {
    const seen: RequestInit[] = [];
    const impl = (async (_url: string, init: RequestInit) => {
      seen.push(init);
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { impl, seen };
  };

  it("sends the key only in the Authorization header and explains each answer", async () => {
    const ok = fake(200, { data: [{ id: "gpt-6-luna" }] });
    expect(await checkOpenAiKey("https://api.openai.example/v1", KEY, "gpt-6-luna", ok.impl)).toEqual({ ok: true, message: "The key works." });
    expect((ok.seen[0]!.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    const other = await checkOpenAiKey("u", KEY, "gpt-6-luna", fake(200, { data: [{ id: "gpt-4o" }] }).impl);
    expect(other.ok).toBe(true);
    expect(other.message).toContain("can't use gpt-6-luna");
    for (const [status, ok2] of [
      [401, false],
      [429, false],
      [500, false],
    ] as const) {
      const r = await checkOpenAiKey("u", KEY, "m", fake(status).impl);
      expect(r.ok, String(status)).toBe(ok2);
      expect(r.message).not.toContain(KEY);
    }
    const offline = await checkOpenAiKey("u", KEY, "m", (async () => {
      throw new Error("ENOTFOUND");
    }) as unknown as typeof fetch);
    expect(offline).toEqual({ ok: false, message: "Couldn't reach OpenAI. Check your internet connection." });
  });
});
