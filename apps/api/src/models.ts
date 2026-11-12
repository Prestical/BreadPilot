// Local AI model list (PLAN §13.2, Milestone 7). The reviewed catalog in data/models/ollama.json says
// which models BreadPilot offers, how it uses them, and their sizes as built-in values (user's
// decision, 05/11/2026): copied from Ollama's registry manifests by `npm run check:models -- --write`
// (registryClient below, a developer tool), so the app itself never contacts ollama.com. The memory a
// model uses while running is measured on the user's computer by their local Ollama (/api/ps,
// local-models.ts). Nothing is estimated: before a model is measured the list only says "needs at
// least" the size of its weights file.

import { z } from "zod";
import catalogJson from "../../../data/models/ollama.json";

// ---------- catalog ----------

/**
 * Ollama model tags: "name", "name:tag" or "namespace/name:tag" (lower-case names; tags may use
 * upper case, as in "q4_K_M"). Strict, because a tag goes into a registry URL.
 */
export const MODEL_TAG = /^[a-z0-9][a-z0-9._-]{0,63}(?:\/[a-z0-9][a-z0-9._-]{0,63})?(?::[A-Za-z0-9][A-Za-z0-9._-]{0,127})?$/;

/** Ollama's numbers for one tag, built in (exact bytes from its registry manifest + config blob). */
const OllamaSizesSchema = z
  .object({
    downloadBytes: z.number().int().positive(),
    weightsBytes: z.number().int().positive(),
    visionBytes: z.number().int().nonnegative(),
    draftBytes: z.number().int().nonnegative(),
    parameters: z.string().max(20).nullable(),
    quantization: z.string().max(20).nullable(),
  })
  .strict()
  .refine((o) => o.weightsBytes + o.visionBytes + o.draftBytes <= o.downloadBytes, "the parts are bigger than the download");
export type BuiltInSizes = z.infer<typeof OllamaSizesSchema>;

const EntrySchema = z
  .object({
    tag: z.string().regex(MODEL_TAG, "not an Ollama model tag"),
    /** Shown in the list and the prompt bar. */
    name: z.string().trim().min(1).max(40),
    family: z.string().trim().min(1).max(40),
    /** Sent as Ollama's `think` field when the model supports thinking (7.2). */
    think: z.boolean(),
    default: z.boolean().optional(),
    note: z.string().trim().min(1).max(160).optional(),
    ollama: OllamaSizesSchema,
  })
  .strict();
export type CatalogEntry = z.infer<typeof EntrySchema>;

const CatalogSchema = z
  .object({
    format: z.literal(1),
    review: z.object({ status: z.enum(["reviewed", "draft"]), by: z.string(), date: z.string(), note: z.string().optional() }).strict(),
    /** When the built-in sizes were last compared with Ollama's registry. */
    sizesChecked: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    models: z.array(EntrySchema).min(1).max(60),
  })
  .strict()
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    c.models.forEach((m, i) => {
      if (seen.has(m.tag)) ctx.addIssue({ code: "custom", path: ["models", i, "tag"], message: `${m.tag} is listed twice` });
      seen.add(m.tag);
    });
    const defaults = c.models.filter((m) => m.default).length;
    if (defaults !== 1) ctx.addIssue({ code: "custom", path: ["models"], message: `exactly one model must be the default (found ${defaults})` });
  });
export type Catalog = z.infer<typeof CatalogSchema>;

export class CatalogError extends Error {}

/** Checks a catalog file; a draft catalog is refused unless `allowDraft` (tests). */
export function loadCatalog(json: unknown, opts: { allowDraft?: boolean } = {}): Catalog {
  const parsed = CatalogSchema.safeParse(json);
  if (!parsed.success) {
    throw new CatalogError(`data/models/ollama.json: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ")}`);
  }
  if (parsed.data.review.status === "draft" && !opts.allowDraft) throw new CatalogError("data/models/ollama.json is a draft: review it first.");
  return parsed.data;
}

/** The catalog shipped with the app. */
export const CATALOG: Catalog = loadCatalog(catalogJson);
export const DEFAULT_MODEL: CatalogEntry = CATALOG.models.find((m) => m.default)!;

export const catalogEntry = (tag: string, catalog: Catalog = CATALOG): CatalogEntry | undefined => catalog.models.find((m) => m.tag === tag);

// ---------- Ollama's registry (developer tool: check:models; the app doesn't call it) ----------

export const REGISTRY = "https://registry.ollama.ai";

/** Registry address of a tag: "qwen3:4b" → library/qwen3 + 4b; no tag = "latest". */
export function registryRef(tag: string): { repo: string; reference: string } {
  if (!MODEL_TAG.test(tag)) throw new Error(`Not an Ollama model tag: ${tag}`);
  const [name, reference = "latest"] = tag.split(":") as [string, string?];
  return { repo: name.includes("/") ? name : `library/${name}`, reference };
}

const LayerSchema = z.object({ mediaType: z.string(), digest: z.string().regex(/^sha256:[0-9a-f]{64}$/), size: z.number().int().nonnegative() });
const ManifestSchema = z.object({ schemaVersion: z.literal(2), config: LayerSchema, layers: z.array(LayerSchema).min(1).max(64) });

/** Sizes in bytes, exactly as Ollama's registry lists them. */
export interface ModelSizes {
  /** Everything `ollama pull` downloads (all layers + the config). */
  downloadBytes: number;
  /** The model weights (`image.model` layers): the least the model needs in memory. */
  weightsBytes: number;
  /** Vision part (`image.projector`), 0 if the model has none. */
  visionBytes: number;
  /** Draft model for faster answers (`image.draft`), 0 if none. */
  draftBytes: number;
  configDigest: string;
}

const kindOf = (mediaType: string) => mediaType.replace(/^application\/vnd\.ollama\.image\./, "");

export function parseManifest(json: unknown): ModelSizes {
  const m = ManifestSchema.parse(json);
  const sum = (kind: string) => m.layers.filter((l) => kindOf(l.mediaType) === kind).reduce((a, l) => a + l.size, 0);
  const weightsBytes = sum("model");
  if (weightsBytes === 0) throw new Error("The manifest has no model layer.");
  return {
    downloadBytes: m.layers.reduce((a, l) => a + l.size, m.config.size),
    weightsBytes,
    visionBytes: sum("projector"),
    draftBytes: sum("draft"),
    configDigest: m.config.digest,
  };
}

const ConfigSchema = z.object({ model_family: z.string().optional(), model_type: z.string().optional(), file_type: z.string().optional() });

/** Built-in values from what the registry says, in the catalog's shape. */
export const builtInFrom = (info: ModelSizes & ModelFacts): BuiltInSizes => ({
  downloadBytes: info.downloadBytes,
  weightsBytes: info.weightsBytes,
  visionBytes: info.visionBytes,
  draftBytes: info.draftBytes,
  parameters: info.parameters,
  quantization: info.quantization,
});

/**
 * The catalog file's layout (check:models --write): top fields on one line each, then one model per
 * two lines (its settings, then its built-in "ollama" values), so a refresh shows as a small diff.
 */
export function formatCatalog(json: { models: ({ ollama: unknown } & Record<string, unknown>)[] } & Record<string, unknown>): string {
  const { models, ...top } = json;
  const head = Object.entries(top).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  const lines = models.map((m, i) => {
    const { ollama, ...rest } = m;
    return `    ${JSON.stringify(rest).slice(0, -1)},\n      "ollama": ${JSON.stringify(ollama)} }${i < models.length - 1 ? "," : ""}`;
  });
  return `{\n${head.join("\n")}\n  "models": [\n${lines.join("\n")}\n  ]\n}\n`;
}

/** What the model's config blob says: parameter count ("4.0B") and quantisation ("Q4_K_M"). */
export interface ModelFacts {
  parameters: string | null;
  quantization: string | null;
  family: string | null;
}

export function parseConfig(json: unknown): ModelFacts {
  const c = ConfigSchema.parse(json);
  return { parameters: c.model_type ?? null, quantization: c.file_type ?? null, family: c.model_family ?? null };
}

export type RegistryInfo = ({ ok: true } & ModelSizes & ModelFacts) | { ok: false; message: string };

export interface RegistryClient {
  /** Sizes (and facts, when the config blob can be read) of a tag; never throws. */
  info(tag: string): Promise<RegistryInfo>;
}

const MAX_JSON_BYTES = 256 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Reads manifests from Ollama's registry (only the tag is sent). Answers are kept for a day;
 * failures aren't kept, so the next look tries again. Config blobs are served through Ollama's
 * storage (a redirect); if that fails the sizes are still returned, without the facts.
 */
export function registryClient(opts: { fetchImpl?: typeof fetch; now?: () => number; base?: string; timeoutMs?: number } = {}): RegistryClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const base = (opts.base ?? REGISTRY).replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const cache = new Map<string, { at: number; info: RegistryInfo }>();
  const running = new Map<string, Promise<RegistryInfo>>();

  const getJson = async (url: string, accept?: string): Promise<unknown> => {
    const res = await fetchImpl(url, { headers: accept ? { accept } : {}, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status === 404) throw new Error("ollama.com doesn't have this model.");
    if (!res.ok) throw new Error(`ollama.com answered HTTP ${res.status}.`);
    const text = await res.text();
    if (text.length > MAX_JSON_BYTES) throw new Error("ollama.com sent an unexpectedly large answer.");
    return JSON.parse(text);
  };

  const load = async (tag: string): Promise<RegistryInfo> => {
    let ref: { repo: string; reference: string };
    try {
      ref = registryRef(tag);
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
    let sizes: ModelSizes;
    try {
      sizes = parseManifest(await getJson(`${base}/v2/${ref.repo}/manifests/${encodeURIComponent(ref.reference)}`, "application/vnd.docker.distribution.manifest.v2+json"));
    } catch (err) {
      const msg = err instanceof z.ZodError || err instanceof SyntaxError ? "ollama.com sent a model description BreadPilot doesn't understand." : (err as Error).message;
      return { ok: false, message: /fetch failed|timeout|aborted/i.test(msg) ? "Can't reach ollama.com to read the model's size." : msg };
    }
    let facts: ModelFacts = { parameters: null, quantization: null, family: null };
    try {
      facts = parseConfig(await getJson(`${base}/v2/${ref.repo}/blobs/${sizes.configDigest}`));
    } catch {
      /* sizes are enough */
    }
    return { ok: true, ...sizes, ...facts };
  };

  return {
    async info(tag) {
      const hit = cache.get(tag);
      if (hit && now() - hit.at < DAY_MS) return hit.info;
      const pending = running.get(tag);
      if (pending) return pending;
      const job = load(tag).finally(() => running.delete(tag));
      running.set(tag, job);
      const info = await job;
      if (info.ok) cache.set(tag, { at: now(), info });
      return info;
    },
  };
}

// ---------- tiers and fit ----------

const GB = 1e9;

export type Tier = "small" | "medium" | "large";

/** Grouping in the list, from the weights' size as Ollama lists it. */
export const tierOf = (weightsBytes: number): Tier => (weightsBytes < 4 * GB ? "small" : weightsBytes < 10 * GB ? "medium" : "large");

/** BreadPilot's own memory while running (Electron + engine, measured in D0: 0.9-1 GB, PLAN §10). */
export const APP_BYTES = 1 * GB;

/** Room left for the system and other apps before a model counts as "tight". */
export const systemReserve = (totalBytes: number) => Math.max(4 * GB, totalBytes * 0.25);

/** What Ollama's /api/ps reported after loading the model on this computer. */
export interface Measured {
  bytes: number;
  numCtx: number;
  at: string;
}

export type FitKind = "fits" | "tight" | "too-big" | "unknown";
export interface Fit {
  kind: FitKind;
  /** One plain sentence for the list. */
  reason: string;
}

/** Model sizes the way ollama.com shows them (decimal GB). */
export const formatBytes = (bytes: number) => (bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);
/** Installed memory the way computers are sold ("16 GB" = 16 GiB). */
export const formatMemory = (bytes: number) => `${Math.round(bytes / 2 ** 30)} GB`;

/**
 * Does a model fit this computer? Only Ollama's numbers are used: a measurement at the current
 * context size decides fits/tight/too-big; without one, only "too big" can be said for sure (the
 * weights alone don't fit), otherwise it's checked after the download.
 */
export function fitOf(opts: { totalBytes: number; weightsBytes: number | null; measured?: Measured | null; numCtx: number }): Fit {
  const { totalBytes, weightsBytes, measured, numCtx } = opts;
  const has = `this computer has ${formatMemory(totalBytes)}`;
  if (measured && measured.numCtx === numCtx) {
    const need = measured.bytes + APP_BYTES;
    const uses = `Uses ${formatBytes(measured.bytes)} while running, plus about ${formatBytes(APP_BYTES)} for BreadPilot; ${has}.`;
    if (need <= totalBytes - systemReserve(totalBytes)) return { kind: "fits", reason: uses };
    if (need <= totalBytes) return { kind: "tight", reason: `${uses} Close other apps while it runs.` };
    return { kind: "too-big", reason: `${uses} It may be very slow or not start.` };
  }
  if (weightsBytes !== null && weightsBytes + APP_BYTES > totalBytes) {
    return { kind: "too-big", reason: `The model alone is ${formatBytes(weightsBytes)}; ${has}.` };
  }
  if (measured) return { kind: "unknown", reason: `Measured with a context of ${measured.numCtx} tokens; check its memory again for ${numCtx}.` };
  if (weightsBytes === null) return { kind: "unknown", reason: "Size unknown: its memory is checked after the download." };
  return { kind: "unknown", reason: `Needs at least ${formatBytes(weightsBytes)}; the exact memory is checked after the download.` };
}
