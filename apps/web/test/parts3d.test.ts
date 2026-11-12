// M11 11.1 (user, 11/11/2026): more realistic part models and the "Supported parts" list.
import { describe, expect, it } from "vitest";
import { layoutProject, resolveBuild, type ResolvedPart } from "@breadpilot/circuit-core";
import { holePos } from "../src/scene/coords";
import { partShapes, type ShapeNode } from "../src/scene/shapes";
import { baseLift, resolvedWires, wireLifts } from "../src/scene/model";
import { SUPPORTED_PARTS } from "../src/ui/PartsDialog";

const partOf = (kind: string, ref: string, pin?: string): ResolvedPart => resolveBuild(layoutProject([{ kind, ...(pin ? { pin } : {}) }]).build).resolved!.parts.find((p) => p.ref === ref)!;
/** Every mesh with its position in the part's frame (group offsets added). */
function meshes(n: ShapeNode, at: [number, number, number] = [0, 0, 0]): { geometry: string; args: number[]; pos: [number, number, number]; flat?: boolean; color?: string }[] {
  const pos: [number, number, number] = [at[0] + ((n as { position?: number[] }).position?.[0] ?? 0), at[1] + ((n as { position?: number[] }).position?.[1] ?? 0), at[2] + ((n as { position?: number[] }).position?.[2] ?? 0)];
  if (n.node === "group") return n.children.flatMap((c) => meshes(c, pos));
  if (n.node !== "mesh") return [];
  return [{ geometry: n.geometry.type, args: n.geometry.args as number[], pos, flat: n.material.flatShading, color: n.material.color }];
}

describe("the potentiometer looks like a real one", () => {
  it("has a round body, a hex nut, a threaded bushing and a ribbed shaft with its slot", () => {
    const m = meshes(partShapes(partOf("pot", "POT1"), "done"));
    expect(m.some((x) => x.geometry === "cylinder" && x.args[3] === 6)).toBe(true); // hex nut
    expect(m.some((x) => x.geometry === "cylinder" && x.flat)).toBe(true); // knurled shaft
    expect(Math.max(...m.map((x) => x.pos[1]))).toBeGreaterThan(14); // the shaft stands up
    expect(m.some((x) => x.color === "#8a4b23")).toBe(true); // brown circuit-board tab
  });

  it("its body sits toward the channel, not over the outer holes its wires use (both halves)", () => {
    for (const pin of [undefined, "GP27"]) {
      const part = partOf("pot", "POT1", pin);
      const legX = holePos(Object.values(part.legs)[0]!)[0];
      const body = meshes(partShapes(part, "done")).find((x) => x.geometry === "cylinder" && x.args[0] === 5)!;
      // toward the channel = toward x = 0
      expect(Math.abs(body.pos[0])).toBeLessThan(Math.abs(legX));
    }
  });
});

describe("the push button has a metal plate and a round plunger", () => {
  it("plate, four bent sides and the cap on top", () => {
    const m = meshes(partShapes(partOf("button", "BTN1"), "done"));
    expect(m.filter((x) => x.color === "#c3c8cf").length).toBe(5);
    const top = m.reduce((a, b) => (b.pos[1] > a.pos[1] ? b : a));
    expect(top.geometry).toBe("cylinder");
  });
});

describe("Supported parts list", () => {
  it("lists every part the AI can plan with, from the packs, each with a description", () => {
    expect(SUPPORTED_PARTS.map((p) => p.kind)).toEqual(["led", "button", "pot", "oled"]);
    for (const p of SUPPORTED_PARTS) {
      expect(p.name.length).toBeGreaterThan(2);
      expect(p.text).toMatch(/^[A-Z]/);
    }
    expect(SUPPORTED_PARTS.find((p) => p.kind === "led")!.text).toMatch(/resistor is added automatically/);
  });
});

describe("wires don't go through each other (user, 11/11/2026)", () => {
  it("of two crossing wires, the longer one goes over the shorter one", () => {
    const lifts = wireLifts([
      { id: "short", from: [0, 0, 0], to: [10, 0, 0] },
      { id: "long", from: [5, -20, -20], to: [5, 0, 20] },
    ]);
    expect(lifts.get("short")).toBeCloseTo(baseLift([0, 0, 0], [10, 0, 0]));
    expect(lifts.get("long")! * 0.8).toBeGreaterThanOrEqual(lifts.get("short")! + 2.2 - 1e-9);
  });

  it("wires far apart or sharing a hole keep their own height", () => {
    const lifts = wireLifts([
      { id: "a", from: [0, 0, 0], to: [10, 0, 0] },
      { id: "b", from: [0, 0, 30], to: [10, 0, 30] },
      { id: "c", from: [10, 0, 0], to: [10, 0, 12] },
    ]);
    expect(lifts.get("b")).toBeCloseTo(baseLift([0, 0, 30], [10, 0, 30]));
    expect(lifts.get("c")).toBeCloseTo(baseLift([10, 0, 0], [10, 0, 12]));
  });

  it("on real boards (the examples' parts, both power modes), no wires that meet share a height", () => {
    const boards = [[{ kind: "pot" }, { kind: "led" }], [{ kind: "oled" }, { kind: "pot" }, { kind: "led" }, { kind: "button" }], [{ kind: "led" }, { kind: "led" }, { kind: "led" }, { kind: "button" }, { kind: "button" }, { kind: "button" }]];
    for (const reqs of boards) for (const power of ["rails", "direct"] as const) {
      const l = layoutProject(reqs, undefined, { power });
      const resolved = resolveBuild(l.build).resolved!;
      const ws = resolvedWires(resolved, l.build.wires, () => "done");
      const near = (p: number[], q: number[]) => Math.abs(p[0]! - q[0]!) < 0.01 && Math.abs(p[2]! - q[2]!) < 0.01;
      for (const a of ws) for (const b of ws) {
        if (a === b || a.lift! > b.lift! || near(a.from, b.from) || near(a.from, b.to) || near(a.to, b.from) || near(a.to, b.to)) continue;
        const lifts = wireLifts([a, b]);
        if (lifts.get(b.id) === baseLift(b.from, b.to) && lifts.get(a.id) === baseLift(a.from, a.to)) continue; // they don't meet
        expect(b.lift! * 0.8, `${a.id}/${b.id}`).toBeGreaterThanOrEqual(a.lift! + 2.2 - 1e-9);
      }
    }
  });
});
