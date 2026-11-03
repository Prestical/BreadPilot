// The first-run setup's view of the local AI (pure, unit-tested): is Ollama running, and which of
// the two models still have to be downloaded.
import type { HealthReport } from "../health";
import type { SettingsView } from "../projects/types";

export type LocalAi =
  | { kind: "checking" }
  /** Ollama isn't installed, or isn't open. */
  | { kind: "offline" }
  /** Ollama runs, but these models aren't downloaded yet. */
  | { kind: "missing"; models: string[] }
  | { kind: "ready" };

export function localAiState(report: HealthReport | null, local: SettingsView["local"] | null): LocalAi {
  if (!report || !local) return { kind: "checking" };
  const { llm, embed } = report.checks;
  // The health check can't list Ollama's models when Ollama doesn't answer.
  if (llm.detail.startsWith("LLM endpoint unreachable")) return { kind: "offline" };
  const models = [llm.status === "ok" ? null : local.model, embed.status === "ok" ? null : local.embedModel].filter((m): m is string => !!m);
  return models.length ? { kind: "missing", models } : { kind: "ready" };
}

/** The command that downloads a model, for the user to paste into a terminal. */
export const pullCommand = (model: string) => `ollama pull ${model}`;
