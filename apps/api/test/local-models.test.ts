// Local model list (Milestone 7, step 7.2): the user's local Ollama (installed models, thinking
// support, memory from /api/ps), the list the page gets (sizes built into the catalog, no internet),
// measuring, removing, and `think` in requests.
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import * as z from "zod/v4";
import { createLlm } from "../src/agent/llm";
import { loadConfig } from "../src/config";
import {
  BusyError,
  localModelService,
  NotInstalledError,
  OllamaError,
  ollamaModels,
  RefusedError,
  registerLocalModelRoutes,
  sameTag,
  thinkSetting,
  type OllamaModels,
} from "../src/local-models";
import { loadCatalog } from "../src/models";
import { defaultSettings, memorySettings, type Settings } from "../src/settings";

const GiB = 2 ** 30;

/** A fake Ollama on the native API: records every call. */
function fakeOllamaHttp(opts: { tags?: object[]; caps?: Record<string, string[]>; ps?: object[]; fail?: boolean; status?: Record<string, number> } = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", path, body });
    if (opts.fail) throw new TypeError("fetch failed");
    const status = opts.status?.[path];
    if (status) return new Response(JSON.stringify({ error: `model "${body?.model}" not found` }), { status });
    if (path === "/api/tags") return Response.json({ models: opts.tags ?? [] });
    if (path === "/api/show") return Response.json({ capabilities: opts.caps?.[body.model] ?? ["completion"] });
    if (path === "/api/ps") return Response.json({ models: opts.ps ?? [] });
    if (path === "/api/generate") return Response.json({ model: body.model, done: true, done_reason: "load" });
    if (path === "/api/delete") return new Response(null, { status: 200 });
    return new Response("?", { status: 404 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("ollamaModels (Ollama's native API)", () => {
  const api = (fake: ReturnType<typeof fakeOllamaHttp>) => ollamaModels({ baseUrl: () => "http://127.0.0.1:11434/v1", fetchImpl: fake.impl });

  it("lists installed models without cloud models", async () => {
    const fake = fakeOllamaHttp({
      tags: [
        { name: "qwen3:8b", size: 5_225_000_000, details: { parameter_size: "8.2B", quantization_level: "Q4_K_M" } },
        { name: "nomic-embed-text:latest", size: 274_000_000, details: {} },
        { name: "glm-5.3:cloud", size: 400, remote_host: "https://ollama.com:443" },
      ],
    });
    expect(await api(fake).installed()).toEqual([
      { tag: "qwen3:8b", bytes: 5_225_000_000, parameters: "8.2B", quantization: "Q4_K_M" },
      { tag: "nomic-embed-text:latest", bytes: 274_000_000, parameters: null, quantization: null },
    ]);
    expect(fake.calls[0]).toMatchObject({ method: "GET", path: "/api/tags" });
  });

  it("loads with an empty request, reads /api/ps, removes with DELETE", async () => {
    const fake = fakeOllamaHttp({ ps: [{ name: "qwen3:8b", model: "qwen3:8b", size: 6_100_000_000, size_vram: 6_100_000_000, context_length: 16384 }] });
    const o = api(fake);
    await o.load("qwen3:8b", 16384, "1m");
    expect(fake.calls[0]).toEqual({ method: "POST", path: "/api/generate", body: { model: "qwen3:8b", stream: false, keep_alive: "1m", options: { num_ctx: 16384 } } });
    expect(await o.running()).toEqual([{ tag: "qwen3:8b", bytes: 6_100_000_000, vramBytes: 6_100_000_000, contextLength: 16384 }]);
    await o.remove("qwen3:8b");
    expect(fake.calls.at(-1)).toEqual({ method: "DELETE", path: "/api/delete", body: { model: "qwen3:8b" } });
  });

  it("says what went wrong in plain words", async () => {
    await expect(api(fakeOllamaHttp({ fail: true })).installed()).rejects.toThrow(/Can't reach Ollama .*Is the Ollama app open\?/);
    await expect(api(fakeOllamaHttp({ status: { "/api/delete": 404 } })).remove("nope:1b")).rejects.toThrow('Ollama answered HTTP 404: model "nope:1b" not found');
    await expect(api(fakeOllamaHttp({ fail: true })).installed()).rejects.toBeInstanceOf(OllamaError);
  });

  it("matches tags the way Ollama writes them", () => {
    expect(sameTag("gemma4", "gemma4:latest")).toBe(true);
    expect(sameTag("qwen3:8b", "qwen3:8b")).toBe(true);
    expect(sameTag("qwen3:8b", "qwen3:14b")).toBe(false);
  });
});

const sizes = (weightsBytes: number, parameters: string) => ({ downloadBytes: weightsBytes + 13_000, weightsBytes, visionBytes: 0, draftBytes: 0, parameters, quantization: "Q4_K_M" });
const catalog = loadCatalog({
  format: 1,
  review: { status: "reviewed", by: "test", date: "2026-11-05" },
  sizesChecked: "2026-11-05",
  models: [
    { tag: "qwen3:4b-instruct-2507-q4_K_M", name: "Qwen3 4B Instruct", family: "Qwen3", think: false, default: true, ollama: sizes(2_497_280_480, "4.0B") },
    { tag: "qwen3:8b", name: "Qwen3 8B", family: "Qwen3", think: false, ollama: sizes(5_225_374_496, "8.2B") },
    { tag: "gemma4:31b", name: "Gemma 4 31B", family: "Gemma 4", think: false, ollama: sizes(18_670_033_120, "30.7B") },
  ],
});

describe("thinking", () => {
  it("sends the catalog's choice only to models Ollama says can think", async () => {
    let asked = 0;
    const think = thinkSetting(
      {
        capabilities: async (tag) => {
          asked++;
          return tag === "qwen3:8b" ? ["completion", "thinking"] : ["completion"];
        },
      },
      catalog,
    );
    expect(await think("qwen3:8b")).toBe(false);
    expect(await think("qwen3:4b-instruct-2507-q4_K_M")).toBeUndefined();
    expect(await think("someone/other:1b")).toBeUndefined();
    await think("qwen3:8b");
    expect(asked).toBe(2); // per tag once; unknown models aren't asked
  });

  it("asks again after a failed answer", async () => {
    let n = 0;
    const think = thinkSetting({ capabilities: async () => (++n === 1 ? Promise.reject(new Error("down")) : ["thinking"]) }, catalog);
    expect(await think("qwen3:8b")).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(await think("qwen3:8b")).toBe(false);
  });

  it("puts `think` in Ollama requests only when it has a value", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return Response.json({ message: { content: '{"ok":true}' } });
    }) as unknown as typeof fetch;
    const make = (think?: () => Promise<boolean | undefined>) =>
      createLlm({ api: "ollama", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen3:8b", numCtx: 16384, temperature: 0, timeoutMs: 5000, fetchImpl, think });
    const schema = z.object({ ok: z.boolean() });
    await make(async () => false).json(schema as never, [{ role: "user", content: "hi" }]);
    await make(async () => undefined).json(schema as never, [{ role: "user", content: "hi" }]);
    await make(async () => Promise.reject(new Error("show failed"))).json(schema as never, [{ role: "user", content: "hi" }]);
    await make().json(schema as never, [{ role: "user", content: "hi" }]);
    expect(bodies[0]!.think).toBe(false);
    expect(bodies.slice(1).map((b) => "think" in b)).toEqual([false, false, false]);
  });
});

// ---------- the service ----------


function fakeOllama(init: { installed?: string[]; ps?: { tag: string; bytes: number; ctx?: number }[]; down?: boolean } = {}) {
  const calls: string[] = [];
  let installed = [...(init.installed ?? [])];
  const o: OllamaModels = {
    installed: async () => {
      calls.push("installed");
      if (init.down) throw new OllamaError("Can't reach Ollama (fetch failed). Is the Ollama app open?");
      return installed.map((tag) => ({ tag, bytes: 5e9, parameters: "8.2B", quantization: "Q4_K_M" }));
    },
    capabilities: async () => [],
    running: async () => (init.ps ?? []).map((p) => ({ tag: p.tag, bytes: p.bytes, vramBytes: p.bytes, contextLength: p.ctx ?? null })),
    load: async (tag, numCtx, keep) => void calls.push(`load ${tag} ${numCtx} ${keep}`),
    remove: async (tag) => {
      calls.push(`remove ${tag}`);
      installed = installed.filter((t) => t !== tag);
    },
  };
  return { o, calls };
}

function setup(opts: { installed?: string[]; ps?: { tag: string; bytes: number; ctx?: number }[]; down?: boolean; patch?: (s: Settings) => Settings; total?: number } = {}) {
  const base = defaultSettings(loadConfig({}), { withKey: false });
  const store = memorySettings(opts.patch ? opts.patch(base) : base);
  const updates: Settings[] = [];
  const update = async (fn: (s: Settings) => Settings) => {
    const next = fn(store.get());
    updates.push(next);
    await store.set(next);
  };
  const ollama = fakeOllama(opts);
  const service = localModelService({
    settings: store,
    update,
    ollama: ollama.o,
    catalog,
    totalMemory: () => opts.total ?? 16 * GiB,
    now: () => new Date("2026-11-05T10:00:00Z"),
  });
  return { service, store, updates, calls: ollama.calls };
}

describe("the model list", () => {
  it("merges the catalog with Ollama: installed, selected, tier and fit from Ollama's numbers", async () => {
    const { service } = setup({ installed: ["qwen3:4b-instruct-2507-q4_K_M", "nomic-embed-text:latest", "llama3.2:3b"] });
    const view = await service.list();
    expect(view).toMatchObject({ totalMemoryBytes: 16 * GiB, numCtx: 16384, selected: "qwen3:4b-instruct-2507-q4_K_M", ollamaError: null });
    const [def, q8, big] = view.models;
    expect(def).toMatchObject({ name: "Qwen3 4B Instruct", default: true, installed: true, selected: true, tier: "small", fit: { kind: "unknown" } });
    expect(def!.fit.reason).toBe("Needs at least 2.5 GB; the exact memory is checked after the download.");
    expect(q8).toMatchObject({ installed: false, tier: "medium", parameters: "8.2B" });
    expect(big).toMatchObject({ tier: "large", fit: { kind: "too-big", reason: "The model alone is 18.7 GB; this computer has 16 GB." } });
    // Other downloaded models are listed apart; the search model isn't one of them.
    expect(view.others.map((m) => m.tag)).toEqual(["llama3.2:3b"]);
    expect(view.others[0]).toMatchObject({ inCatalog: false, installed: true, installedBytes: 5e9, sizes: null });
    expect(q8!.sizes).toEqual(catalog.models[1]!.ollama);
  });

  it("never touches the internet: the only calls go to the local Ollama", async () => {
    const seen: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      seen.push(String(url));
      throw new TypeError("blocked in this test");
    }) as typeof fetch;
    try {
      const { service } = setup({ installed: ["qwen3:8b"] });
      const view = await service.list();
      expect(view.models[1]!.fit.reason).toBe("Needs at least 5.2 GB; the exact memory is checked after the download.");
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(seen).toEqual([]);
  });

  it("shows a measurement and decides the fit from it", async () => {
    const { service } = setup({
      patch: (s) => ({ ...s, modelMemory: { "qwen3:4b-instruct-2507-q4_K_M": { bytes: 4.9e9, numCtx: 16384, at: "2026-11-05T09:00:00Z" } } }),
    });
    const def = (await service.list()).models[0]!;
    expect(def.measured).toEqual({ bytes: 4.9e9, numCtx: 16384, at: "2026-11-05T09:00:00Z" });
    expect(def.fit).toEqual({ kind: "fits", reason: "Uses 4.9 GB while running, plus about 1.0 GB for BreadPilot; this computer has 16 GB." });
  });

  it("still shows the list with its built-in sizes when the local Ollama isn't running", async () => {
    const view = await setup({ down: true }).service.list();
    expect(view.ollamaError).toMatch(/Is the Ollama app open/);
    expect(view.models.map((m) => [m.installed, m.tier])).toEqual([[false, "small"], [false, "medium"], [false, "large"]]);
    expect(view.models[0]!.fit.reason).toBe("Needs at least 2.5 GB; the exact memory is checked after the download.");
    expect(view.others).toEqual([]);
  });
});

describe("measuring", () => {
  it("loads the model at the current context, reads /api/ps and saves it per tag", async () => {
    const { service, store, calls } = setup({ installed: ["qwen3:8b"], ps: [{ tag: "qwen3:8b", bytes: 6_400_000_000, ctx: 16384 }] });
    const m = await service.measure("qwen3:8b");
    expect(m).toEqual({ bytes: 6_400_000_000, numCtx: 16384, at: "2026-11-05T10:00:00.000Z" });
    expect(calls).toContain("load qwen3:8b 16384 1m");
    expect(store.get().modelMemory).toEqual({ "qwen3:8b": m });
    expect((await service.list()).models[1]!.fit.kind).toBe("fits");
  });

  it("keeps the user's memory time, and unloads at once when it is 0 minutes", async () => {
    const five = setup({ installed: ["qwen3:8b"], ps: [{ tag: "qwen3:8b", bytes: 6e9 }], patch: (s) => ({ ...s, local: { ...s.local, keepAliveMin: 5 } }) });
    await five.service.measure("qwen3:8b");
    expect(five.calls.filter((c) => c.startsWith("load"))).toEqual(["load qwen3:8b 16384 5m"]);
    const zero = setup({ installed: ["qwen3:8b"], ps: [{ tag: "qwen3:8b", bytes: 6e9 }], patch: (s) => ({ ...s, local: { ...s.local, keepAliveMin: 0 } }) });
    await zero.service.measure("qwen3:8b");
    expect(zero.calls.filter((c) => c.startsWith("load"))).toEqual(["load qwen3:8b 16384 1m", "load qwen3:8b 16384 0"]);
  });

  it("uses the context size Ollama reports, which can differ from the setting", async () => {
    const { service } = setup({ installed: ["qwen3:8b"], ps: [{ tag: "qwen3:8b", bytes: 5.9e9, ctx: 8192 }] });
    expect((await service.measure("qwen3:8b")).numCtx).toBe(8192);
    expect((await service.list()).models[1]!.fit.kind).toBe("unknown");
  });

  it("refuses models that aren't downloaded, a second check at once, and a load Ollama doesn't confirm", async () => {
    await expect(setup().service.measure("qwen3:8b")).rejects.toBeInstanceOf(NotInstalledError);
    const busy = setup({ installed: ["qwen3:8b"], ps: [{ tag: "qwen3:8b", bytes: 6e9 }] });
    const first = busy.service.measure("qwen3:8b");
    await expect(busy.service.measure("qwen3:8b")).rejects.toBeInstanceOf(BusyError);
    await first;
    await expect(setup({ installed: ["qwen3:8b"], ps: [] }).service.measure("qwen3:8b")).rejects.toThrow(/doesn't list it as running/);
  });
});

describe("removing", () => {
  it("removes a model and its measurement", async () => {
    const { service, store, calls } = setup({ installed: ["qwen3:8b"], patch: (s) => ({ ...s, modelMemory: { "qwen3:8b": { bytes: 6e9, numCtx: 16384, at: "x" } } }) });
    await service.remove("qwen3:8b");
    expect(calls).toContain("remove qwen3:8b");
    expect(store.get().modelMemory).toEqual({});
  });

  it("never removes the search model or the model in use", async () => {
    const { service, calls } = setup({ installed: ["qwen3:4b-instruct-2507-q4_K_M", "nomic-embed-text:latest"] });
    await expect(service.remove("nomic-embed-text")).rejects.toBeInstanceOf(RefusedError);
    await expect(service.remove("qwen3:4b-instruct-2507-q4_K_M")).rejects.toThrow(/Pick another model first/);
    expect(calls.filter((c) => c.startsWith("remove"))).toEqual([]);
  });

  it("downloads are limited to the catalog plus the two models in Settings", () => {
    const { service } = setup({ patch: (s) => ({ ...s, local: { ...s.local, model: "llama3.2:3b" } }) });
    expect(service.downloadable()).toEqual(["qwen3:4b-instruct-2507-q4_K_M", "qwen3:8b", "gemma4:31b", "llama3.2:3b", "nomic-embed-text"]);
  });
});

describe("routes", () => {
  const appWith = (s: ReturnType<typeof setup>) => {
    const app = Fastify();
    registerLocalModelRoutes(app, s.service);
    return app;
  };

  it("GET lists, POST measures, DELETE removes", async () => {
    const s = setup({ installed: ["qwen3:8b"], ps: [{ tag: "qwen3:8b", bytes: 6e9, ctx: 16384 }] });
    const app = appWith(s);
    const list = await app.inject({ method: "GET", url: "/api/models/local" });
    expect(list.statusCode).toBe(200);
    expect(list.json().models).toHaveLength(3);
    const m = await app.inject({ method: "POST", url: "/api/models/local/measure", payload: { tag: "qwen3:8b" } });
    expect(m.statusCode).toBe(200);
    expect(m.json().measured.bytes).toBe(6e9);
    const del = await app.inject({ method: "DELETE", url: "/api/models/local?tag=qwen3:8b" });
    expect(del.statusCode).toBe(204);
  });

  it("refuses bad tags before anything reaches Ollama", async () => {
    const s = setup({ installed: ["qwen3:8b"] });
    const app = appWith(s);
    for (const req of [
      { method: "POST" as const, url: "/api/models/local/measure", payload: { tag: "../x" } },
      { method: "POST" as const, url: "/api/models/local/measure", payload: { tag: "qwen3:8b", extra: 1 } },
      { method: "DELETE" as const, url: "/api/models/local?tag=a%20b" },
      { method: "DELETE" as const, url: "/api/models/local" },
    ]) {
      expect((await app.inject(req)).statusCode, req.url).toBe(400);
    }
    expect(s.calls).toEqual([]);
  });

  it("answers 409 for refused or impossible actions and 502 when Ollama is down", async () => {
    const app = appWith(setup({ installed: ["qwen3:4b-instruct-2507-q4_K_M"] }));
    const notThere = await app.inject({ method: "POST", url: "/api/models/local/measure", payload: { tag: "qwen3:8b" } });
    expect([notThere.statusCode, notThere.json().code]).toEqual([409, "NOT_INSTALLED"]);
    const inUse = await app.inject({ method: "DELETE", url: "/api/models/local?tag=qwen3:4b-instruct-2507-q4_K_M" });
    expect([inUse.statusCode, inUse.json().code]).toEqual([409, "REFUSED"]);
    const down = await appWith(setup({ down: true })).inject({ method: "POST", url: "/api/models/local/measure", payload: { tag: "qwen3:8b" } });
    expect([down.statusCode, down.json().code]).toEqual([502, "OLLAMA"]);
  });
});
