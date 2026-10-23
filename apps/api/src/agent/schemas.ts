// Output schemas for each pipeline stage. Enums restrict the model to parts we can
// wire safely (the layout templates); anything else becomes "unsupported".

import * as z from "zod/v4";
import { PACKS } from "@breadpilot/circuit-core";

/** Plan kinds of the part packs the model may pick (parts/<id>/pack.json "kind"), in pack order. */
export const PART_KINDS = PACKS.flatMap((p) => (p.meta.kind ? [p.meta.kind] : [])) as [string, ...string[]];
export type PartKind = string;

/**
 * Plan fields that become layout props (agent.json plan.props, e.g. an LED's "color"), with the
 * values the part allows (its part.json props enum).
 */
export const PLAN_PROPS: Record<string, string[]> = {};
for (const pack of PACKS) {
  for (const [field, request] of Object.entries(pack.agent?.plan.props ?? {})) {
    const tp = pack.layout!.parts.find((x) => x.props && Object.values(x.props).some((v) => v.request === request))!;
    const key = Object.entries(tp.props!).find(([, v]) => v.request === request)![0];
    const def = tp.type === "self" ? pack.part : PACKS.find((p) => p.meta.id === tp.type)!.part;
    PLAN_PROPS[field] = [...new Set([...(PLAN_PROPS[field] ?? []), ...(def.props?.[key]?.enum ?? [])])];
  }
}

// Schemas only require what the pipeline can't do without (non-empty text, at least one part).
// Size limits are applied by normalize*() in code: rejecting a 61-character title or a 7th
// list item made the 4B model retry and sometimes fail (live eval run 1). The old "max 6 parts"
// also forced the dice plan to drop its button; the layout engine now decides what fits.

export const IntakeSchema = z.object({
  clarity: z.enum(["clear", "vague", "unsupported"]),
  title: z.string().min(1),
  goal: z.string().min(1),
  behaviors: z.array(z.string()),
  missing: z.array(z.string()),
  unsupportedParts: z.array(z.string()),
});
export type Intake = z.infer<typeof IntakeSchema>;

export type PlanPart = { kind: PartKind; purpose: string; pin?: string } & { [prop: string]: string | undefined };

export const PlanPartSchema = z.object({
  kind: z.enum(PART_KINDS),
  purpose: z.string().min(1),
  ...Object.fromEntries(Object.entries(PLAN_PROPS).map(([k, values]) => [k, z.enum(values as [string, ...string[]]).optional()])),
  pin: z.string().optional(),
});

export const PlanSchema = z.object({
  title: z.string().min(1),
  goal: z.string().min(1),
  behavior: z.array(z.string().min(1)).min(1),
  /** May be empty only for on-board-LED projects (checked by planProblems). */
  parts: z.array(PlanPartSchema),
  questions: z.array(z.string()),
});
export type Plan = Omit<z.infer<typeof PlanSchema>, "parts"> & { parts: PlanPart[] };

export const CodeSchema = z.object({
  code: z.string().min(1),
  explanation: z.string().min(1),
});
export type CodeOutput = z.infer<typeof CodeSchema>;

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s.trim());
const list = (a: string[], items: number, chars: number) => a.map((x) => cut(x, chars)).filter(Boolean).slice(0, items);

export function normalizeIntake(i: Intake): Intake {
  return {
    clarity: i.clarity,
    title: cut(i.title, 60),
    goal: cut(i.goal, 300),
    behaviors: list(i.behaviors, 8, 200),
    missing: list(i.missing, 5, 200),
    unsupportedParts: list(i.unsupportedParts, 5, 80),
  };
}

/** `allowedPins`: GPIOs the user actually asked for; any other pin the model set is dropped (it invents pins). */
export function normalizePlan(p: Plan, allowedPins: string[] = []): Plan {
  return {
    title: cut(p.title, 60),
    goal: cut(p.goal, 300),
    behavior: list(p.behavior, 10, 200),
    questions: list(p.questions, 3, 200),
    parts: p.parts.slice(0, 12).map((part) => {
      const pin = part.pin?.trim().toUpperCase();
      return {
        kind: part.kind,
        purpose: cut(part.purpose, 120),
        ...Object.fromEntries(Object.keys(PLAN_PROPS).flatMap((k) => (part[k] ? [[k, part[k]]] : []))),
        // Invalid or unrequested pins are dropped (pins are then chosen automatically), not fatal.
        ...(pin && /^GP\d{1,2}$/.test(pin) && allowedPins.includes(pin) ? { pin } : {}),
      };
    }),
  };
}
