// Small text helpers for the prompt bar (pure, unit-tested).
import type { TokenUsage } from "../projects/types";

/** "gpt-6-luna" → "GPT-6 Luna"; other ids are shown as they are. */
export function modelName(id: string): string {
  const m = /^gpt-(\d+(?:\.\d+)?)-?(.*)$/i.exec(id);
  if (!m) return id;
  const rest = m[2]!.split("-").filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1));
  return [`GPT-${m[1]}`, ...rest].join(" ");
}

const n = (x: number) => x.toLocaleString("en-US");

/** "12,345 tokens · 9,800 in · 2,545 out (1,900 thinking) · 6 model calls" */
export function usageText(u: TokenUsage): string {
  const thinking = u.reasoning ? ` (${n(u.reasoning)} thinking)` : "";
  return `${n(u.input + u.output)} tokens · ${n(u.input)} in · ${n(u.output)} out${thinking} · ${u.calls} model call${u.calls === 1 ? "" : "s"}`;
}
