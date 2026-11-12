// Local AI model list (Milestone 7, step 7.1): the reviewed catalog with its built-in sizes, Ollama's
// registry manifests (real ones saved in fixtures/ollama-registry, 04/11/2026; read only by the
// check:models developer tool) and the fit rules.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  APP_BYTES,
  builtInFrom,
  CATALOG,
  CatalogError,
  DEFAULT_MODEL,
  fitOf,
  formatBytes,
  formatCatalog,
  formatMemory,
  loadCatalog,
  MODEL_TAG,
  parseConfig,
  parseManifest,
  registryClient,
  registryRef,
  systemReserve,
  tierOf,
} from "../src/models";
import { loadConfig } from "../src/config";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/ollama-registry/${name}`, import.meta.url), "utf8"));
const QWEN3_4B = fixture("qwen3_4b-instruct-2507-q4_K_M.manifest.json");
const QWEN3_4B_CONFIG = fixture("qwen3_4b-instruct-2507-q4_K_M.config.json");
const GEMMA4_E4B = fixture("gemma4_e4b.manifest.json");
const QWEN35_2B = fixture("qwen3.5_2b.manifest.json");

const GiB = 2 ** 30;
const MAC_16 = 16 * GiB;

describe("catalog", () => {
  it("ships a reviewed list whose default is today's local model", () => {
    expect(CATALOG.review.status).toBe("reviewed");
    expect(DEFAULT_MODEL.tag).toBe("qwen3:4b-instruct-2507-q4_K_M");
    // The built-in default (no .env) and the catalog's default must agree.
    expect(DEFAULT_MODEL.tag).toBe(loadConfig({}).LLM_MODEL);
    expect(CATALOG.models.every((m) => MODEL_TAG.test(m.tag))).toBe(true);
  });

  it("built-in sizes are Ollama's own numbers (equal to the real registry files), never typed or rounded", () => {
    const fromOllama = (manifest: unknown, config: unknown = {}) => builtInFrom({ ...parseManifest(manifest), ...parseConfig(config) });
    const entry = (tag: string) => CATALOG.models.find((m) => m.tag === tag)!.ollama;
    expect(entry("qwen3:4b-instruct-2507-q4_K_M")).toEqual(fromOllama(QWEN3_4B, QWEN3_4B_CONFIG));
    // The vision/draft fixtures have no saved config blob: compare the byte counts.
    const { parameters: _p, quantization: _q, ...gemma } = entry("gemma4:e4b");
    expect({ ...gemma, parameters: null, quantization: null }).toEqual(fromOllama(GEMMA4_E4B));
    expect(entry("qwen3.5:2b").downloadBytes).toBe(parseManifest(QWEN35_2B).downloadBytes);
    expect(CATALOG.sizesChecked).toMatch(/^2026-\d\d-\d\d$/);
    // Memory while running is never built in: it's measured on the user's computer.
    expect(CATALOG.models.flatMap((m) => Object.keys(m.ollama)).filter((k) => /^ram|memory|running/i.test(k))).toEqual([]);
  });

  it("check:models --write keeps the file exactly as it is laid out", () => {
    const text = readFileSync(new URL("../../../data/models/ollama.json", import.meta.url), "utf8");
    expect(formatCatalog(JSON.parse(text))).toBe(text);
  });

  const sizes = { downloadBytes: 5_225_388_164, weightsBytes: 5_225_374_496, visionBytes: 0, draftBytes: 0, parameters: "8.2B", quantization: "Q4_K_M" };
  const good = {
    format: 1,
    review: { status: "reviewed", by: "user", date: "2026-11-04" },
    sizesChecked: "2026-11-05",
    models: [{ tag: "qwen3:8b", name: "Qwen3 8B", family: "Qwen3", think: false, default: true, ollama: sizes }],
  };

  it("refuses broken catalogs with the field named", () => {
    const bad = (patch: (c: typeof good) => unknown) => () => loadCatalog(patch(structuredClone(good)));
    expect(bad((c) => ({ ...c, models: [...c.models, c.models[0]] }))).toThrow(/listed twice/);
    expect(bad((c) => ({ ...c, models: [{ ...c.models[0], default: false }] }))).toThrow(/exactly one model must be the default/);
    expect(bad((c) => ({ ...c, models: [{ ...c.models[0], tag: "qwen3:8b; rm -rf" }] }))).toThrow(/models\.0\.tag/);
    expect(bad((c) => ({ ...c, models: [{ ...c.models[0], sizeGb: 5 }] }))).toThrow(CatalogError);
    expect(bad((c) => ({ ...c, review: { ...c.review, status: "draft" } }))).toThrow(/draft/);
    expect(bad((c) => ({ ...c, models: [{ ...c.models[0], ollama: { ...sizes, visionBytes: 9e9 } }] }))).toThrow(/bigger than the download/);
    expect(bad((c) => ({ ...c, models: [{ ...c.models[0], ollama: { ...sizes, weightsBytes: 5.2 } }] }))).toThrow(/weightsBytes/);
    expect(bad((c) => ({ ...c, models: [{ ...c.models[0], ollama: undefined }] }))).toThrow(/ollama/);
    expect(bad((c) => ({ ...c, sizesChecked: "yesterday" }))).toThrow(/sizesChecked/);
    expect(loadCatalog({ ...good, review: { ...good.review, status: "draft" } }, { allowDraft: true }).models).toHaveLength(1);
  });
});

describe("registry addresses", () => {
  it("maps tags like ollama pull does", () => {
    expect(registryRef("qwen3:4b-instruct-2507-q4_K_M")).toEqual({ repo: "library/qwen3", reference: "4b-instruct-2507-q4_K_M" });
    expect(registryRef("gemma4")).toEqual({ repo: "library/gemma4", reference: "latest" });
    expect(registryRef("someone/model:v2")).toEqual({ repo: "someone/model", reference: "v2" });
  });

  it("refuses anything that could change the URL", () => {
    for (const bad of ["../etc", "qwen3:../../x", "a/b/c", "Qwen3", "qwen3:4b?x=1", "qwen3:4b#x", "", "qwen3 4b"]) {
      expect(() => registryRef(bad), bad).toThrow(/Not an Ollama model tag/);
    }
  });
});

describe("manifests (real files from registry.ollama.ai)", () => {
  it("text-only model: weights = the model layer, download = every layer + config", () => {
    const s = parseManifest(QWEN3_4B);
    expect(s.weightsBytes).toBe(2_497_280_480);
    expect(s.visionBytes).toBe(0);
    expect(s.draftBytes).toBe(0);
    expect(s.downloadBytes).toBe(2_497_280_480 + 1379 + 11338 + 119 + 487);
    expect(formatBytes(s.downloadBytes)).toBe("2.5 GB");
  });

  it("vision + draft model: the parts are counted apart", () => {
    const s = parseManifest(GEMMA4_E4B);
    expect(s.weightsBytes).toBe(5_493_439_296);
    expect(s.visionBytes).toBe(991_552_256);
    expect(s.draftBytes).toBe(98_653_280);
    expect(s.downloadBytes).toBeGreaterThan(s.weightsBytes + s.visionBytes + s.draftBytes);
    expect(formatBytes(s.downloadBytes)).toBe("6.6 GB");
    const q = parseManifest(QWEN35_2B);
    expect(q.visionBytes).toBeGreaterThan(0);
    expect(formatBytes(q.downloadBytes)).toBe("2.7 GB");
  });

  it("refuses manifests without weights or in an unknown shape", () => {
    expect(() => parseManifest({ ...QWEN3_4B, layers: QWEN3_4B.layers.filter((l: { mediaType: string }) => !l.mediaType.endsWith(".model")) })).toThrow(/no model layer/);
    expect(() => parseManifest({ schemaVersion: 1, layers: [] })).toThrow();
  });

  it("reads parameters and quantisation from the config blob", () => {
    expect(parseConfig(QWEN3_4B_CONFIG)).toEqual({ parameters: "4.0B", quantization: "Q4_K_M", family: "qwen3" });
    expect(parseConfig({})).toEqual({ parameters: null, quantization: null, family: null });
  });
});

/** A fake registry: manifests by "repo/reference", the config blob by digest. */
function fakeRegistry(opts: { manifests?: Record<string, unknown>; blobs?: Record<string, unknown>; fail?: boolean; status?: number } = {}) {
  const calls: { url: string; accept: string | null }[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, accept: new Headers(init?.headers).get("accept") });
    if (opts.fail) throw new TypeError("fetch failed");
    if (opts.status) return new Response("no", { status: opts.status });
    const m = /\/v2\/(.+)\/manifests\/(.+)$/.exec(url);
    if (m) {
      const body = opts.manifests?.[`${m[1]}/${decodeURIComponent(m[2]!)}`];
      return body ? new Response(JSON.stringify(body)) : new Response("{}", { status: 404 });
    }
    const b = /\/blobs\/(sha256:[0-9a-f]+)$/.exec(url);
    const blob = b && opts.blobs?.[b[1]!];
    return blob ? new Response(JSON.stringify(blob)) : new Response("gone", { status: 500 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("registryClient", () => {
  const manifests = { "library/qwen3/4b-instruct-2507-q4_K_M": QWEN3_4B };
  const blobs = { [QWEN3_4B.config.digest]: QWEN3_4B_CONFIG };

  it("reads sizes and facts, asks for the v2 manifest, and keeps the answer for a day", async () => {
    let t = 0;
    const { impl, calls } = fakeRegistry({ manifests, blobs });
    const client = registryClient({ fetchImpl: impl, now: () => t });
    const info = await client.info("qwen3:4b-instruct-2507-q4_K_M");
    expect(info).toMatchObject({ ok: true, weightsBytes: 2_497_280_480, parameters: "4.0B", quantization: "Q4_K_M" });
    expect(calls[0]).toEqual({ url: "https://registry.ollama.ai/v2/library/qwen3/manifests/4b-instruct-2507-q4_K_M", accept: "application/vnd.docker.distribution.manifest.v2+json" });
    expect(calls).toHaveLength(2);
    t = 23 * 3600_000;
    await client.info("qwen3:4b-instruct-2507-q4_K_M");
    expect(calls).toHaveLength(2);
    t = 25 * 3600_000;
    await client.info("qwen3:4b-instruct-2507-q4_K_M");
    expect(calls).toHaveLength(4);
  });

  it("asks once when the list asks for the same model twice at the same time", async () => {
    const { impl, calls } = fakeRegistry({ manifests, blobs });
    const client = registryClient({ fetchImpl: impl });
    await Promise.all([client.info("qwen3:4b-instruct-2507-q4_K_M"), client.info("qwen3:4b-instruct-2507-q4_K_M")]);
    expect(calls).toHaveLength(2);
  });

  it("still gives the sizes when the config blob can't be read", async () => {
    const { impl } = fakeRegistry({ manifests });
    const info = await registryClient({ fetchImpl: impl }).info("qwen3:4b-instruct-2507-q4_K_M");
    expect(info).toMatchObject({ ok: true, downloadBytes: expect.any(Number), parameters: null });
  });

  it("says why in plain words and tries again next time", async () => {
    const offline = fakeRegistry({ fail: true });
    const client = registryClient({ fetchImpl: offline.impl });
    expect(await client.info("qwen3:8b")).toEqual({ ok: false, message: "Can't reach ollama.com to read the model's size." });
    await client.info("qwen3:8b");
    expect(offline.calls).toHaveLength(2);

    expect(await registryClient({ fetchImpl: fakeRegistry({ manifests }).impl }).info("qwen3:nope")).toEqual({ ok: false, message: "ollama.com doesn't have this model." });
    expect(await registryClient({ fetchImpl: fakeRegistry({ status: 503 }).impl }).info("qwen3:8b")).toEqual({ ok: false, message: "ollama.com answered HTTP 503." });
    expect(await registryClient({ fetchImpl: fakeRegistry({ manifests: { "library/qwen3/8b": { hello: 1 } } }).impl }).info("qwen3:8b")).toEqual({
      ok: false,
      message: "ollama.com sent a model description BreadPilot doesn't understand.",
    });
  });

  it("never sends a bad tag to the network", async () => {
    const { impl, calls } = fakeRegistry({ manifests });
    expect(await registryClient({ fetchImpl: impl }).info("../../admin")).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });
});

describe("tiers and fit", () => {
  it("groups by the weights' size", () => {
    expect(tierOf(parseManifest(QWEN3_4B).weightsBytes)).toBe("small");
    expect(tierOf(parseManifest(GEMMA4_E4B).weightsBytes)).toBe("medium");
    expect(tierOf(18.6e9)).toBe("large");
    expect([tierOf(3.99e9), tierOf(4e9), tierOf(9.99e9), tierOf(10e9)]).toEqual(["small", "medium", "medium", "large"]);
  });

  it("formats memory like computers are sold and sizes like ollama.com", () => {
    expect(formatMemory(MAC_16)).toBe("16 GB");
    expect(formatBytes(487)).toBe("1 MB");
    expect(formatBytes(98_653_280)).toBe("99 MB");
  });

  const measured = (bytes: number, numCtx = 16384) => ({ bytes, numCtx, at: "2026-11-04T12:00:00Z" });

  it("decides fits / tight / too big only from a measurement at the current context", () => {
    const reserve = systemReserve(MAC_16);
    expect(reserve).toBe(MAC_16 * 0.25);
    const roomy = MAC_16 - reserve - APP_BYTES;
    expect(fitOf({ totalBytes: MAC_16, weightsBytes: 2.5e9, measured: measured(roomy), numCtx: 16384 }).kind).toBe("fits");
    expect(fitOf({ totalBytes: MAC_16, weightsBytes: 2.5e9, measured: measured(roomy + 1), numCtx: 16384 }).kind).toBe("tight");
    expect(fitOf({ totalBytes: MAC_16, weightsBytes: 2.5e9, measured: measured(MAC_16 - APP_BYTES), numCtx: 16384 }).kind).toBe("tight");
    expect(fitOf({ totalBytes: MAC_16, weightsBytes: 2.5e9, measured: measured(MAC_16 - APP_BYTES + 1), numCtx: 16384 }).kind).toBe("too-big");
    const fit = fitOf({ totalBytes: MAC_16, weightsBytes: 2.5e9, measured: measured(4.9e9), numCtx: 16384 });
    expect(fit).toEqual({ kind: "fits", reason: "Uses 4.9 GB while running, plus about 1.0 GB for BreadPilot; this computer has 16 GB." });
  });

  it("small computers keep at least 4 GB for the system", () => {
    expect(systemReserve(8 * GiB)).toBe(4e9);
    expect(fitOf({ totalBytes: 8 * GiB, weightsBytes: 2.5e9, measured: measured(4.9e9), numCtx: 16384 }).kind).toBe("tight");
  });

  it("before measuring: only 'too big' when the weights alone don't fit, never a guessed fit", () => {
    const big = parseManifest(GEMMA4_E4B).weightsBytes;
    expect(fitOf({ totalBytes: 6 * GiB, weightsBytes: big, numCtx: 16384 })).toEqual({ kind: "too-big", reason: "The model alone is 5.5 GB; this computer has 6 GB." });
    expect(fitOf({ totalBytes: MAC_16, weightsBytes: big, numCtx: 16384 })).toEqual({ kind: "unknown", reason: "Needs at least 5.5 GB; the exact memory is checked after the download." });
    expect(fitOf({ totalBytes: MAC_16, weightsBytes: null, numCtx: 16384 }).reason).toBe("Size unknown: its memory is checked after the download.");
  });

  it("a measurement at another context size asks to check again", () => {
    const f = fitOf({ totalBytes: MAC_16, weightsBytes: 2.5e9, measured: measured(3.7e9, 8192), numCtx: 16384 });
    expect(f).toEqual({ kind: "unknown", reason: "Measured with a context of 8192 tokens; check its memory again for 16384." });
    // …unless even the weights are too big.
    expect(fitOf({ totalBytes: 2 * GiB, weightsBytes: 2.5e9, measured: measured(3.7e9, 8192), numCtx: 16384 }).kind).toBe("too-big");
  });
});
