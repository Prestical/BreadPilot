// M18 18.4: tests that break good circuits. Random engine layouts of every part kind, in both power
// modes, must validate with zero issues; then each break in breaks.ts (resistor bypassed or too
// small, LED backwards, both legs in one strip, GPIO to GND/3V3/VBUS, outputs joined, supply
// reversed, a 5 V supply, ground removed, pull-up removed) must give one of its expected codes.

import { describe, expect, it } from "vitest";
import { layoutProject, LayoutError, POWER_MODES, type BlockRequest } from "../src/layout";
import { PACKS } from "../src/packs";
import { validateBuild } from "../src/validate";
import { BREAKERS } from "./breaks";

const KINDS = PACKS.flatMap((p) => (p.meta.kind && p.layout ? [p.meta.kind] : []));

/** Seeded random part lists (the same every run), plus fixed ones with many switches. */
function baseRequests(): BlockRequest[][] {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const lists: BlockRequest[][] = Array.from({ length: 400 }, () => Array.from({ length: 1 + Math.floor(rand() * 6) }, () => ({ kind: KINDS[Math.floor(rand() * KINDS.length)]! })));
  // More than 8 switch contacts: the validator's reduced switch-state list (18.1).
  lists.push([...Array.from({ length: 9 }, () => ({ kind: "button" })), { kind: "led" }]);
  lists.push([...Array.from({ length: 5 }, () => ({ kind: "button" })), { kind: "slide-switch" }, { kind: "led" }, { kind: "led" }]);
  return lists;
}

describe("breaking good circuits", () => {
  const tried: Record<string, number> = Object.fromEntries(Object.keys(BREAKERS).map((k) => [k, 0]));
  const missed: string[] = [];
  const dirty: string[] = [];
  const usedKinds = new Set<string>();
  const unnamed = new Map<string, string>();
  let bases = 0;
  let manySwitches = 0;

  for (const power of POWER_MODES) {
    for (const reqs of baseRequests()) {
      let layout;
      try {
        layout = layoutProject(reqs, undefined, { power });
      } catch (e) {
        if (e instanceof LayoutError) continue;
        throw e;
      }
      bases++;
      reqs.forEach((r) => usedKinds.add(r.kind));
      if (reqs.filter((r) => r.kind === "button").length >= 5) manySwitches++;
      const what = `${power} [${reqs.map((r) => r.kind).join(", ")}]`;
      const base = validateBuild(layout.build).issues.map((i) => i.code);
      if (base.length) dirty.push(`${what}: ${base.join(", ")}`);
      for (const [name, brk] of Object.entries(BREAKERS)) {
        for (const x of brk(layout.build)) {
          tried[name]!++;
          const issues = validateBuild(x.build).issues;
          const codes = issues.map((i) => i.code);
          for (const i of issues) {
            const named = [...(i.pins ?? []), ...(i.parts ?? [])];
            if (i.message.length < 20 || !named.length || !named.some((n) => i.message.includes(n))) unnamed.set(i.code, i.message);
          }
          if (!x.expect.some((c) => codes.includes(c))) missed.push(`${what} ${x.what}: expected ${x.expect.join(" or ")}, got ${codes.join(", ") || "nothing"}`);
        }
      }
    }
  }

  it("lays out every part kind, including more than 8 switch contacts", () => {
    expect([...usedKinds].sort()).toEqual([...KINDS].sort());
    expect(bases).toBeGreaterThan(500);
    expect(manySwitches).toBeGreaterThan(0);
  });

  it("every base circuit is clean (no errors, no warnings)", () => {
    expect(dirty).toEqual([]);
  });

  it.each(Object.keys(BREAKERS))("%s runs on enough circuits", (name) => {
    expect(tried[name]).toBeGreaterThanOrEqual(20);
  });

  // The 3D view highlights an issue's pins and parts, so each one must name what it's about.
  it("every issue names a pin or part that its message talks about", () => {
    expect(Object.fromEntries(unnamed)).toEqual({});
  });

  it("every break is caught", () => {
    expect(missed.slice(0, 20)).toEqual([]);
  });
});
