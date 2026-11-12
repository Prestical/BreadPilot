// The app's settings (PLAN §19.2): AI models, the OpenAI key, Browser access. The desktop app keeps
// them in settings.enc, encrypted with the same OS-protected key as the database; the development
// server starts from .env and keeps changes in memory. The OpenAI key never leaves this module in an
// answer: views show only whether it's set and its last 4 characters.

import { open, readFile, rename, rm } from "node:fs/promises";
import { z } from "zod";
import { REASONING_EFFORTS } from "./agent/llm";
import type { Config } from "./config";
import { openBox, sealBox } from "./secretbox";

const MAGIC = "BPST1";

const httpUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//.test(u), "must start with http:// or https://");
const modelName = z.string().trim().min(1).max(200);

const LocalSchema = z.object({
  /** Ollama's OpenAI-compatible address. */
  baseUrl: httpUrl,
  model: modelName,
  embedModel: modelName,
  numCtx: z.number().int().min(2048).max(131072),
  /** Minutes Ollama keeps the model in memory after a request (0 = free it at once). */
  keepAliveMin: z.number().int().min(0).max(60),
});
const OpenAiSchema = z.object({
  model: modelName,
  reasoningEffort: z.enum(REASONING_EFFORTS),
  /** "" = not set. Only through setOpenAiKey, never through a settings update. */
  apiKey: z.string(),
});
const BrowserSchema = z.object({
  enabled: z.boolean(),
  port: z.number().int().min(1024).max(65535),
});
/**
 * Memory a local model used on this computer, as Ollama's /api/ps reported it after loading it
 * (PLAN §13.2). Kept per model tag; written only by the engine, never through a settings update.
 */
export const MeasuredSchema = z.object({
  bytes: z.number().int().nonnegative(),
  numCtx: z.number().int().positive(),
  at: z.string().max(40),
});
const ModelMemorySchema = z.record(z.string().min(1).max(200), MeasuredSchema).refine((r) => Object.keys(r).length <= 200, "too many measured models");

/** M11 11.6: the daily check for a new version (desktop app only; see updates.ts). */
const UpdatesSchema = z.object({
  check: z.boolean(),
  /** When GitHub last answered, and the newest version it named (null = no release yet). Engine only. */
  lastCheck: z.string().max(40).nullable(),
  latest: z.string().max(40).nullable(),
});

export const SettingsSchema = z.object({
  version: z.literal(1),
  local: LocalSchema,
  openai: OpenAiSchema,
  browserAccess: BrowserSchema,
  /** The first-run setup was finished or skipped (it isn't shown again). */
  setupDone: z.boolean(),
  /** The guided tour of the app was finished or skipped (it starts by itself only once). */
  tourDone: z.boolean(),
  /** Measured memory per local model tag (engine only). */
  modelMemory: ModelMemorySchema,
  updates: UpdatesSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;

/** What PUT /api/settings accepts: any part of the settings except the key (unknown fields are refused). */
export const SettingsPatchSchema = z
  .object({
    local: LocalSchema.partial().strict().optional(),
    openai: OpenAiSchema.omit({ apiKey: true }).partial().strict().optional(),
    browserAccess: BrowserSchema.partial().strict().optional(),
    setupDone: z.boolean().optional(),
    tourDone: z.boolean().optional(),
    updates: z.object({ check: z.boolean() }).partial().strict().optional(),
  })
  .strict();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

/**
 * OpenAI secret keys: "sk-" then letters, digits, "-" and "_" ("sk-proj-…", "sk-svcacct-…").
 * Checked so a pasted sentence or a half-copied key is caught before it's saved.
 */
export const OPENAI_KEY = /^sk-[A-Za-z0-9_-]{20,400}$/;

/** `withKey`/`setupDone`: the development server takes the key from .env and skips the first-run setup and tour. */
export function defaultSettings(config: Config, opts: { withKey: boolean; setupDone?: boolean }): Settings {
  return {
    version: 1,
    // The model takes 4-5 GB of memory while loaded: freed after a minute without requests.
    local: { baseUrl: config.LLM_BASE_URL, model: config.LLM_MODEL, embedModel: config.EMBED_MODEL, numCtx: config.LLM_NUM_CTX, keepAliveMin: 1 },
    openai: { model: config.OPENAI_MODEL, reasoningEffort: config.OPENAI_REASONING_EFFORT, apiKey: opts.withKey ? config.OPENAI_API_KEY.trim() : "" },
    browserAccess: { enabled: false, port: 8080 },
    setupDone: opts.setupDone ?? false,
    tourDone: opts.setupDone ?? false,
    modelMemory: {},
    updates: { check: true, lastCheck: null, latest: null },
  };
}

export function applyPatch(s: Settings, patch: SettingsPatch): Settings {
  return {
    ...s,
    local: { ...s.local, ...patch.local },
    openai: { ...s.openai, ...patch.openai },
    browserAccess: { ...s.browserAccess, ...patch.browserAccess },
    setupDone: patch.setupDone ?? s.setupDone,
    tourDone: patch.tourDone ?? s.tourDone,
    modelMemory: s.modelMemory,
    updates: { ...s.updates, ...patch.updates },
  };
}

/** The settings as the page sees them: no key, only whether one is set and how it ends. */
export interface SettingsView {
  local: Settings["local"];
  openai: { model: string; reasoningEffort: Settings["openai"]["reasoningEffort"]; keySet: boolean; keyHint: string | null; keyRefused: string | null };
  browserAccess: Settings["browserAccess"] & { url: string | null; pairingUrl: string | null; error: string | null };
  setupDone: boolean;
  tourDone: boolean;
  /** The desktop app's operating system ("darwin", "win32", "linux"), for "Your data and keys"; null for the development server. */
  dataHome: string | null;
  /** M11: the daily check for a new version; `version` = this app's (null in development: no check). */
  updates: { check: boolean; version: string | null };
}

export function viewOf(
  s: Settings,
  browser: { url: string | null; pairingUrl: string | null; error: string | null },
  keyRefused: string | null = null,
  dataHome: string | null = null,
  appVersion: string | null = null,
): SettingsView {
  const key = s.openai.apiKey;
  return {
    local: s.local,
    openai: { model: s.openai.model, reasoningEffort: s.openai.reasoningEffort, keySet: key !== "", keyHint: key ? `…${key.slice(-4)}` : null, keyRefused },
    browserAccess: { ...s.browserAccess, ...browser },
    setupDone: s.setupDone,
    tourDone: s.tourDone,
    dataHome,
    updates: { check: s.updates.check, version: appVersion },
  };
}

export interface SettingsStore {
  get(): Settings;
  set(next: Settings): Promise<void>;
  /** Why no OpenAI key can be stored on this computer (null = it can). */
  readonly keyRefused?: string | null;
}

/** Development: starts from .env, changes last until the server stops. */
export function memorySettings(initial: Settings): SettingsStore {
  let current = SettingsSchema.parse(initial);
  return {
    get: () => current,
    set: async (next) => {
      current = SettingsSchema.parse(next);
    },
  };
}

export class SettingsFileError extends Error {}

/**
 * Desktop: settings.enc (AES-256-GCM, 0600, temp file + rename). Missing file = defaults, written on
 * the first change. With `keyRefused` (the operating system can't protect the file's key) no OpenAI
 * key is kept: one already stored is dropped from the file, and none is ever written.
 */
export async function fileSettings(opts: { file: string; key: Uint8Array; defaults: Settings; keyRefused?: string | null }): Promise<SettingsStore> {
  const { file, key, defaults } = opts;
  const keyRefused = opts.keyRefused ?? null;
  const withoutKey = (x: Settings): Settings => (keyRefused ? { ...x, openai: { ...x.openai, apiKey: "" } } : x);
  let current = SettingsSchema.parse(defaults);
  const raw = await readFile(file).catch((err: NodeJS.ErrnoException) => (err.code === "ENOENT" ? null : Promise.reject(err)));
  if (raw) {
    let stored: unknown;
    try {
      stored = JSON.parse(openBox(key, MAGIC, raw).toString("utf8"));
    } catch (err) {
      throw new SettingsFileError(`The settings file can't be read (${(err as Error).message}). It was not changed: ${file}`);
    }
    // Settings added in a later version get their defaults; anything invalid falls back too.
    const s = stored as Partial<Settings>;
    const merged = {
      ...current,
      ...(typeof s.setupDone === "boolean" ? { setupDone: s.setupDone } : {}),
      ...(typeof s.tourDone === "boolean" ? { tourDone: s.tourDone } : {}),
      // Measurements are only a convenience: a damaged list is dropped, not a reason to lose settings.
      ...(ModelMemorySchema.safeParse(s.modelMemory).success ? { modelMemory: s.modelMemory } : {}),
      ...(UpdatesSchema.safeParse({ ...current.updates, ...s.updates }).success ? { updates: { ...current.updates, ...s.updates } } : {}),
      local: { ...current.local, ...s.local },
      openai: { ...current.openai, ...s.openai },
      browserAccess: { ...current.browserAccess, ...s.browserAccess },
    };
    const parsed = SettingsSchema.safeParse(merged);
    if (parsed.success) current = parsed.data;
  }
  const store: SettingsStore = {
    keyRefused,
    get: () => current,
    async set(next) {
      const valid = withoutKey(SettingsSchema.parse(next));
      const tmp = `${file}.tmp`;
      try {
        const fh = await open(tmp, "w", 0o600);
        try {
          await fh.writeFile(sealBox(key, MAGIC, Buffer.from(JSON.stringify(valid))));
          await fh.sync();
        } finally {
          await fh.close();
        }
        await rename(tmp, file);
      } catch (err) {
        await rm(tmp, { force: true }).catch(() => {});
        throw err;
      }
      current = valid;
    },
  };
  if (keyRefused && current.openai.apiKey) await store.set(current);
  return store;
}

export class PortInUseError extends Error {
  constructor(public port: number) {
    super(`Port ${port} is already used by another program. Choose another port.`);
  }
}

export interface KeyCheck {
  ok: boolean;
  message: string;
}

/** Asks OpenAI whether a key works (GET /models). Never repeats the key in the answer. */
export async function checkOpenAiKey(baseUrl: string, key: string, model: string, fetchImpl: typeof fetch = fetch): Promise<KeyCheck> {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl.replace(/\/$/, "")}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  } catch {
    return { ok: false, message: "Couldn't reach OpenAI. Check your internet connection." };
  }
  if (res.status === 401) return { ok: false, message: "OpenAI rejected this key. Check that you copied all of it, and that it hasn't been revoked." };
  if (res.status === 429) return { ok: false, message: "OpenAI accepted the key but refused the request: the account may be out of credit, or too many requests were made." };
  if (!res.ok) return { ok: false, message: `OpenAI answered HTTP ${res.status}. Try again in a moment.` };
  const body = (await res.json().catch(() => null)) as { data?: { id: string }[] } | null;
  const ids = (body?.data ?? []).map((m) => m.id);
  if (ids.length && !ids.includes(model)) return { ok: true, message: `The key works, but it can't use ${model}. Pick another OpenAI model below.` };
  return { ok: true, message: "The key works." };
}
