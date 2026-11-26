// Hardware reports (user, 26/11/2026): after a project with parts not tried on a real Pico yet has
// been built for the Pico, a small card above the prompt box asks whether it worked on the real
// board. The answer becomes a pre-filled GitHub issue (.github/ISSUE_TEMPLATE/hardware-report.yml)
// that the person checks and submits themselves: nothing is sent by the app. Plain functions, so
// they are tested without a browser.

import { PACKS, type Build } from "@breadpilot/circuit-core";

export const REPO = "https://github.com/Prestical/BreadPilot";
const TEMPLATE = "hardware-report.yml";

export interface UntestedPart {
  /** The part's name in the packs, e.g. "Photoresistor (LDR, GL5528)". */
  name: string;
  /** Its refs in this project, e.g. ["LDR1", "LDR2"]. */
  refs: string[];
}

/**
 * The parts of a build that haven't been tried on a real Pico yet (pack.json triedOnPico), one entry
 * per kind of part. Parts the engine adds itself (a resistor) count as tried.
 */
export function untestedParts(build: Build): UntestedPart[] {
  const out = new Map<string, UntestedPart>();
  for (const part of build.parts) {
    const pack = PACKS.find((p) => p.part.id === part.type);
    if (!pack?.meta.kind || pack.meta.triedOnPico) continue;
    const entry = out.get(part.type) ?? { name: pack.part.name, refs: [] };
    entry.refs.push(part.ref);
    out.set(part.type, entry);
  }
  return [...out.values()];
}

/** "Photoresistor (LDR1)" and "Touch sensor (TCH1)": a part's short name with its refs. */
export const partLabel = (p: UntestedPart) => `${p.name.replace(/\s*\(.*\)$/, "")} (${p.refs.join(", ")})`;

/** What can go wrong, as the card offers it (also the report's "What went wrong"). */
export const PROBLEMS = ["The wiring didn't fit", "Nothing happened", "It did something else", "Something got hot"] as const;

/** A note is kept short: the whole report travels in the link (GitHub refuses very long links). */
export const MAX_NOTE = 500;

export interface Report {
  parts: UntestedPart[];
  works: boolean;
  /** When it didn't work: the parts that didn't (names as in `parts`); empty = not sure which. */
  failed?: string[];
  problem?: string;
  note?: string;
  project: string;
  /** "0.4.0-beta.1, macOS" (no version in development). */
  version: string;
}

const short = (name: string) => name.replace(/\s*\(.*\)$/, "");

/**
 * Which parts a "doesn't work" report is about: one part is the one; with several, the ones picked
 * (in the order of `parts`), or none when the person isn't sure which.
 */
export function failedParts(r: Pick<Report, "parts" | "works" | "failed">): UntestedPart[] {
  if (r.works) return [];
  if (r.parts.length === 1) return r.parts;
  return r.parts.filter((p) => r.failed?.includes(p.name));
}

/** The GitHub link that opens the hardware report form, filled in. */
export function reportUrl(r: Report): string {
  const names = r.parts.map((p) => p.name).join(", ");
  const failed = failedParts(r);
  const verdict = r.works
    ? `${r.parts.map((p) => short(p.name)).join(", ")} ${r.parts.length > 1 ? "work" : "works"}`
    : failed.length
      ? `${failed.map((p) => short(p.name)).join(", ")} ${failed.length > 1 ? "don't" : "doesn't"} work`
      : `${r.parts.map((p) => short(p.name)).join(", ")}: something doesn't work`;
  const q = new URLSearchParams({
    template: TEMPLATE,
    title: `Hardware report: ${verdict}`,
    parts: names,
    result: r.works ? "Works" : "Doesn't work",
    ...(r.works ? {} : { failed: failed.length ? failed.map((p) => p.name).join(", ") : "Not sure which" }),
    ...(r.problem && !r.works ? { problem: r.problem } : {}),
    ...(r.note?.trim() ? { details: r.note.trim().slice(0, MAX_NOTE) } : {}),
    project: r.project,
    version: r.version,
  });
  return `${REPO}/issues/new?${q.toString()}`;
}

/** The computer, as a person would name it ("macOS"), from the browser's own platform string. */
export function osName(platform: string): string {
  if (/mac/i.test(platform)) return "macOS";
  if (/win/i.test(platform)) return "Windows";
  if (/linux/i.test(platform)) return "Linux";
  return platform || "unknown";
}

// ---- What this computer remembers per project (only here; the card asks once) ----

/** "built": a UF2 was made, so the card may ask; "done": answered or turned off. */
export type ReportState = "built" | "done";
const key = (projectId: string) => `breadpilot.report.${projectId}`;
/** The card listens for this, so it appears as soon as the UF2 is made. */
export const REPORT_EVENT = "breadpilot-report";

export function reportState(projectId: string): ReportState | null {
  try {
    const v = localStorage.getItem(key(projectId));
    return v === "built" || v === "done" ? v : null;
  } catch {
    return null;
  }
}

export function setReportState(projectId: string, state: ReportState): void {
  try {
    // An answer stays an answer: a later build doesn't ask again.
    if (state === "built" && reportState(projectId) === "done") return;
    localStorage.setItem(key(projectId), state);
  } catch {
    /* storage blocked: the card just doesn't remember */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REPORT_EVENT));
}
