// What the 3D view and the step player need from an agent project (pure, unit-tested).
import { resolveBuild, validateBuild, type Build, type BuildStep, type Resolved } from "@breadpilot/circuit-core";
import type { ApiProject } from "./types";

export interface BuildView {
  build: Build;
  steps: BuildStep[];
  resolved: Resolved;
  /**
   * M9: this version is a change to the project. `count`: its change steps (0 = only the code
   * changed); `total`: all steps; `showing`: which list `steps` is.
   */
  change?: { count: number; total: number; showing: "changes" | "all" };
  /** M9: the board before the change, so the parts and wires being taken out can be drawn until their step. */
  removed?: { resolved: Resolved; wires: Build["wires"] };
}

export type ProjectView = { kind: "build"; view: BuildView } | { kind: "none" } | { kind: "unsafe"; message: string };

const cache = new Map<string, ProjectView>();

/**
 * The browser re-validates every build with the same safety core before showing a step
 * (PLAN §9.2: a step can't be shown unless its build passed validation), so a stale or
 * tampered project can never be played.
 */
export function projectView(p: Pick<ApiProject, "id" | "updatedAt" | "build">, allSteps = false): ProjectView {
  const key = `${p.id}@${p.updatedAt}@${allSteps ? "all" : "changes"}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out: ProjectView;
  if (!p.build?.steps.length) out = { kind: "none" };
  else {
    const report = validateBuild(p.build.build);
    const { resolved } = resolveBuild(p.build.build);
    // After a change, the change steps come first (only what changes); the full list on request.
    const changes = p.build.changeSteps;
    const showChanges = !!changes?.length && !allSteps;
    const change = changes ? { count: changes.length, total: p.build.steps.length, showing: showChanges ? ("changes" as const) : ("all" as const) } : undefined;
    const before = showChanges && p.build.changeFrom ? resolveBuild(p.build.changeFrom).resolved : null;
    const removed = before ? { resolved: before, wires: p.build.changeFrom!.wires } : undefined;
    out =
      report.ok && resolved
        ? { kind: "build", view: { build: p.build.build, steps: showChanges ? changes! : p.build.steps, resolved, ...(change ? { change } : {}), ...(removed ? { removed } : {}) } }
        : { kind: "unsafe", message: report.issues.find((i) => i.severity === "error")?.message ?? "The build couldn't be checked." };
  }
  if (cache.size > 50) cache.clear();
  cache.set(key, out);
  return out;
}

const EMPTY_BUILD: Build = { boardId: "pico-2-w", parts: [], wires: [], gpioModes: {} };
let empty: Resolved | null = null;

/** The bare breadboard with the Pico, shown while there's nothing to build yet. */
export function emptyResolved(): Resolved {
  return (empty ??= resolveBuild(EMPTY_BUILD).resolved!);
}
