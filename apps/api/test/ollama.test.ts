// Model downloads from the app (D5): Ollama's /api/pull stream turned into progress, and the route
// that only allows the models in Settings.
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import * as z from "zod/v4";
import { createLlm } from "../src/agent/llm";
import { ollamaPuller, ollamaRoot, registerOllamaRoutes, type PullState } from "../src/ollama";

/** A fake Ollama answering /api/pull with these JSON lines, split at odd places like a real stream. */
function fakeOllama(lines: object[], opts: { status?: number; cutOff?: boolean } = {}) {
  const calls: { url: string; body: unknown }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const text = lines.map((l) => JSON.stringify(l)).join("\n") + (opts.cutOff ? "" : "\n");
    const bytes = new TextEncoder().encode(text);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    });
    return new Response(body, { status: opts.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe("ollamaPuller", () => {
  it("adds up the layers' progress and finishes on success", async () => {
    const { impl, calls } = fakeOllama([
      { status: "pulling manifest" },
      { status: "pulling aaa", digest: "aaa", total: 1000, completed: 0 },
      { status: "pulling aaa", digest: "aaa", total: 1000, completed: 600 },
      { status: "pulling bbb", digest: "bbb", total: 200, completed: 200 },
      { status: "pulling aaa", digest: "aaa", total: 1000, completed: 1000 },
      { status: "verifying sha256 digest" },
      { status: "success" },
    ]);
    const done = vi.fn();
    const puller = ollamaPuller({ baseUrl: () => "http://localhost:11434/v1", onDone: done, fetchImpl: impl });
    const first = puller.start("qwen3:4b");
    expect(first.status).toBe("pulling");
    expect(puller.start("qwen3:4b")).toBe(first); // a second click doesn't start a second download
    await until(() => puller.list()[0]!.status !== "pulling");
    expect(puller.list()).toEqual<PullState[]>([{ model: "qwen3:4b", status: "done", completed: 1200, total: 1200, message: "success" }]);
    expect(calls).toEqual([{ url: "http://localhost:11434/api/pull", body: { model: "qwen3:4b", stream: true } }]);
    expect(done).toHaveBeenCalledWith("qwen3:4b");
  });

  it("reports Ollama's error, a cut-off download and an unreachable Ollama", async () => {
    const bad = ollamaPuller({ baseUrl: () => "http://x/v1", fetchImpl: fakeOllama([{ status: "pulling manifest" }, { error: "pull model manifest: file does not exist" }]).impl });
    bad.start("nope");
    await until(() => bad.list()[0]!.status !== "pulling");
    expect(bad.list()[0]).toMatchObject({ status: "error", message: "pull model manifest: file does not exist" });

    const cut = ollamaPuller({ baseUrl: () => "http://x/v1", fetchImpl: fakeOllama([{ status: "pulling aaa", digest: "aaa", total: 10, completed: 5 }], { cutOff: true }).impl });
    cut.start("m");
    await until(() => cut.list()[0]!.status !== "pulling");
    expect(cut.list()[0]).toMatchObject({ status: "error", message: "The download stopped before it finished. Try again." });

    const off = ollamaPuller({
      baseUrl: () => "http://x/v1",
      fetchImpl: (async () => {
        throw new Error("fetch failed");
      }) as unknown as typeof fetch,
    });
    off.start("m");
    await until(() => off.list()[0]!.status !== "pulling");
    expect(off.list()[0]!.message).toMatch(/Can't reach Ollama.*Is the Ollama app open\?/);
  });

  it("finds Ollama's own API next to /v1", () => {
    expect(ollamaRoot("http://localhost:11434/v1")).toBe("http://localhost:11434");
    expect(ollamaRoot("http://localhost:11434/v1/")).toBe("http://localhost:11434");
    expect(ollamaRoot("http://box:11434")).toBe("http://box:11434");
  });
});

describe("download routes", () => {
  it("download only the models in Settings and list progress", async () => {
    const started: string[] = [];
    const app = Fastify();
    registerOllamaRoutes(app, {
      puller: { start: (m) => (started.push(m), { model: m, status: "pulling", completed: 0, total: 0, message: "starting" }), list: () => [], stop: () => {} },
      models: () => ["qwen3:4b", "nomic-embed-text"],
    });
    expect((await app.inject({ method: "POST", url: "/api/ollama/pull", payload: { model: "nomic-embed-text" } })).statusCode).toBe(202);
    const other = await app.inject({ method: "POST", url: "/api/ollama/pull", payload: { model: "llama3:70b" } });
    expect(other.statusCode).toBe(400);
    expect(other.json().code).toBe("UNKNOWN_MODEL");
    expect((await app.inject({ method: "POST", url: "/api/ollama/pull", payload: {} })).statusCode).toBe(400);
    expect(started).toEqual(["nomic-embed-text"]);
    expect((await app.inject({ url: "/api/ollama/pulls" })).json()).toEqual({ pulls: [] });
  });
});

describe("keep_alive", () => {
  it("tells Ollama how long to keep the model in memory (the Settings value)", async () => {
    let sent: { keep_alive?: string } = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ message: { content: "{}" } }), { status: 200 });
    }) as unknown as typeof fetch;
    const llm = createLlm({ api: "ollama", baseUrl: "http://x/v1", model: "m", numCtx: 4096, temperature: 0, timeoutMs: 1000, keepAlive: "1m", fetchImpl });
    await llm.json(z.object({}), [{ role: "user", content: "hi" }]);
    expect(sent.keep_alive).toBe("1m");
  });
});
