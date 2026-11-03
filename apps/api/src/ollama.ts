// Downloading Ollama models from the app (PLAN §19.4, D5), so nobody needs the Terminal for
// `ollama pull`. Ollama streams the download as JSON lines ({status, digest, total, completed});
// this keeps one state per model for the page to poll.

import type { FastifyInstance } from "fastify";
import type { ApiError } from "./app";

export interface PullState {
  model: string;
  status: "pulling" | "done" | "error";
  /** Bytes so far / in total over all layers (0 until Ollama knows the sizes). */
  completed: number;
  total: number;
  /** Ollama's last step ("pulling manifest", "verifying sha256 digest", …) or the error. */
  message: string;
}

/** Ollama's own API lives next to its OpenAI-compatible /v1. */
export const ollamaRoot = (baseUrl: string) => baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "");

export interface Puller {
  /** Starts downloading `model` (or returns the download already running). */
  start(model: string): PullState;
  list(): PullState[];
  /** Stops every running download (the app is closing). */
  stop(): void;
}

export function ollamaPuller(opts: { baseUrl: () => string; onDone?: (model: string) => void; fetchImpl?: typeof fetch }): Puller {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const pulls = new Map<string, PullState>();
  const controllers = new Set<AbortController>();

  const run = async (state: PullState) => {
    const controller = new AbortController();
    controllers.add(controller);
    const fail = (message: string) => Object.assign(state, { status: "error", message });
    try {
      const res = await fetchImpl(`${ollamaRoot(opts.baseUrl())}/api/pull`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: state.model, stream: true }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) return fail(`Ollama answered HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
      // Sizes per layer: the download is the sum of all layers.
      const totals = new Map<string, number>();
      const done = new Map<string, number>();
      let buffer = "";
      const decoder = new TextDecoder();
      const handle = (line: string) => {
        if (!line.trim()) return;
        let msg: { status?: string; digest?: string; total?: number; completed?: number; error?: string };
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (msg.error) return fail(msg.error);
        if (msg.digest && msg.total) {
          totals.set(msg.digest, msg.total);
          done.set(msg.digest, msg.completed ?? 0);
          state.total = [...totals.values()].reduce((a, b) => a + b, 0);
          state.completed = [...done.values()].reduce((a, b) => a + b, 0);
        }
        if (msg.status) state.message = msg.status;
        if (msg.status === "success") {
          state.status = "done";
          state.completed = state.total;
        }
      };
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        lines.forEach(handle);
        if (state.status === "error") break;
      }
      handle(buffer);
      if (state.status === "pulling") fail("The download stopped before it finished. Try again.");
      if (state.status === "done") opts.onDone?.(state.model);
    } catch (err) {
      if (!controller.signal.aborted) fail(`Can't reach Ollama: ${(err as Error).message}. Is the Ollama app open?`);
      else fail("Stopped.");
    } finally {
      controllers.delete(controller);
    }
  };

  return {
    start(model) {
      const current = pulls.get(model);
      if (current?.status === "pulling") return current;
      const state: PullState = { model, status: "pulling", completed: 0, total: 0, message: "starting" };
      pulls.set(model, state);
      void run(state);
      return state;
    },
    list: () => [...pulls.values()].map((p) => ({ ...p })),
    stop() {
      controllers.forEach((c) => c.abort());
    },
  };
}

/**
 *   GET  /api/ollama/pulls   → { pulls: PullState[] }
 *   POST /api/ollama/pull    { model } → 202 PullState. Only the two models in Settings can be
 *                            downloaded (the chat model and the documentation-search model).
 */
export function registerOllamaRoutes(app: FastifyInstance, deps: { puller: Puller; models: () => string[] }): void {
  app.get("/api/ollama/pulls", async () => ({ pulls: deps.puller.list() }));
  app.post<{ Body: { model?: unknown } }>("/api/ollama/pull", async (req, reply) => {
    const model = typeof req.body?.model === "string" ? req.body.model.trim() : "";
    if (!deps.models().includes(model)) {
      return reply.status(400).send({ code: "UNKNOWN_MODEL", message: `Only the models in Settings can be downloaded here: ${deps.models().join(", ")}.` } satisfies ApiError);
    }
    return reply.status(202).send(deps.puller.start(model));
  });
}
