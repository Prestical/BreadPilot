// What the 3D view and the step player need from an agent project (pure, unit-tested).
import { resolveBuild, validateBuild, type Build, type BuildStep, type Resolved } from "@breadpilot/circuit-core";
import type { ApiProject } from "./types";

export interface BuildView {
  build: Build;
  steps: BuildStep[];
  resolved: Resolved;
}

export type ProjectView = { kind: "build"; view: BuildView } | { kind: "none" } | { kind: "unsafe"; message: string };

const cache = new Map<string, ProjectView>();

/**
 * The browser re-validates every build with the same safety core before showing a step
 * (PLAN §9.2: a step can't be shown unless its build passed validation), so a stale or
 * tampered project can never be played.
 */
export function projectView(p: Pick<ApiProject, "id" | "updatedAt" | "build">): ProjectView {
  const key = `${p.id}@${p.updatedAt}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let out: ProjectView;
  if (!p.build?.steps.length) out = { kind: "none" };
  else {
    const report = validateBuild(p.build.build);
    const { resolved } = resolveBuild(p.build.build);
    out =
      report.ok && resolved
        ? { kind: "build", view: { build: p.build.build, steps: p.build.steps, resolved } }
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
