// The local model list for Settings and the first-run setup (PLAN §13.2, Milestone 7, step 7.2).
// Every number comes from Ollama: download sizes are built into the catalog (models.ts, copied from
// Ollama's registry by a developer tool; the app never contacts ollama.com), and everything else
// comes from the user's own local Ollama on 127.0.0.1: installed models (/api/tags), thinking
// support (/api/show) and the memory a model uses (/api/ps after loading it once, "measuring").
// Measurements are saved per model tag. Nothing here leaves the user's computer.
//
//   GET    /api/models/local               → LocalModelsView
//   POST   /api/models/local/measure       { tag } → { measured } (loads the model once)
//   DELETE /api/models/local?tag=…         removes a downloaded model from Ollama

import { totalmem } from "node:os";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiError } from "./app";
import { errorMessage } from "./health";
import { CATALOG, catalogEntry, fitOf, MODEL_TAG, tierOf, type BuiltInSizes, type Catalog, type Fit, type Measured, type Tier } from "./models";
import { ollamaRoot } from "./ollama";
import type { Settings } from "./settings";

// ---------- the local Ollama ----------

export interface InstalledModel {
  tag: string;
  /** Bytes on disk, as Ollama lists them (all of the model's files). */
  bytes: number;
  parameters: string | null;
  quantization: string | null;
}

export interface RunningModel {
  tag: string;
  bytes: number;
  vramBytes: number;
  contextLength: number | null;
}

export interface OllamaModels {
  installed(): Promise<InstalledModel[]>;
  capabilities(tag: string): Promise<string[]>;
  running(): Promise<RunningModel[]>;
  /** Loads the model with this context size and keeps it for `keepAlive` (Ollama's format, e.g. "1m"). */
  load(tag: string, numCtx: number, keepAlive: string | number): Promise<void>;
  remove(tag: string): Promise<void>;
}

const TagsSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string(),
        model: z.string().optional(),
        size: z.number().nonnegative(),
        remote_host: z.string().optional(),
        details: z.object({ parameter_size: z.string().optional(), quantization_level: z.string().optional() }).partial().optional(),
      }),
    )
    .default([]),
});
const ShowSchema = z.object({ capabilities: z.array(z.string()).default([]) });
const PsSchema = z.object({
  models: z
    .array(z.object({ name: z.string(), model: z.string().optional(), size: z.number().nonnegative(), size_vram: z.number().nonnegative().default(0), context_length: z.number().int().positive().optional() }))
    .default([]),
});

/** Ollama lists untagged models as "name:latest"; the catalog may write either. */
export const sameTag = (a: string, b: string) => {
  const full = (t: string) => (t.includes(":") ? t : `${t}:latest`);
  return full(a) === full(b);
};

export class OllamaError extends Error {}

export function ollamaModels(opts: { baseUrl: () => string; fetchImpl?: typeof fetch }): OllamaModels {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const call = async (path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<unknown> => {
    let res: Response;
    try {
      res = await fetchImpl(`${ollamaRoot(opts.baseUrl())}${path}`, {
        method: init.method ?? (init.body === undefined ? "GET" : "POST"),
        headers: init.body === undefined ? {} : { "content-type": "application/json" },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: AbortSignal.timeout(init.timeoutMs ?? 10_000),
      });
    } catch (err) {
      throw new OllamaError(`Can't reach Ollama (${errorMessage(err)}). Is the Ollama app open?`);
    }
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      let message = text.slice(0, 200);
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? message;
      } catch {
        /* plain text */
      }
      throw new OllamaError(`Ollama answered HTTP ${res.status}: ${message}`);
    }
    return text ? JSON.parse(text) : {};
  };

  return {
    async installed() {
      const tags = TagsSchema.parse(await call("/api/tags"));
      // Cloud models (remote_host) run on Ollama's servers: they use no memory here.
      return tags.models
        .filter((m) => !m.remote_host)
        .map((m) => ({ tag: m.name, bytes: m.size, parameters: m.details?.parameter_size ?? null, quantization: m.details?.quantization_level ?? null }));
    },
    async capabilities(tag) {
      return ShowSchema.parse(await call("/api/show", { body: { model: tag } })).capabilities;
    },
    async running() {
      return PsSchema.parse(await call("/api/ps")).models.map((m) => ({ tag: m.model ?? m.name, bytes: m.size, vramBytes: m.size_vram, contextLength: m.context_length ?? null }));
    },
    async load(tag, numCtx, keepAlive) {
      // A request without a prompt only loads the model (Ollama's documented "Load model" call).
      await call("/api/generate", { body: { model: tag, stream: false, keep_alive: keepAlive, options: { num_ctx: numCtx } }, timeoutMs: 10 * 60_000 });
    },
    async remove(tag) {
      await call("/api/delete", { method: "DELETE", body: { model: tag } });
    },
  };
}

// ---------- thinking ----------

/**
 * The `think` value for a model: the catalog's choice, sent only when Ollama says the model can
 * think. Unknown models and models without thinking get nothing (the model's own default).
 * /api/show answers are kept per tag; a failed one is asked again next time.
 */
export function thinkSetting(ollama: Pick<OllamaModels, "capabilities">, catalog: Catalog = CATALOG) {
  const known = new Map<string, Promise<string[]>>();
  return async (tag: string): Promise<boolean | undefined> => {
    const entry = catalogEntry(tag, catalog);
    if (!entry) return undefined;
    let caps = known.get(tag);
    if (!caps) {
      caps = ollama.capabilities(tag);
      known.set(tag, caps);
      caps.catch(() => known.delete(tag));
    }
    return (await caps.catch(() => [] as string[])).includes("thinking") ? entry.think : undefined;
  };
}

// ---------- the list ----------

export interface LocalModel {
  tag: string;
  name: string;
  family: string | null;
  note: string | null;
  default: boolean;
  /** In BreadPilot's reviewed list (false = another model the user downloaded). */
  inCatalog: boolean;
  installed: boolean;
  /** Bytes on disk (installed models). */
  installedBytes: number | null;
  /** Ollama's sizes built into the catalog (catalog models); null for other downloaded models. */
  sizes: BuiltInSizes | null;
  parameters: string | null;
  quantization: string | null;
  tier: Tier | null;
  measured: Measured | null;
  fit: Fit;
  selected: boolean;
}

export interface LocalModelsView {
  totalMemoryBytes: number;
  numCtx: number;
  selected: string;
  /** null = Ollama answered; else why the installed models are unknown. */
  ollamaError: string | null;
  models: LocalModel[];
  /** Installed models that aren't in the catalog (the search model is left out). */
  others: LocalModel[];
}

export interface LocalModelDeps {
  settings: { get(): Settings };
  /** Saves through the settings queue (settings-routes' update). */
  update(fn: (s: Settings) => Settings): Promise<void>;
  ollama: OllamaModels;
  catalog?: Catalog;
  totalMemory?: () => number;
  now?: () => Date;
}

export function localModelService(deps: LocalModelDeps) {
  const catalog = deps.catalog ?? CATALOG;
  const totalMemory = deps.totalMemory ?? totalmem;
  const now = deps.now ?? (() => new Date());
  let measuring: string | null = null;

  const measuredFor = (s: Settings, tag: string): Measured | null => Object.entries(s.modelMemory).find(([t]) => sameTag(t, tag))?.[1] ?? null;

  async function list(): Promise<LocalModelsView> {
    const s = deps.settings.get();
    const totalBytes = totalMemory();
    const numCtx = s.local.numCtx;
    let installed: InstalledModel[] = [];
    let ollamaError: string | null = null;
    const inst = await deps.ollama.installed().catch((err: Error) => err);
    if (inst instanceof Error) ollamaError = inst.message;
    else installed = inst;
    const findInstalled = (tag: string) => installed.find((i) => sameTag(i.tag, tag));

    const models: LocalModel[] = catalog.models.map((m) => {
      const inst = findInstalled(m.tag);
      const measured = measuredFor(s, m.tag);
      const weights = m.ollama.weightsBytes;
      return {
        tag: m.tag,
        name: m.name,
        family: m.family,
        note: m.note ?? null,
        default: !!m.default,
        inCatalog: true,
        installed: !!inst,
        installedBytes: inst?.bytes ?? null,
        sizes: m.ollama,
        parameters: m.ollama.parameters ?? inst?.parameters ?? null,
        quantization: m.ollama.quantization ?? inst?.quantization ?? null,
        tier: tierOf(weights),
        measured,
        fit: fitOf({ totalBytes, weightsBytes: weights, measured, numCtx }),
        selected: sameTag(m.tag, s.local.model),
      };
    });

    const others: LocalModel[] = installed
      .filter((i) => !catalog.models.some((m) => sameTag(m.tag, i.tag)) && !sameTag(i.tag, s.local.embedModel))
      .map((i) => {
        const measured = measuredFor(s, i.tag);
        return {
          tag: i.tag,
          name: i.tag,
          family: null,
          note: null,
          default: false,
          inCatalog: false,
          installed: true,
          installedBytes: i.bytes,
          sizes: null,
          parameters: i.parameters,
          quantization: i.quantization,
          // Ollama's file size: the model's files (possibly with a vision part) must fit in memory.
          tier: tierOf(i.bytes),
          measured,
          fit: fitOf({ totalBytes, weightsBytes: i.bytes, measured, numCtx }),
          selected: sameTag(i.tag, s.local.model),
        };
      });

    return { totalMemoryBytes: totalBytes, numCtx, selected: s.local.model, ollamaError, models, others };
  }

  /** Loads the model once at the current context size and saves what /api/ps reports. */
  async function measure(tag: string): Promise<Measured> {
    if (measuring) throw new BusyError(`Already checking ${measuring}. Wait until it's done.`);
    measuring = tag;
    try {
      const s = deps.settings.get();
      const installed = await deps.ollama.installed();
      if (!installed.some((i) => sameTag(i.tag, tag))) throw new NotInstalledError(`${tag} isn't downloaded yet.`);
      // Keep it loaded for the user's time (so a project right after doesn't load it again), at
      // least long enough to read /api/ps; with "0 minutes" it's unloaded right after reading.
      const keep = s.local.keepAliveMin;
      await deps.ollama.load(tag, s.local.numCtx, `${Math.max(keep, 1)}m`);
      const run = (await deps.ollama.running()).find((r) => sameTag(r.tag, tag));
      if (!run) throw new OllamaError(`Ollama loaded ${tag} but doesn't list it as running. Try again.`);
      if (keep === 0) await deps.ollama.load(tag, s.local.numCtx, 0).catch(() => {});
      const measured: Measured = { bytes: run.bytes, numCtx: run.contextLength ?? s.local.numCtx, at: now().toISOString() };
      await deps.update((cur) => {
        const memory = Object.fromEntries(Object.entries(cur.modelMemory).filter(([t]) => !sameTag(t, tag)));
        return { ...cur, modelMemory: { ...memory, [tag]: measured } };
      });
      return measured;
    } finally {
      measuring = null;
    }
  }

  async function remove(tag: string): Promise<void> {
    const s = deps.settings.get();
    if (sameTag(tag, s.local.embedModel)) throw new RefusedError("This is the documentation-search model BreadPilot needs. It can't be removed here.");
    if (sameTag(tag, s.local.model)) throw new RefusedError("This model is in use. Pick another model first, then remove this one.");
    if (measuring && sameTag(measuring, tag)) throw new BusyError(`${tag} is being checked right now.`);
    await deps.ollama.remove(tag);
    if (measuredFor(s, tag)) {
      await deps.update((cur) => ({ ...cur, modelMemory: Object.fromEntries(Object.entries(cur.modelMemory).filter(([t]) => !sameTag(t, tag))) }));
    }
  }

  /** Models the download route may fetch: the catalog plus the two in Settings. */
  const downloadable = () => [...catalog.models.map((m) => m.tag), deps.settings.get().local.model, deps.settings.get().local.embedModel];

  return { list, measure, remove, downloadable, isMeasuring: () => measuring };
}
export type LocalModelService = ReturnType<typeof localModelService>;

export class BusyError extends Error {}
export class NotInstalledError extends Error {}
export class RefusedError extends Error {}

const TagBody = z.object({ tag: z.string().trim().regex(MODEL_TAG, "not an Ollama model tag") }).strict();

export function registerLocalModelRoutes(app: FastifyInstance, service: LocalModelService): void {
  const fail = (reply: { status(code: number): { send(body: ApiError): unknown } }, err: unknown) => {
    if (err instanceof BusyError) return reply.status(409).send({ code: "BUSY", message: err.message });
    if (err instanceof NotInstalledError) return reply.status(409).send({ code: "NOT_INSTALLED", message: err.message });
    if (err instanceof RefusedError) return reply.status(409).send({ code: "REFUSED", message: err.message });
    if (err instanceof OllamaError) return reply.status(502).send({ code: "OLLAMA", message: err.message });
    throw err;
  };

  app.get("/api/models/local", async () => service.list());

  app.post("/api/models/local/measure", async (req, reply) => {
    const body = TagBody.safeParse(req.body);
    if (!body.success) return reply.status(400).send({ code: "BAD_REQUEST", message: 'Send {"tag": "<ollama model>"}' } satisfies ApiError);
    try {
      return { measured: await service.measure(body.data.tag) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete<{ Querystring: { tag?: string } }>("/api/models/local", async (req, reply) => {
    const body = TagBody.safeParse({ tag: req.query.tag ?? "" });
    if (!body.success) return reply.status(400).send({ code: "BAD_REQUEST", message: "Add ?tag=<ollama model>." } satisfies ApiError);
    try {
      await service.remove(body.data.tag);
      return reply.status(204).send();
    } catch (err) {
      return fail(reply, err);
    }
  });
}
