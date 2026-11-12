// M9 9.6: the change test. Each case builds a project from its idea, then asks for one change and
// measures what happened: was it the expected kind (code only / other parts), was it made, are the
// parts right, did every part that stays keep its pin and place (the M9 promise), does the new code
// pass today's checks. Vague plans and waiting changes are approved as they are, like the model
// test does. The code before and after is kept for Claude's review: "correct" here is still
// "passes the checks", not "works on the Pico".
import { canonicalJson, checkMicroPython, getBoard, type PlacedBlock } from "@breadpilot/circuit-core";
import { approvePlan, createProject, reviseProject, type AgentDeps } from "./pipeline";
import type { Project } from "./project";

export interface ChangeCase {
  idea: string;
  change: string;
  /** kind: "code" = only the code should change; "wiring" = other parts (approval). parts: after the change. */
  expect: { kind: "code" | "wiring"; parts: Record<string, number> };
}

export interface ChangeResult {
  idea: string;
  change: string;
  /** The project from the idea reached READY (else the change wasn't tried). */
  built: boolean;
  expectedKind: "code" | "wiring";
  kind: "code" | "wiring" | null;
  /** The change was made: READY, a new version, no change error. */
  made: boolean;
  changeError?: string;
  partsBefore: Record<string, number>;
  partsAfter: Record<string, number>;
  partsMatch: boolean;
  /** Parts on both boards that kept exactly their pins, half, rows and names; `moved`: the ones that didn't. */
  kept: number;
  moved: string[];
  codeOk: boolean;
  changeSteps: string[];
  secondsBuild: number;
  secondsChange: number;
  llmCallsChange: number;
  correct: boolean;
  codeBefore?: string;
  codeAfter?: string;
  behaviorsAfter?: string[];
  note?: string;
}

export const countParts = (blocks: PlacedBlock[] = []) => {
  const counts: Record<string, number> = {};
  for (const b of blocks) counts[b.kind] = (counts[b.kind] ?? 0) + 1;
  return counts;
};
const sameCounts = (a: Record<string, number>, b: Record<string, number>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].every((k) => (a[k] ?? 0) === (b[k] ?? 0));

/** Blocks on both boards (by their main part's name) must be identical: same pins, half, rows and names. */
export function keptParts(before: PlacedBlock[], after: PlacedBlock[]): { kept: number; moved: string[] } {
  let kept = 0;
  const moved: string[] = [];
  for (const b of before) {
    const a = after.find((x) => x.ref === b.ref);
    if (!a) continue;
    if (canonicalJson(a) === canonicalJson(b)) kept++;
    else moved.push(b.ref);
  }
  return { kept, moved };
}

export async function runChangeCase(deps: AgentDeps, c: ChangeCase): Promise<ChangeResult> {
  const base: ChangeResult = { idea: c.idea, change: c.change, built: false, expectedKind: c.expect.kind, kind: null, made: false, partsBefore: {}, partsAfter: {}, partsMatch: false, kept: 0, moved: [], codeOk: false, changeSteps: [], secondsBuild: 0, secondsChange: 0, llmCallsChange: 0, correct: false };
  const t0 = performance.now();
  let p: Project = await createProject(deps, c.idea);
  if (p.state === "AWAIT_APPROVAL") p = await approvePlan(deps, p.id);
  base.secondsBuild = Math.round((performance.now() - t0) / 100) / 10;
  if (p.state !== "READY" || !p.build) return { ...base, note: `the project from the idea ended ${p.state}${p.handoffReason ? `: ${p.handoffReason}` : p.failure ? `: ${p.failure}` : ""}` };
  const before = structuredClone(p);
  const calls0 = p.usage?.calls ?? 0;
  const t1 = performance.now();
  p = await reviseProject(deps, p.id, c.change);
  const kind = p.state === "AWAIT_APPROVAL" ? "wiring" : "code";
  if (p.state === "AWAIT_APPROVAL") p = await approvePlan(deps, p.id);
  const secondsChange = Math.round((performance.now() - t1) / 100) / 10;
  const made = p.state === "READY" && !p.changeError && (p.versions?.length ?? 0) > (before.versions?.length ?? 1);
  const partsAfter = countParts(p.build?.blocks);
  const { kept, moved } = keptParts(before.build!.blocks, p.build?.blocks ?? []);
  const board = getBoard(p.board)!;
  const codeOk = !!p.build?.code && checkMicroPython(p.build.code, p.build.build, board).ok;
  const partsMatch = sameCounts(partsAfter, c.expect.parts);
  return {
    ...base,
    built: true,
    kind,
    made,
    ...(p.changeError ? { changeError: p.changeError.message } : {}),
    partsBefore: countParts(before.build!.blocks),
    partsAfter,
    partsMatch,
    kept,
    moved,
    codeOk,
    changeSteps: (p.build?.changeSteps ?? []).map((s) => `${s.kind}${s.partRef ? ` ${s.partRef}` : ""}`),
    secondsChange,
    llmCallsChange: (p.usage?.calls ?? 0) - calls0,
    correct: made && kind === c.expect.kind && partsMatch && moved.length === 0 && codeOk,
    codeBefore: before.build!.code,
    codeAfter: p.build?.code,
    behaviorsAfter: p.plans.at(-1)?.behavior,
  };
}

/** The summary table, one row per model run. */
export function changeTable(model: string, rs: ChangeResult[]): string {
  const n = rs.length;
  const pct = (k: number) => (n ? `${Math.round((k / n) * 100)}%` : "n/a");
  const built = rs.filter((r) => r.built);
  const keptAll = built.reduce((s, r) => s + r.kept, 0);
  const movedAll = built.reduce((s, r) => s + r.moved.length, 0);
  const avg = (xs: number[]) => (xs.length ? (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1) : "n/a");
  return [
    "| Model | Correct change | Built | Right kind | Made | Parts match | Parts kept in place | Code passes | Avg s/change |",
    "|---|---|---|---|---|---|---|---|---|",
    `| ${model} | ${pct(rs.filter((r) => r.correct).length)} | ${pct(built.length)} | ${pct(rs.filter((r) => r.kind === r.expectedKind).length)} | ${pct(rs.filter((r) => r.made).length)} | ${pct(rs.filter((r) => r.partsMatch).length)} | ${keptAll + movedAll ? `${keptAll}/${keptAll + movedAll}` : "n/a"} | ${pct(rs.filter((r) => r.codeOk).length)} | ${avg(built.map((r) => r.secondsChange))} |`,
  ].join("\n");
}
