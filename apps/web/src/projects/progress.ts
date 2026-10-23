// Turns pipeline progress events into plain-English timeline rows (pure, unit-tested).
import type { ProgressEvent, ProjectState } from "./types";

export type Tone = "busy" | "ok" | "warn" | "bad";

export interface TimelineRow {
  stage: ProgressEvent["stage"];
  text: string;
  tone: Tone;
  detail?: string;
}

const tries = (n?: number) => (n && n > 1 ? ` (try ${n})` : "");

export function describeEvent(e: ProgressEvent): TimelineRow {
  const row = (text: string, tone: Tone, detail?: string): TimelineRow => ({ stage: e.stage, text, tone, ...(detail ? { detail } : {}) });
  if (e.status === "error") return row(e.stage === "code" ? "The code still didn't match the wiring" : "Something went wrong", "bad", e.detail);
  switch (e.stage) {
    case "intake":
      return e.status === "start" ? row("Reading your idea…", "busy") : row("Understood your idea", "ok");
    case "plan":
      if (e.status === "start") return row(e.attempt && e.attempt > 1 ? `Revising the plan${tries(e.attempt)}…` : "Writing a plan…", "busy");
      return row("Plan written", "ok");
    case "design":
      if (e.status === "retry") return row("The plan didn't fit the breadboard, so it's being fixed", "warn", e.detail);
      return row("Placed the parts on the breadboard", "ok", e.detail);
    case "steps":
      return row("Wrote the build steps and checked the wiring for safety", "ok", e.detail);
    case "code":
      if (e.status === "start") return row(`Writing MicroPython${tries(e.attempt)}…`, "busy");
      if (e.status === "retry") return row("The code checker found problems; asking for a fix", "warn", e.detail);
      return row("Code matches the wiring", "ok");
  }
}

/** One row per step: a finished event replaces the "…" row of the same stage. */
export function timeline(events: ProgressEvent[]): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const e of events) {
    const row = describeEvent(e);
    const last = rows.at(-1);
    if (e.status !== "start" && last?.tone === "busy" && last.stage === e.stage) rows[rows.length - 1] = row;
    else rows.push(row);
  }
  return rows;
}

export const STATE_LABEL: Record<ProjectState, string> = {
  AWAIT_APPROVAL: "Needs your OK",
  READY: "Ready to build",
  HANDOFF: "Needs a stronger assistant",
  FAILED: "Stopped",
};

/** Typical wait for the model the project uses, so the user knows a pause is normal (and can stop). */
export function typicalWait(llm: "local" | "openai" | undefined): string {
  return llm === "openai"
    ? "OpenAI is usually much faster than the local AI."
    : "Usually 20-60 seconds with the local AI.";
}
