// Settings routes for the Settings screen. Answers never contain the OpenAI key (only "set" and its
// last 4 characters); the key comes in through its own route and is checked before it's saved.
//
//   GET    /api/settings                    → SettingsView
//   PUT    /api/settings                    { local?, openai?: { model?, reasoningEffort? }, browserAccess? }
//   PUT    /api/settings/openai-key         { key }   (saved only if OpenAI accepts it and the
//                                                       computer can protect it: 409 KEY_STORAGE)
//   DELETE /api/settings/openai-key
//   POST   /api/settings/openai-key/test    { key? }  (the given key, else the saved one)

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiError } from "./app";
import { applyPatch, checkOpenAiKey, OPENAI_KEY, PortInUseError, SettingsPatchSchema, viewOf, type KeyCheck, type Settings, type SettingsStore } from "./settings";

export interface SettingsRouteDeps {
  settings: SettingsStore;
  openAiBaseUrl: string;
  /** Browser access as it is right now. */
  browser(): { url: string | null; pairingUrl: string | null; error: string | null };
  /** Puts new settings into effect before they're saved; throws to refuse them. */
  apply(next: Settings, prev: Settings): Promise<void>;
  /** The desktop app's operating system (Settings explains where the data and keys are); null for the development server. */
  dataHome?: string | null;
  /** For tests: OpenAI's /models check. */
  checkKey?: (key: string, model: string) => Promise<KeyCheck>;
}

const KeyBody = z.object({ key: z.string() }).strict();
const TestBody = z.object({ key: z.string().optional() }).strict();

const badKey = (key: string): string | null =>
  OPENAI_KEY.test(key) ? null : 'That doesn\'t look like an OpenAI secret key. It starts with "sk-" and has no spaces; copy it again from platform.openai.com.';

export interface SettingsWriter {
  /**
   * Changes the settings from code (e.g. a measured model size) in the same queue as the Settings
   * screen's saves, so neither overwrites the other. `fn` gets the settings current at that moment.
   */
  update(fn: (current: Settings) => Settings): Promise<void>;
}

export function registerSettingsRoutes(app: FastifyInstance, deps: SettingsRouteDeps): SettingsWriter {
  const view = () => viewOf(deps.settings.get(), deps.browser(), deps.settings.keyRefused ?? null, deps.dataHome ?? null);
  const check = (key: string) => (deps.checkKey ?? ((k, m) => checkOpenAiKey(deps.openAiBaseUrl, k, m)))(key, deps.settings.get().openai.model);

  // One change at a time: two quick saves must not apply in one order and store in the other.
  let queue: Promise<unknown> = Promise.resolve();
  const change = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  };
  const commit = async (next: Settings) => {
    const prev = deps.settings.get();
    await deps.apply(next, prev);
    try {
      await deps.settings.set(next);
    } catch (err) {
      await deps.apply(prev, next).catch(() => {});
      throw err;
    }
  };
  const save = (next: Settings) => change(() => commit(next));

  app.get("/api/settings", async () => view());

  app.put("/api/settings", async (req, reply) => {
    const body = SettingsPatchSchema.safeParse(req.body ?? {});
    if (!body.success) {
      const issue = body.error.issues[0];
      return reply.status(400).send({ code: "BAD_SETTINGS", message: `${issue?.path.join(".") || "settings"}: ${issue?.message}`, details: body.error.issues } satisfies ApiError);
    }
    try {
      await save(applyPatch(deps.settings.get(), body.data));
    } catch (err) {
      if (err instanceof PortInUseError) return reply.status(409).send({ code: "PORT_IN_USE", message: err.message } satisfies ApiError);
      throw err;
    }
    return view();
  });

  app.put("/api/settings/openai-key", async (req, reply) => {
    const body = KeyBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ code: "BAD_REQUEST", message: 'Send {"key": "sk-..."}' } satisfies ApiError);
    if (deps.settings.keyRefused) return reply.status(409).send({ code: "KEY_STORAGE", message: deps.settings.keyRefused } satisfies ApiError);
    const key = body.data.key.trim();
    const problem = badKey(key);
    if (problem) return reply.status(400).send({ code: "BAD_KEY", message: problem } satisfies ApiError);
    const result = await check(key);
    if (!result.ok) return reply.status(422).send({ code: "KEY_REFUSED", message: result.message } satisfies ApiError);
    const s = deps.settings.get();
    await save({ ...s, openai: { ...s.openai, apiKey: key } });
    return { ...view(), check: result };
  });

  app.delete("/api/settings/openai-key", async () => {
    const s = deps.settings.get();
    await save({ ...s, openai: { ...s.openai, apiKey: "" } });
    return view();
  });

  app.post("/api/settings/openai-key/test", async (req, reply) => {
    const body = TestBody.safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send({ code: "BAD_REQUEST", message: 'Send {"key": "sk-..."} or nothing' } satisfies ApiError);
    const key = body.data.key?.trim() || deps.settings.get().openai.apiKey;
    if (!key) return reply.status(400).send({ code: "NO_KEY", message: "No OpenAI key to test yet." } satisfies ApiError);
    const problem = badKey(key);
    if (problem) return { ok: false, message: problem } satisfies KeyCheck;
    return check(key);
  });

  return { update: (fn) => change(() => commit(fn(deps.settings.get()))) };
}
