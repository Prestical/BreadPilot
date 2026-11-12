// M9 9.1: a project's versions. Version 1 is the project as it was first built; every change the user
// asks for (9.3) adds a version. Restoring an older version makes it the current one again: no new
// number (user, 11/11/2026), and a change made from it becomes the next new number. The project's own
// fields (plans, build, state) always hold the current version, so code that reads a project works
// as before; projects made before M9 get their version 1 the first time they're read. Nothing is
// ever deleted.

import type { LlmChoice, Project, ProjectBuild, ProjectState } from "./project";
import { currentPlan } from "./project";

export interface ProjectVersion {
  n: number;
  /** The change the user asked for; missing for version 1 (the idea itself). */
  request?: string;
  /** The version it was changed from (missing for version 1). */
  parent?: number;
  /** Old data only: versions made by a restore before restores stopped adding versions. */
  restoredFrom?: number;
  /** Which model made it (the project's choice at the time) and its name, e.g. "qwen3:4b…". */
  llm: LlmChoice;
  model?: string;
  /** The plan it was built from (Project.plans[].version). */
  planVersion: number;
  state: Extract<ProjectState, "READY" | "HANDOFF">;
  handoffReason?: string;
  /** The finished build: parts, wires, steps, code and its check (without the repair history). */
  build?: ProjectBuild;
  createdAt: string;
}

const finished = (p: Project): p is Project & { state: "READY" | "HANDOFF" } => p.state === "READY" || p.state === "HANDOFF";

/** A copy of the build to keep: the repair attempts stay with the project, not with every version. */
function keepBuild(b: ProjectBuild | undefined): ProjectBuild | undefined {
  if (!b) return undefined;
  const { codeHistory: _history, ...rest } = structuredClone(b);
  return rest;
}

/** The version the project shows now: the one restored last, else the newest. */
export const currentVersionOf = (p: Pick<Project, "versions" | "currentVersion">): number | undefined => p.currentVersion ?? p.versions?.at(-1)?.n;

function snapshot(p: Project, n: number, at: string, extra: Pick<ProjectVersion, "request" | "parent" | "model">): ProjectVersion {
  if (!finished(p)) throw new Error(`Internal error: a ${p.state} project can't become a version.`);
  return {
    n,
    ...(extra.request ? { request: extra.request } : {}),
    ...(extra.parent ? { parent: extra.parent } : {}),
    llm: p.llm ?? "local",
    ...(extra.model ? { model: extra.model } : {}),
    planVersion: currentPlan(p)?.version ?? 0,
    state: p.state,
    ...(p.handoffReason ? { handoffReason: p.handoffReason } : {}),
    ...(p.build ? { build: keepBuild(p.build) } : {}),
    createdAt: at,
  };
}

/**
 * Makes version 1 for a finished project that has none yet: a new project when its first build
 * ends, or a project made before M9 when it's read. Projects still being planned get none.
 * Returns the project (changed in place).
 */
export function ensureVersions(p: Project, model?: string, at: string = p.updatedAt ?? p.createdAt): Project {
  if (!p.versions?.length && finished(p)) p.versions = [snapshot(p, 1, at, { model })];
  return p;
}

/**
 * Adds the project's state as a new version after a change (9.3) and makes it current. `parent`:
 * the version that was current when the change started.
 */
export function addVersion(p: Project, at: string, info: { request?: string; model?: string; parent?: number }): ProjectVersion {
  ensureVersions(p);
  const v = snapshot(p, (p.versions?.at(-1)?.n ?? 0) + 1, at, info);
  (p.versions ??= []).push(v);
  p.currentVersion = v.n;
  return v;
}

/** The current version follows the project when its wiring is redone without a change (power switch). */
export function syncCurrent(p: Project): void {
  const n = currentVersionOf(p);
  const v = p.versions?.find((x) => x.n === n);
  if (v && p.build) v.build = keepBuild(p.build);
}

/**
 * Brings back version n as the current version: no new version (user, 11/11/2026). Its plan becomes
 * the newest plan and its build the current build, with that build's full steps (not the steps of the
 * change that once made it). Nothing is removed; the next change is made from it.
 */
export function restoreVersion(p: Project, n: number, at: string): ProjectVersion {
  ensureVersions(p);
  if (!finished(p)) throw new RestoreError("Only a finished project can go back to an older version.", 409);
  const v = p.versions?.find((x) => x.n === n);
  if (!v) throw new RestoreError(`This project has no version ${n}.`, 404);
  if (v.n === currentVersionOf(p)) throw new RestoreError(`Version ${n} is already the current one.`, 409);
  const plan = p.plans.find((x) => x.version === v.planVersion);
  if (plan) p.plans.push({ ...structuredClone(plan), version: p.plans.length + 1, approved: true, feedback: undefined, autoFix: undefined });
  p.build = v.build ? structuredClone(v.build) : undefined;
  if (p.build) {
    delete p.build.changeSteps;
    delete p.build.changeFrom;
  }
  p.state = v.state;
  if (v.handoffReason) p.handoffReason = v.handoffReason;
  else delete p.handoffReason;
  if (plan) p.title = plan.title;
  p.currentVersion = v.n;
  p.updatedAt = at;
  return v;
}

export class RestoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
