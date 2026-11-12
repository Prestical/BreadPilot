// M9: what a change does to the parts list, for the approval card (pure, unit-tested).
import type { PlanPart, PlanVersion } from "./types";

export interface PartsChange {
  /** New parts, e.g. "Potentiometer". */
  added: string[];
  /** Parts that go. */
  removed: string[];
  /** The same kind of part in another form or on another pin, e.g. "Red LED → Blue LED". */
  changed: string[];
  /** How many parts stay exactly as they are. */
  kept: number;
}

/**
 * Compares the parts of the plan before a change with the new plan. Parts are the same when their
 * name (with its colour) and pin match; what's left of the same kind on both sides is "changed".
 * `name` gives a part's display name (the plan view's planPartName).
 */
export function partsChange(before: PlanVersion, after: PlanVersion, name: (p: PlanPart) => string): PartsChange {
  const label = (p: PlanPart) => `${name(p)}${p.pin ? ` on ${p.pin}` : ""}`;
  const left = [...before.parts];
  const right: PlanPart[] = [];
  let kept = 0;
  for (const p of after.parts) {
    const i = left.findIndex((q) => q.kind === p.kind && label(q) === label(p));
    if (i >= 0) {
      left.splice(i, 1);
      kept++;
    } else right.push(p);
  }
  const changed: string[] = [];
  for (let i = right.length - 1; i >= 0; i--) {
    const j = left.findIndex((q) => q.kind === right[i]!.kind);
    if (j < 0) continue;
    changed.unshift(`${label(left[j]!)} → ${label(right[i]!)}`);
    left.splice(j, 1);
    right.splice(i, 1);
  }
  return { added: right.map(label), removed: left.map(label), changed, kept };
}
