// The sidebar examples: projects made in BreadPilot and exported. For the v0.4.0 beta they are the
// "needs testing" projects (26/11/2026). Each must stay a safe build in both power modes whose code
// passes the wiring check and runs in the behaviour simulator without a finding, and opens in the
// Code view like a project. The list may be empty while the projects are being made.
import { checkMicroPython, driversFor, PICO_2_W } from "@breadpilot/circuit-core";
import { checkBehaviour } from "@breadpilot/sim";
import { describe, expect, it } from "vitest";
import { canWireDirect, DEMOS, EXAMPLE_PREFIX, exampleAsProject, loadProject } from "../src/demos";
import { untestedParts } from "../src/ui/report";

describe("the examples", () => {
  it("a \"Needs testing\" example has parts not yet tried on a real Pico (so it asks for a report)", () => {
    for (const d of DEMOS.filter((x) => x.level === "Needs testing")) expect(untestedParts(loadProject(d.id).build).length, d.id).toBeGreaterThan(0);
  });

  for (const d of DEMOS) {
    for (const power of ["rails", "direct"] as const) {
      it(`${d.title} (${power}): the code passes the wiring check`, () => {
        const p = loadProject(d.id, power); // buildSteps throws for an unsafe build
        const check = checkMicroPython(d.code, p.build, PICO_2_W);
        expect(check.issues.filter((i) => i.severity === "error"), d.id).toEqual([]);
        expect(check.ok).toBe(true);
      });
    }

    it(`${d.title}: the simulator's automatic test finds nothing`, async () => {
      const build = loadProject(d.id).build;
      const files = Object.fromEntries(driversFor(build.parts.map((x) => x.type)).map((f) => [f.file, f.source]));
      const c = await checkBehaviour({ code: d.code, circuit: build, files });
      expect(c.findings, d.id).toEqual([]);
      expect(c.result.ended).toBe("time limit");
    }, 30_000);

    it(`${d.title}: opens in the Code view as a project with its code, explanation and plan`, () => {
      const p = exampleAsProject(d.id, "direct")!;
      expect(p.id).toBe(`${EXAMPLE_PREFIX}${d.id}`);
      expect(p.state).toBe("READY");
      expect(p.build!.code).toBe(d.code);
      expect(p.build!.codeExplanation).toBe(d.explanation);
      expect(p.plans[0]!.behavior.length).toBeGreaterThan(0);
      // Direct mode uses no rails; an example with too many powered parts stays on the rails.
      expect(p.build!.build.wires.some((w) => w.from.kind === "rail" || w.to.kind === "rail")).toBe(!canWireDirect(d.id));
      expect(p.power).toBe(canWireDirect(d.id) ? "direct" : "rails");
    });
  }

  it("only the sound board (five powered modules) is rails-only; the single-part projects can be wired direct", () => {
    expect(DEMOS.filter((d) => !canWireDirect(d.id)).map((d) => d.id)).toEqual(["test-sound-board"]);
  });

  it("an unknown example opens nothing", () => {
    expect(exampleAsProject("nope")).toBeNull();
  });
});
