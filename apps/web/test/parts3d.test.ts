// M11 11.1 (user, 11/11/2026): more realistic part models and the "Supported parts" list.
import { describe, expect, it } from "vitest";
import { layoutProject, resolveBuild, type ResolvedPart } from "@breadpilot/circuit-core";
import { holePos } from "../src/scene/coords";
import { PACKS } from "@breadpilot/circuit-core";
import { partShapes, type ShapeNode } from "../src/scene/shapes";
import { boardPrint, MAT, matLines } from "../src/scene/textures";
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

/** Every node of one kind ("lead", "rod"…), groups walked. */
function nodes<K extends ShapeNode["node"]>(n: ShapeNode, kind: K): Extract<ShapeNode, { node: K }>[] {
  return [...(n.node === kind ? [n as Extract<ShapeNode, { node: K }>] : []), ...(n.node === "group" ? n.children.flatMap((c) => nodes(c, kind)) : [])];
}

describe("realistic part shapes (user, 11/11/2026)", () => {
  it("no part the AI can plan with is a grey box: every one has a 3D shape", () => {
    for (const p of PACKS.filter((x) => x.meta.kind && x.agent)) expect(p.view?.shape, p.meta.id).toBeTruthy();
  });

  it("LED: a turned body with a round dome on a wider rim, and the two metal pieces inside", () => {
    const m = meshes(partShapes(partOf("led", "LED1"), "done"));
    const dome = m.find((x) => x.geometry === "lathe")!;
    const rim = m.find((x) => x.geometry === "cylinder" && x.args[0]! > 2.5)!;
    expect(rim.pos[1]).toBeLessThan(dome.pos[1]);
    expect(m.filter((x) => x.geometry === "box").length).toBe(2); // anvil and post
  });

  it("resistor: one wire bent down into both holes, a turned body and four colour bands", () => {
    const part = partOf("led", "R1");
    const tree = partShapes(part, "done");
    const [lead] = nodes(tree, "lead");
    expect(lead!.points.length).toBe(4);
    expect(lead!.points[0]).toEqual(holePos(part.legs.a!));
    expect(lead!.points[3]).toEqual(holePos(part.legs.b!));
    const m = meshes(tree);
    expect(m.filter((x) => x.geometry === "lathe").length).toBe(1);
    expect(m.filter((x) => x.geometry === "cylinder").length).toBe(4);
  });

  it("button: four legs that leave the body's sides and bend down into their holes", () => {
    const part = partOf("button", "BTN1");
    const leads = nodes(partShapes(part, "done"), "lead");
    expect(leads.length).toBe(4);
    const holes = Object.values(part.legs).map((h) => holePos(h).join());
    for (const l of leads) expect(holes).toContain(l.points[0]!.join());
  });

  it("slide switch: a body over its three legs and the slider on top, toward outer leg 1", () => {
    const part = partOf("slide-switch", "SW1");
    const tree = partShapes(part, "done");
    expect(nodes(tree, "rod").length).toBe(3);
    const boxes = meshes(tree).filter((x) => x.geometry === "roundedBox");
    const [body, slider] = boxes;
    expect(slider!.pos[1]).toBeGreaterThan(body!.pos[1] + body!.args[1]! / 2);
    const end1 = holePos(part.legs.end1!);
    const end2 = holePos(part.legs.end2!);
    // group offsets are added without the group's turn: the slider's shift shows on one axis
    const shift = Math.abs(slider!.pos[0] - body!.pos[0]) + Math.abs(slider!.pos[2] - body!.pos[2]);
    expect(shift).toBeGreaterThan(1);
    expect(end1).not.toEqual(end2);
  });

  it("buzzer module: an upright board with the buzzer on the channel side and the three pin names", () => {
    const part = partOf("buzzer", "BZ1");
    const tree = partShapes(part, "done");
    const m = meshes(tree);
    const legX = holePos(part.legs.io!)[0];
    const board = m.find((x) => x.geometry === "box" && x.args[1] === 32)!;
    expect(board.args[0]).toBeLessThan(2); // thin: it stands on its edge
    const buzzer = m.find((x) => x.geometry === "cylinder" && x.args[0] === 6)!;
    expect(Math.abs(buzzer.pos[0])).toBeLessThan(Math.abs(legX));
    const names = nodes(tree, "group").flatMap((g) => g.children).flatMap((c) => (c.node === "mesh" && c.material.map ? [c.material.map.text] : []));
    expect(names).toEqual(["GND", "I/O", "VCC"]);
  });

  it("DHT11: a case on four legs with a grid of openings on its front", () => {
    const part = partOf("dht11", "DHT1");
    const tree = partShapes(part, "done");
    expect(nodes(tree, "rod").length).toBe(4);
    const m = meshes(tree);
    const body = m.find((x) => x.geometry === "roundedBox" && x.args[1] === 15.5)!;
    const grid = m.filter((x) => x.geometry === "box" && x.args[0] === 0.1);
    expect(grid.length).toBe(24);
    // all openings are on one face, in front of the body
    expect(new Set(grid.map((x) => x.pos[0].toFixed(3))).size).toBe(1);
    expect(grid[0]!.pos[0]).toBeLessThan(body.pos[0]);
  });

  it("ghost parts (not placed yet) are see-through in every shape", () => {
    for (const [kind, ref] of [["led", "LED1"], ["button", "BTN1"], ["slide-switch", "SW1"], ["pot", "POT1"], ["oled", "OLED1"], ["dht11", "DHT1"], ["buzzer", "BZ1"]] as const) {
      const all = nodes(partShapes(partOf(kind, ref), "ghost"), "group").flatMap((g) => g.children).filter((c) => c.node === "mesh");
      expect(all.length, kind).toBeGreaterThan(0);
      for (const c of all) if (c.node === "mesh") expect(c.material.opacity, kind).toBeLessThan(1);
    }
  });
});

describe("the printed breadboard top and the cutting mat", () => {
  it("prints row 1 and every fifth row on both sides, a-j at both ends, and + / − on the rails", () => {
    const { texts, lines } = boardPrint();
    const rows = texts.filter((t) => /^\d+$/.test(t.text));
    expect([...new Set(rows.map((t) => t.text))]).toEqual(["1", "5", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55", "60"]);
    expect(rows.length).toBe(26);
    expect(texts.filter((t) => /^[a-j]$/.test(t.text)).length).toBe(20);
    expect(texts.filter((t) => t.text === "+").length).toBe(4);
    expect(texts.filter((t) => t.text === "−").length).toBe(4);
    // a number sits at its row, outside columns a and j
    const ten = rows.filter((t) => t.text === "10");
    expect(ten.map((t) => t.z)).toEqual([holePos({ row: 10, col: "a" })[2], holePos({ row: 10, col: "a" })[2]]);
    expect(ten[0]!.x).toBeLessThan(holePos({ row: 10, col: "a" })[0]);
    expect(ten[1]!.x).toBeGreaterThan(holePos({ row: 10, col: "j" })[0]);
    expect(lines.filter((l) => l.color === "#d93a3a").length).toBe(2);
    expect(lines.filter((l) => l.color === "#2f6fd6").length).toBe(2);
  });

  it("the mat has a line every centimetre, a bold one every 5 cm, ending on bold lines", () => {
    const { vertical, horizontal } = matLines();
    expect(vertical.length).toBe((MAT.width - 2 * MAT.margin) / 10 + 1);
    expect(horizontal.length).toBe((MAT.depth - 2 * MAT.margin) / 10 + 1);
    for (const set of [vertical, horizontal]) {
      expect(set[0]!.bold && set.at(-1)!.bold).toBe(true);
      expect(set.filter((l) => l.bold).length).toBe((set.length - 1) / 5 + 1);
    }
  });
});

describe("Supported parts list", () => {
  it("lists every part the AI can plan with, from the packs, each with a description", () => {
    expect(SUPPORTED_PARTS.map((p) => p.kind)).toEqual(["led", "button", "slide-switch", "pot", "oled", "dht11", "buzzer"]);
    for (const p of SUPPORTED_PARTS) {
      expect(p.name.length).toBeGreaterThan(2);
      expect(p.text).toMatch(/^[A-Z]/);
    }
    expect(SUPPORTED_PARTS.find((p) => p.kind === "led")!.text).toMatch(/resistor is added automatically/);
    expect(SUPPORTED_PARTS.find((p) => p.kind === "dht11")!.text).toMatch(/pull-up resistor is added automatically/);
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
