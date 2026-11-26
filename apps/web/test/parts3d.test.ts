// M11 11.1 (user, 11/11/2026): more realistic part models and the "Supported parts" list.
import { describe, expect, it } from "vitest";
import { checkViewSpec, layoutProject, resolveBuild, type ResolvedPart, type ViewSpec } from "@breadpilot/circuit-core";
import { holePos } from "../src/scene/coords";
import { PACKS } from "@breadpilot/circuit-core";
import { partShapes, segments, viewShapes, type ShapeNode } from "../src/scene/shapes";
import { previewFrame } from "../src/scene/PartPreview";
import { BOARD, PICO, PITCH, colX } from "../src/scene/coords";
import { boardPrint, MAT, matLines } from "../src/scene/textures";
import { baseLift, resolvedWires, wireLifts } from "../src/scene/model";
import { SUPPORTED_GROUPS, SUPPORTED_PARTS } from "../src/ui/PartsDialog";

const partOf = (kind: string, ref: string, pin?: string): ResolvedPart => resolveBuild(layoutProject([{ kind, ...(pin ? { pin } : {}) }]).build).resolved!.parts.find((p) => p.ref === ref)!;
/**
 * A part's model from its pack's view.json; `placedOf` puts it in its holes. (The models of parts
 * without a pack yet were moved out of the app for v0.4.0, user 25/11/2026.)
 */
const lookOf = (id: string) => {
  const pack = PACKS.find((p) => p.meta.id === id);
  if (!pack?.view) throw new Error(`no model or pack "${id}"`);
  return { id, name: pack.part.name, view: pack.view, legs: {} };
};
const placedOf = (id: string): ResolvedPart => {
  const pack = PACKS.find((p) => p.meta.id === id)!;
  return resolveBuild(layoutProject([{ kind: pack.meta.kind! }]).build).resolved!.parts.find((p) => p.def.id === id)!;
};
const lookTree = (id: string, state: "done" | "ghost" = "done") => viewShapes(lookOf(id).view, placedOf(id), state);

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

describe("models of the phase 17.1 parts (PLAN 17.1), now in their packs", () => {
  // A model leaves upcoming.ts unchanged when its pack is made (17/11/2026: all but the Hall sensor and the soil sensor).
  const packOf = (id: string) => PACKS.find((p) => p.meta.id === id);
  const model = lookOf;
  const placed = placedOf;
  const tree = lookTree;
  const MOVED = ["active-buzzer", "photoresistor", "ntc-thermistor", "tilt-switch", "reed-switch", "touch-sensor", "ir-obstacle-sensor", "flame-sensor", "sound-sensor", "water-level-sensor", "dht22", "hall-sensor", "soil-moisture-sensor"];

  it("all 13 parts have packs that carry their model in view.json (19/11/2026: the Hall and soil sensors too)", () => {
    for (const id of MOVED) {
      expect(packOf(id)?.view, id).toBeDefined();
      expect(() => checkViewSpec(packOf(id)!.view!, id), id).not.toThrow();
    }
  });

  it("a pack's model stands in the holes its layout gives, with one highlighted body", () => {
    for (const id of MOVED) {
      const part = placed(id);
      const t = tree(id);
      const starts = [...nodes(t, "rod").map((r) => r.from.join()), ...nodes(t, "lead").flatMap((l) => [l.points[0]!.join(), l.points.at(-1)!.join()])];
      for (const h of Object.values(part.legs)) expect(starts, id).toContain(holePos(h).join());
      const all = (n: ShapeNode): ShapeNode[] => [n, ...(n.node === "group" ? n.children.flatMap(all) : [])];
      expect(all(t).filter((n) => n.node === "mesh" && n.pulse).length, id).toBe(1);
      for (const n of all(tree(id, "ghost"))) if (n.node === "mesh") expect(n.material.opacity, id).toBeLessThan(1);
      for (const x of meshes(t)) expect([...x.args, ...x.pos].every(Number.isFinite), id).toBe(true);
    }
  });

  it("the format refuses a feature it doesn't know", () => {
    expect(() => checkViewSpec({ ...model("flame-sensor").view, features: [{ type: "laser", at: [0, 0] }] }, "x")).toThrow(/features\[0\]\.type/);
  });

  it("active buzzer: the 3-pin module, built like the passive buzzer module", () => {
    const active = packOf("active-buzzer")!.view!;
    const passive = packOf("passive-buzzer")!.view!;
    expect(active.shape).toBe("upright-module");
    expect((active as { pins: string[] }).pins).toEqual((passive as { pins: string[] }).pins);
    expect(meshes(tree("active-buzzer")).some((x) => x.geometry === "cylinder" && x.args[0] === 6)).toBe(true);
  });

  it("photoresistor: a zigzag of five bars joined at alternating ends, all on the disc", () => {
    const m = meshes(tree("photoresistor"));
    const disc = m.find((x) => x.geometry === "cylinder" && x.args[0] === 2.55)!;
    const bars = m.filter((x) => x.geometry === "box" && x.args[2] === 0.24);
    const joins = m.filter((x) => x.geometry === "box" && x.args[0] === 0.24);
    expect(bars.length).toBe(5);
    expect(joins.length).toBe(4);
    expect(joins.map((j) => Math.sign(j.pos[0] - disc.pos[0]))).toEqual([1, -1, 1, -1]);
    for (const b of bars) expect(Math.hypot(b.args[0]! / 2 + Math.abs(b.pos[0] - disc.pos[0]), b.pos[2] - disc.pos[2])).toBeLessThan(2.55);
  });

  it("reed switch: two reeds that overlap in the middle without touching, each wire ends inside the glass", () => {
    const t = tree("reed-switch");
    const reeds = meshes(t).filter((x) => x.geometry === "box");
    expect(reeds.length).toBe(2);
    expect(Math.abs(reeds[0]!.pos[1] - reeds[1]!.pos[1])).toBeGreaterThan(reeds[0]!.args[1]!);
    const leads = nodes(t, "lead");
    expect(leads.length).toBe(2);
    expect(leads[0]!.points.at(-1)).not.toEqual(leads[1]!.points.at(-1));
  });

  it("modules: the parts sit on the channel side of the board, and the pin names are printed", () => {
    for (const id of ["hall-sensor", "touch-sensor", "ir-obstacle-sensor", "flame-sensor", "sound-sensor", "water-level-sensor"]) {
      const m = model(id);
      const part = placed(id);
      const legX = holePos(Object.values(part.legs)[0]!)[0];
      const t = tree(id);
      const names = nodes(t, "group").flatMap((g) => g.children).flatMap((c) => (c.node === "mesh" && c.material.map ? [c.material.map.text] : []));
      expect(names, id).toEqual((m.view as { labels: string[] }).labels);
      // every mesh is on the board or on its channel side (toward x = 0), up to the solder joints' 0.3 mm
      for (const x of meshes(t)) expect(Math.abs(x.pos[0]), id).toBeLessThan(Math.abs(legX) + 1.2);
    }
  });

  it("IR obstacle sensor has two emitters past the top edge, the flame sensor one", () => {
    const domes = (id: string) => meshes(tree(id)).filter((x) => x.geometry === "lathe");
    expect(domes("ir-obstacle-sensor").length).toBe(2);
    expect(domes("flame-sensor").length).toBe(1);
    for (const d of domes("ir-obstacle-sensor")) expect(d.pos[1]).toBeGreaterThan(32);
  });

  it("soil moisture sensor: the capacitive probe lies on the mat beside the breadboard, pointing away, on three wires", () => {
    const part = placed("soil-moisture-sensor");
    const t = tree("soil-moisture-sensor");
    const legX = holePos(part.legs.aout!)[0];
    const m = meshes(t);
    const head = m.find((x) => x.geometry === "box" && x.args[0] === 25 && x.args[2] === 23)!;
    const probe = m.find((x) => x.geometry === "box" && x.args[2] === 21)!;
    expect(Math.sign(head.pos[0])).toBe(Math.sign(legX)); // on the part's own side
    expect(Math.abs(head.pos[0]) - 12.5).toBeGreaterThan(BOARD.maxX); // all of it beyond the breadboard's edge
    expect(Math.abs(probe.pos[0])).toBeGreaterThan(Math.abs(head.pos[0])); // the probe points away
    expect(head.pos[1] - 0.8).toBeCloseTo(-BOARD.height); // on the mat
    // the shoulder: the probe is narrower than the head; its two lines of print are on it
    const texts = nodes(t, "group").flatMap((g) => g.children).flatMap((c) => (c.node === "mesh" && c.material.map ? [c.material.map.text] : []));
    expect(texts).toEqual(["Capacitive Soil", "Moisture Sensor v1.2"]);
    expect(nodes(t, "lead").filter((l) => l.color).length).toBe(3);
    expect(previewFrame(model("soil-moisture-sensor").view).size).toBeGreaterThan(previewFrame(model("flame-sensor").view).size);
  });

  it("DHT22: a white case with its own grid; the DHT11 keeps its 4 x 6 grid", () => {
    const grid = meshes(tree("dht22")).filter((x) => x.geometry === "box" && x.args[0] === 0.1);
    expect(grid.length).toBe(40);
    expect(grid[0]!.color).toBe("#4a4d53");
  });

  it("the previews of today's parts keep their framing", () => {
    const frame = (kind: string) => previewFrame(PACKS.find((p) => p.meta.kind === kind)!.view);
    expect(frame("oled")).toEqual({ size: 70, lookY: 4 });
    expect(frame("buzzer")).toEqual({ size: 60, lookY: 16 });
    expect(frame("dht11")).toEqual({ size: 46, lookY: 8 });
    expect(frame("led")).toEqual({ size: 34, lookY: 4 });
  });
});

describe("models of the I2C parts (PLAN 17.3)", () => {
  const all3 = (n: ShapeNode): ShapeNode[] => [n, ...(n.node === "group" ? n.children.flatMap(all3) : [])];
  const model = lookOf;
  const tree = (id: string) => lookTree(id);

  it("the 5 I2C parts with packs have a model (the VL53L0X has no pack yet)", () => {
    for (const id of ["oled-ssd1306-i2c", "bme280", "mpu6050", "rtc-ds3231", "light-sensor-bh1750"]) expect(lookOf(id).view, id).toBeDefined();
  });

  it("flat boards: the parts lie on top of the board, between the pin header and the far edge", () => {
    for (const id of ["bme280", "mpu6050", "light-sensor-bh1750"]) {
      const v = model(id).view as Extract<ViewSpec, { shape: "header-module" }>;
      const m = meshes(tree(id));
      const board = m.find((x) => x.geometry === "box" && x.args[0] === v.board.size[0] && x.args[2] === v.board.size[1])!;
      // the feature meshes are the ones in the turned group: the walker adds its offset, and their own
      // x offset is how far they stand off the face, so check the two values the turn doesn't change
      for (const f of v.features!) {
        if (!("at" in f)) continue;
        expect(f.at[1], id).toBeGreaterThan(3);
        expect(f.at[1], id).toBeLessThanOrEqual(v.board.size[0]);
        expect(Math.abs(f.at[0]), id).toBeLessThanOrEqual(v.board.size[1] / 2);
      }
      expect(board.pos[1]).toBe(8.5);
      expect(m.every((x) => [...x.args, ...x.pos].every(Number.isFinite)), id).toBe(true);
    }
  });

  it("the small OLED keeps a lit screen and its four pin names", () => {
    const t = tree("oled-ssd1306-i2c");
    const texts = nodes(t, "group").flatMap((g) => g.children).flatMap((c) => (c.node === "mesh" && c.material.map ? [c.material.map.text] : []));
    expect(texts).toEqual(expect.arrayContaining(["Hello!  128x64", "GND", "VCC", "SCL", "SDA"]));
  });

  it("clock module: the coin cell is on the back of the board, the chips on the front", () => {
    const part = placedOf("rtc-ds3231");
    const legX = holePos(part.legs.vcc!)[0];
    const m = meshes(tree("rtc-ds3231"));
    const cell = m.find((x) => x.geometry === "cylinder" && x.args[0] === 10)!;
    const chip = m.find((x) => x.geometry === "box" && x.args[1] === 10.3)!;
    // the front faces the channel (toward x = 0): the cell is on the other side of the legs
    expect(Math.abs(cell.pos[0])).toBeGreaterThan(Math.abs(legX));
    expect(Math.abs(chip.pos[0])).toBeLessThan(Math.abs(legX));
  });

  it("DS18B20 (17.4): a body round at the back and flat at the front, its name on the flat side, three legs", () => {
    const t = tree("ds18b20");
    expect(nodes(t, "lead").length).toBe(3);
    const round = all3(t).find((n) => n.node === "mesh" && n.geometry.type === "cylinder" && n.geometry.arc)!;
    const arc = (round as { geometry: { arc: [number, number] } }).geometry.arc;
    // more than half of the wall, less than all of it, and the gap is centred on -x (3/2 pi)
    expect(arc[1]).toBeGreaterThan(Math.PI);
    expect(arc[1]).toBeLessThan(2 * Math.PI);
    expect((arc[0] + arc[1] + arc[0] - 2 * Math.PI) / 2).toBeCloseTo((3 * Math.PI) / 2);
    const m = meshes(t);
    const fill = m.find((x) => x.geometry === "box")!;
    // the filling block's front corners lie on the round wall
    expect(Math.hypot(fill.args[0]!, fill.args[2]! / 2)).toBeCloseTo(2.3);
    const name = all3(t).find((n) => n.node === "mesh" && n.material.map)!;
    expect((name as { material: { map: { text: string } } }).material.map.text).toBe("DS18B20");
  });

  it("small boards still get a preview wide enough to see them", () => {
    expect(previewFrame(model("bme280").view).size).toBe(40);
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
    expect(SUPPORTED_PARTS.map((p) => p.kind)).toEqual([
      "led", "button", "slide-switch", "tilt", "reed", "touch", "hall", "pot", "ldr", "bh1750", "ntc", "water-level", "soil", "oled", "oled-small",
      "dht11", "dht22", "ds18b20", "obstacle", "bme280", "flame", "sound-sensor", "vibration", "line", "buzzer", "active-buzzer", "vibration-motor", "rtc", "imu",
    ]);
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

describe("divider resistors (user, 18/11/2026: they looked squeezed)", () => {
  it("the photoresistor's and thermistor's resistor span as many rows as the LED's", () => {
    const span = (kind: string) => {
      const r = resolveBuild(layoutProject([{ kind }]).build).resolved!.parts.find((p) => p.def.id === "resistor")!;
      return Math.abs(r.legs.a!.row - r.legs.b!.row);
    };
    expect(span("led")).toBe(3);
    expect(span("ldr")).toBe(span("led"));
    expect(span("ntc")).toBe(span("led"));
  });
});
