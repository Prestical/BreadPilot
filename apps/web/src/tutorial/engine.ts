// Tutorial engine: pure functions, unit-tested in apps/web/test/tutorial.test.ts.

import { formatWire, parseConnections, PICO_2_W, resolveBuild, validateBuild, type Build, type Endpoint, type Issue, type Wire } from "@breadpilot/circuit-core";
import { parseTargetKey, targetKey, targetMatches, type Target } from "../scene/targets";
import type { Chapter, Expectation } from "./chapters";

export interface Feedback {
  ok: boolean;
  message: string;
  issue?: Issue;
}

export function chapterBuild(chapter: Chapter, extraWires: Wire[] = []): Build {
  const parsed = parseConnections((chapter.wires ?? []).join("\n"));
  if (parsed.errors.length) throw new Error(`Tutorial chapter ${chapter.id}: ${parsed.errors[0]!.message}`);
  return { boardId: PICO_2_W.id, parts: chapter.parts ?? [], wires: [...parsed.wires, ...extraWires], gpioModes: chapter.gpioModes ?? {} };
}

export function targetToEndpoint(t: Target): Endpoint {
  if (t.kind === "pin") {
    const pin = PICO_2_W.pins.find((p) => p.phys === t.phys)!;
    return { kind: "pico", phys: pin.phys, label: pin.name };
  }
  if (t.kind === "rail") return { kind: "rail", rail: t.rail, row: t.row };
  const m = /^(\d+)([a-j])$/.exec(t.key)!;
  return { kind: "hole", row: Number(m[1]), col: m[2] as never };
}

const matchesAny = (t: Target, accept: string[]) => accept.some((a) => targetMatches(t, a));

export function checkClick(expect: Extract<Expectation, { type: "click" }>, t: Target): Feedback {
  return matchesAny(t, expect.accept) ? { ok: true, message: expect.success } : { ok: false, message: `Not quite. ${expect.hint}` };
}

/** Checks a two-click wire. Runs the real validator, so tutorial feedback = real safety rules. */
export function checkWire(chapter: Chapter, expect: Extract<Expectation, { type: "wire" }>, a: Target, b: Target): Feedback & { wire: Wire; dsl: string } {
  const wire: Wire = { from: targetToEndpoint(a), to: targetToEndpoint(b) };
  const dsl = formatWire(wire);
  const placed = (matchesAny(a, expect.from) && matchesAny(b, expect.to)) || (matchesAny(b, expect.from) && matchesAny(a, expect.to));
  if (!placed) return { ok: false, message: `That wire went to a different place. ${expect.hint}`, wire, dsl };

  const report = validateBuild(chapterBuild(chapter, [wire]));
  if (expect.mustFail) {
    const issue = report.issues.find((i) => i.code === expect.mustFail);
    return issue ? { ok: true, message: expect.success, issue, wire, dsl } : { ok: false, message: expect.hint, wire, dsl };
  }
  const error = report.issues.find((i) => i.severity === "error");
  return error ? { ok: false, message: error.message, issue: error, wire, dsl } : { ok: true, message: expect.success, wire, dsl };
}

/** Throws if a chapter refers to impossible targets or an unsafe build (used by tests). */
export function lintChapter(chapter: Chapter): void {
  const keys = (list: string[] | undefined) => list ?? [];
  const isRailOnly = (k: string) => /^R[LR][+-]$/.test(k);
  for (const [i, step] of chapter.steps.entries()) {
    const where = `${chapter.id} step ${i + 1}`;
    for (const k of [...keys(step.focus), ...keys(step.highlight)]) if (!parseTargetKey(k)) throw new Error(`${where}: bad target "${k}"`);
    const e = step.expect;
    if (e.type === "click" || e.type === "wire") {
      const all = e.type === "click" ? e.accept : [...e.from, ...e.to];
      for (const k of all) if (!parseTargetKey(k) && !isRailOnly(k)) throw new Error(`${where}: bad answer "${k}"`);
      if (!e.hint || !e.success) throw new Error(`${where}: needs a hint and a success message`);
    }
  }
  const { issues } = resolveBuild(chapterBuild(chapter));
  if (issues.length) throw new Error(`${chapter.id}: ${issues[0]!.message}`);
  const errors = validateBuild(chapterBuild(chapter)).issues.filter((i) => i.severity === "error");
  if (errors.length) throw new Error(`${chapter.id}: ${errors[0]!.message}`);
}

export { targetKey };
