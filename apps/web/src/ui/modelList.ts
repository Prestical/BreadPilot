// What the local model list shows (PLAN §13.2, Milestone 7, step 7.3). Pure and unit-tested; the
// numbers all come from the engine (built-in Ollama sizes, memory measured by the local Ollama).

import type { LlmOptions, LocalModel, LocalModelsView, PullState, Tier } from "../projects/types";

const GB = 1e9;

/** Model sizes the way ollama.com shows them (decimal GB), same as the engine's formatBytes. */
export const formatBytes = (bytes: number) => (bytes >= GB ? `${(bytes / GB).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`);
/** Installed memory the way computers are sold ("16 GB" = 16 GiB). */
export const formatMemory = (bytes: number) => `${Math.round(bytes / 2 ** 30)} GB`;

export interface ModelGroup {
  id: Tier | "more" | "others";
  title: string;
  models: LocalModel[];
}

const TIER_TITLE: Record<Tier, string> = {
  small: "Small (model under 4 GB)",
  medium: "Medium (model 4–10 GB)",
  large: "Large (model 10 GB and more)",
};

/** Small → Medium → Large (catalog order inside each), then the user's other downloaded models. */
export function groupModels(view: LocalModelsView): ModelGroup[] {
  const groups: ModelGroup[] = (["small", "medium", "large"] as Tier[])
    .map((t) => ({ id: t, title: TIER_TITLE[t], models: view.models.filter((m) => m.tier === t) }))
    .filter((g) => g.models.length);
  const untiered = view.models.filter((m) => m.tier === null);
  if (untiered.length) groups.push({ id: "more", title: "More models", models: untiered });
  if (view.others.length) groups.push({ id: "others", title: "Your other models", models: view.others });
  return groups;
}

export type ModelAction = "download" | "downloading" | "use" | "in-use" | "check" | "checking" | "remove";

/**
 * Buttons for the chosen model. Not downloaded: Download (or its progress). Downloaded: Use (or
 * "In use"), Check memory when it isn't measured at this context (never for too-big models: loading
 * one could freeze the computer), Remove when it isn't the model in use.
 */
export function actionsFor(m: LocalModel, opts: { pull?: PullState; measuring: string | null; numCtx: number }): ModelAction[] {
  if (!m.installed) return [opts.pull?.status === "pulling" ? "downloading" : "download"];
  const out: ModelAction[] = [m.selected ? "in-use" : "use"];
  if (opts.measuring === m.tag) out.push("checking");
  else if (!(m.measured && m.measured.numCtx === opts.numCtx) && m.fit.kind !== "too-big") out.push("check");
  if (!m.selected) out.push("remove");
  return out;
}

/** Memory, short: measured on this computer, else Ollama's weights size as the least it needs. */
export function memoryShort(m: LocalModel, numCtx: number): string {
  if (m.measured && m.measured.numCtx === numCtx) return `${formatBytes(m.measured.bytes)} memory`;
  const least = m.sizes?.weightsBytes ?? m.installedBytes;
  return least ? `${formatBytes(least)}+ memory` : "memory unknown";
}

/** A warning for this computer, or null when there's nothing to warn about. */
export function warningShort(m: LocalModel): string | null {
  if (m.fit.kind === "too-big") return "⚠ too big for this computer";
  if (m.fit.kind === "tight") return "⚠ tight on memory";
  return null;
}

/** One dropdown option: "Qwen3 4B Instruct · 2.5 GB · 4.9 GB memory · ⚠ … (downloaded)". */
export function optionText(m: LocalModel, numCtx: number): string {
  const size = m.sizes ? formatBytes(m.sizes.downloadBytes) : m.installedBytes !== null ? formatBytes(m.installedBytes) : null;
  const parts = [m.name, size, memoryShort(m, numCtx), warningShort(m)].filter(Boolean).join(" · ");
  const tags = [m.default ? "default" : null, m.installed ? "downloaded" : null].filter(Boolean);
  return tags.length ? `${parts} (${tags.join(", ")})` : parts;
}

/** Asking before using a model this computer can't hold. */
export const tooBigWarning = (m: LocalModel) => `${m.name} is probably too big for this computer: ${m.fit.reason} Use it anyway?`;

/** The OpenAI model BreadPilot recommends instead of a small local model. */
export const RECOMMENDED_OPENAI = "GPT-6 Luna";

/**
 * The warning for small local models (the model list's small group), shown only in Settings → Local
 * AI. In BreadPilot's tests (08/11/2026) a 4B model's code passed the checks but often had logic
 * mistakes, while OpenAI's model got the same projects right. The wiring is checked by BreadPilot
 * itself whatever the model.
 */
export const smallModelWarning = (name?: string) =>
  `${name ? `${name} is a small model` : "Small models"}: ${name ? "its" : "their"} code often has logic mistakes, even when it matches the wiring (BreadPilot checks the wiring itself). For better results, use OpenAI's ${RECOMMENDED_OPENAI}.`;

/** The prompt bar's button: "Local · Qwen3 4B Instruct". */
export function localLabel(options: LlmOptions | null): string {
  const name = options?.local.name ?? options?.local.model;
  return name ? `Local · ${name}` : "Local AI";
}

/** "This computer has 16 GB of memory." */
export const computerLine = (view: LocalModelsView) => `This computer has ${formatMemory(view.totalMemoryBytes)} of memory.`;
