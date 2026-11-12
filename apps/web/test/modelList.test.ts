// Local model list view logic (Milestone 7, step 7.3).
import { describe, expect, it } from "vitest";
import type { LocalModel, LocalModelsView } from "../src/projects/types";
import { actionsFor, computerLine, formatBytes, formatMemory, groupModels, localLabel, memoryShort, optionText, smallModelWarning, tooBigWarning, warningShort } from "../src/ui/modelList";

const sizes = (weightsBytes: number, extra: Partial<LocalModel["sizes"] & object> = {}) => ({ downloadBytes: weightsBytes + 13_000, weightsBytes, visionBytes: 0, draftBytes: 0, parameters: "4.0B", quantization: "Q4_K_M", ...extra });
const model = (p: Partial<LocalModel> & { tag: string }): LocalModel => ({
  name: p.tag,
  family: null,
  note: null,
  default: false,
  inCatalog: true,
  installed: false,
  installedBytes: null,
  sizes: sizes(2_497_280_480),
  parameters: "4.0B",
  quantization: "Q4_K_M",
  tier: "small",
  measured: null,
  fit: { kind: "unknown", reason: "Needs at least 2.5 GB; the exact memory is checked after the download." },
  selected: false,
  ...p,
});
const view = (models: LocalModel[], others: LocalModel[] = []): LocalModelsView => ({ totalMemoryBytes: 16 * 2 ** 30, numCtx: 16384, selected: "a", ollamaError: null, models, others });

describe("grouping", () => {
  it("Small → Medium → Large in catalog order, then the user's other models; empty groups hidden", () => {
    const v = view([model({ tag: "big", tier: "large" }), model({ tag: "s1" }), model({ tag: "s2" })], [model({ tag: "mine:1b", inCatalog: false, sizes: null })]);
    expect(groupModels(v).map((g) => [g.id, g.models.map((m) => m.tag)])).toEqual([
      ["small", ["s1", "s2"]],
      ["large", ["big"]],
      ["others", ["mine:1b"]],
    ]);
    expect(groupModels(v)[0]!.title).toBe("Small (model under 4 GB)");
  });

  it("group ids are unique (React keys)", () => {
    const g = groupModels(view([model({ tag: "x", tier: null })], [model({ tag: "y" })]));
    expect(new Set(g.map((x) => x.id)).size).toBe(g.length);
  });
});

describe("texts", () => {
  it("sizes like ollama.com, memory like computers are sold", () => {
    expect(formatBytes(2_497_293_803)).toBe("2.5 GB");
    expect(formatBytes(671_372_768)).toBe("671 MB");
    expect(formatMemory(16 * 2 ** 30)).toBe("16 GB");
    expect(computerLine(view([]))).toBe("This computer has 16 GB of memory.");
  });

  it("dropdown options: name, download, memory, a warning only when needed, and tags", () => {
    const def = model({ tag: "q4", name: "Qwen3 4B Instruct", default: true, installed: true, sizes: sizes(2_497_280_480, { downloadBytes: 2_497_293_803 }), measured: { bytes: 4.9e9, numCtx: 16384, at: "x" }, fit: { kind: "fits", reason: "" } });
    expect(optionText(def, 16384)).toBe("Qwen3 4B Instruct · 2.5 GB · 4.9 GB memory (default, downloaded)");
    const vision = model({ tag: "qwen3.5:2b", name: "Qwen 3.5 2B", sizes: sizes(2_012_012_448, { visionBytes: 671_372_768, downloadBytes: 2_683_396_812 }) });
    expect(optionText(vision, 16384)).toBe("Qwen 3.5 2B · 2.7 GB · 2.0 GB+ memory");
    const big = model({ tag: "g", name: "Gemma 4 31B", sizes: sizes(18_670_033_120, { downloadBytes: 20_385_458_234 }), fit: { kind: "too-big", reason: "" } });
    expect(optionText(big, 16384)).toBe("Gemma 4 31B · 20.4 GB · 18.7 GB+ memory · ⚠ too big for this computer");
    expect(warningShort(model({ tag: "t", fit: { kind: "tight", reason: "" } }))).toBe("⚠ tight on memory");
    expect(warningShort(def)).toBeNull();
    // A measurement at another context size doesn't count.
    expect(memoryShort(def, 8192)).toBe("2.5 GB+ memory");
    const mine = model({ tag: "mine:1b", name: "mine:1b", inCatalog: false, sizes: null, installed: true, installedBytes: 1.3e9 });
    expect(optionText(mine, 16384)).toBe("mine:1b · 1.3 GB · 1.3 GB+ memory (downloaded)");
  });

  it("prompt bar shows the chosen local model", () => {
    expect(localLabel({ local: { model: "qwen3:4b-instruct-2507-q4_K_M", name: "Qwen3 4B Instruct" }, openai: { available: false } })).toBe("Local · Qwen3 4B Instruct");
    expect(localLabel({ local: { model: "mine:1b" }, openai: { available: false } })).toBe("Local · mine:1b");
    expect(localLabel(null)).toBe("Local AI");
  });

  it("asks before using a model that's too big", () => {
    const m = model({ tag: "g", name: "Gemma 4 31B", fit: { kind: "too-big", reason: "The model alone is 18.7 GB; this computer has 16 GB." } });
    expect(tooBigWarning(m)).toBe("Gemma 4 31B is probably too big for this computer: The model alone is 18.7 GB; this computer has 16 GB. Use it anyway?");
  });
});

describe("buttons", () => {
  const opts = { measuring: null, numCtx: 16384 };
  it("not downloaded: Download, or its progress", () => {
    expect(actionsFor(model({ tag: "a" }), opts)).toEqual(["download"]);
    expect(actionsFor(model({ tag: "a" }), { ...opts, pull: { model: "a", status: "pulling", completed: 1, total: 2, message: "" } })).toEqual(["downloading"]);
    expect(actionsFor(model({ tag: "a" }), { ...opts, pull: { model: "a", status: "error", completed: 0, total: 0, message: "x" } })).toEqual(["download"]);
  });

  it("downloaded: Use / In use, Check memory until measured at this context, Remove unless in use", () => {
    expect(actionsFor(model({ tag: "a", installed: true }), opts)).toEqual(["use", "check", "remove"]);
    expect(actionsFor(model({ tag: "a", installed: true, selected: true }), opts)).toEqual(["in-use", "check"]);
    const measured = model({ tag: "a", installed: true, measured: { bytes: 5e9, numCtx: 16384, at: "x" }, fit: { kind: "fits", reason: "" } });
    expect(actionsFor(measured, opts)).toEqual(["use", "remove"]);
    expect(actionsFor(measured, { ...opts, numCtx: 32768 })).toEqual(["use", "check", "remove"]);
    expect(actionsFor(model({ tag: "a", installed: true }), { ...opts, measuring: "a" })).toEqual(["use", "checking", "remove"]);
    // Loading a model that can't fit could freeze the computer: no Check button.
    expect(actionsFor(model({ tag: "a", installed: true, fit: { kind: "too-big", reason: "" } }), opts)).toEqual(["use", "remove"]);
  });
});

describe("small model warning", () => {
  it("names the model, says the wiring is still checked, and recommends GPT-6 Luna", () => {
    expect(smallModelWarning("Qwen3 4B Instruct")).toBe(
      "Qwen3 4B Instruct is a small model: its code often has logic mistakes, even when it matches the wiring (BreadPilot checks the wiring itself). For better results, use OpenAI's GPT-6 Luna.",
    );
    expect(smallModelWarning()).toMatch(/^Small models: their code often has logic mistakes/);
  });
});
