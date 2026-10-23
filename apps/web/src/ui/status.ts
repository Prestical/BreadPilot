// The system status in plain words for the sidebar (pure, unit-tested): what still works with the
// AI the user picked, instead of "DEGRADED".
import type { HealthReport } from "../health";
import type { AiChoice } from "../projects/types";

export type Tone = "ok" | "warn" | "bad" | "pending";

export interface StatusView {
  tone: Tone;
  /** One short sentence for the sidebar footer. */
  text: string;
  /** One line per part of the system, shown when the user opens the details. */
  details: string[];
}

export function statusView(report: HealthReport | null, unreachable: boolean, ai: AiChoice): StatusView {
  if (unreachable) return { tone: "bad", text: "Can't reach the app's server. Is Docker running?", details: ["The browser got no answer from the API."] };
  if (!report) return { tone: "pending", text: "Checking the system…", details: [] };
  const { db, llm, embed, docs } = report.checks;
  const details = [
    `Projects database: ${db.status === "ok" ? "OK" : "offline"}`,
    `Local AI (Ollama): ${llm.status === "ok" ? "running" : "not running"}`,
    `Documentation search: ${embed.status === "ok" && docs?.status !== "down" ? "OK" : embed.status !== "ok" ? "offline (needs Ollama)" : "not indexed yet"}`,
  ];
  if (db.status !== "ok") return { tone: "bad", text: "The projects database is offline.", details };
  if (ai === "local" && llm.status !== "ok") return { tone: "warn", text: "Local AI is offline: start the Ollama app.", details };
  if (embed.status !== "ok") return { tone: "warn", text: "Ready, but documentation search is off (start Ollama).", details };
  if (docs?.status === "down") return { tone: "warn", text: "Ready, but the documentation isn't indexed yet.", details };
  return { tone: "ok", text: "Ready to build", details };
}
