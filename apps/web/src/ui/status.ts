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
  if (unreachable) return { tone: "bad", text: "Can't reach the app's server.", details: ["The app got no answer from its server. Restart BreadPilot."] };
  if (!report) return { tone: "pending", text: "Checking the system…", details: [] };
  const { db, llm, embed, docs } = report.checks;
  // OpenAI picked: the local AI's state doesn't matter, and documentation search falls back to
  // keyword search without Ollama, so only the database is shown.
  if (ai === "openai") {
    const dbLine = [`Projects database: ${db.status === "ok" ? "OK" : "offline"}`];
    return db.status === "ok" ? { tone: "ok", text: "Ready to build", details: dbLine } : { tone: "bad", text: "The projects database is offline.", details: dbLine };
  }
  const details = [
    `Projects database: ${db.status === "ok" ? "OK" : "offline"}`,
    `Local AI (Ollama): ${llm.status === "ok" ? "running" : "not running"}`,
    `Documentation search: ${embed.status === "ok" && docs?.status !== "down" ? "OK" : embed.status !== "ok" ? "keywords only (needs the search model)" : "not indexed yet"}`,
  ];
  if (db.status !== "ok") return { tone: "bad", text: "The projects database is offline.", details };
  if (llm.status !== "ok") return { tone: "warn", text: "Local AI is offline: start the Ollama app.", details };
  // Without the embedding model, documentation search falls back to keywords.
  if (embed.status !== "ok") return { tone: "warn", text: "Ready; documentation search uses keywords only (download the search model in Settings).", details };
  if (docs?.status === "down") return { tone: "warn", text: "Ready, but the documentation isn't indexed yet.", details };
  return { tone: "ok", text: "Ready to build", details };
}
