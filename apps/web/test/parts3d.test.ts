// M11 11.1 (user, 11/11/2026): more realistic part models and the "Supported parts" list.
import { describe, expect, it } from "vitest";
import { checkViewSpec, layoutProject, resolveBuild, type ResolvedPart } from "@breadpilot/circuit-core";
import { holePos } from "../src/scene/coords";
import { PACKS } from "@breadpilot/circuit-core";
import { partShapes, segments, viewShapes, type ShapeNode } from "../src/scene/shapes";
import { UPCOMING_GROUPS, UPCOMING_MODELS, upcomingPart } from "../src/scene/upcoming";
import { previewFrame } from "../src/scene/PartPreview";
import { BOARD, PICO, PITCH, colX } from "../src/scene/coords";
import { BOARD_MODELS, boardPlace, boardShapes } from "../src/scene/boards";
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

describe("models of the next parts (PLAN 17.1), before their packs exist", () => {
  const model = (id: string) => UPCOMING_MODELS.find((m) => m.id === id)!;
  const tree = (id: string, state: "done" | "ghost" = "done") => viewShapes(model(id).view, upcomingPart(model(id)), state);

  it("all 13 parts of phase 17.1 have a model, each in the view.json format", () => {
    expect(UPCOMING_MODELS.slice(0, 13).map((m) => m.id)).toEqual(["active-buzzer", "photoresistor", "ntc-thermistor", "tilt-switch", "reed-switch", "hall-sensor", "touch-sensor", "ir-obstacle-sensor", "flame-sensor", "sound-sensor", "soil-moisture-sensor", "water-level-sensor", "dht22"]);
    for (const m of UPCOMING_MODELS) {
      expect(() => checkViewSpec(m.view, m.id), m.id).not.toThrow();
      const named = "legs" in m.view ? m.view.legs : "pins" in m.view ? m.view.pins : Object.keys(m.legs);
      expect([...named].sort(), m.id).toEqual(Object.keys(m.legs).sort());
      // no two legs in one breadboard row on the same side of the channel (they would be joined)
      expect(new Set(Object.values(m.legs).map(([row, col]) => `${row}${col < "f" ? "L" : "R"}`)).size, m.id).toBe(Object.keys(m.legs).length);
    }
  });

  it("the format refuses a feature it doesn't know", () => {
    expect(() => checkViewSpec({ ...model("flame-sensor").view, features: [{ type: "laser", at: [0, 0] }] }, "x")).toThrow(/features\[0\]\.type/);
  });

  it("every model stands in its holes, has one highlighted body and fades as a ghost", () => {
    for (const m of UPCOMING_MODELS) {
      const part = upcomingPart(m);
      const t = tree(m.id);
      const starts = [...nodes(t, "rod").map((r) => r.from.join()), ...nodes(t, "lead").flatMap((l) => [l.points[0]!.join(), l.points.at(-1)!.join()])];
      for (const h of Object.values(part.legs)) expect(starts, m.id).toContain(holePos(h).join());
      const all = (n: ShapeNode): ShapeNode[] => [n, ...(n.node === "group" ? n.children.flatMap(all) : [])];
      expect(all(t).filter((n) => n.node === "mesh" && n.pulse).length, m.id).toBe(1);
      for (const n of all(tree(m.id, "ghost"))) if (n.node === "mesh") expect(n.material.opacity, m.id).toBeLessThan(1);
      // nothing but numbers in the geometry (a NaN would draw nothing)
      for (const x of meshes(t)) expect([...x.args, ...x.pos].every(Number.isFinite), m.id).toBe(true);
    }
  });

  it("active buzzer: a sound hole on top and a + beside the positive leg", () => {
    const m = model("active-buzzer");
    const part = upcomingPart(m);
    const t = tree(m.id);
    const top = meshes(t).find((x) => x.geometry === "cylinder" && x.args[0] === 1.1)!;
    expect(top.pos[1]).toBeGreaterThan(9.5);
    const plus = nodes(t, "group").flatMap((g) => g.children).find((c) => c.node === "mesh" && c.material.map?.text === "+")!;
    const plusZ = holePos(part.legs.plus!)[2];
    const minusZ = holePos(part.legs.minus!)[2];
    // the + sits on the plus leg's side of the middle
    expect(Math.sign((plus as { position: number[] }).position[2]!)).toBe(Math.sign(plusZ - minusZ));
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
      const part = upcomingPart(m);
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

  it("soil moisture sensor: the probe lies on the mat beside the breadboard, joined by two wires", () => {
    const m = model("soil-moisture-sensor");
    const part = upcomingPart(m);
    const t = tree(m.id);
    const legX = holePos(part.legs.ao!)[0];
    const head = meshes(t).find((x) => x.geometry === "box" && x.args[0] === 20)!;
    expect(Math.sign(head.pos[0])).toBe(Math.sign(legX));
    expect(Math.abs(head.pos[0]) - 10).toBeGreaterThan(BOARD.maxX);
    expect(head.pos[1] - 0.8).toBeCloseTo(-BOARD.height);
    expect(nodes(t, "lead").filter((l) => l.color).length).toBe(2);
    expect(previewFrame(m.view).size).toBeGreaterThan(previewFrame(model("flame-sensor").view).size);
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

describe("models of the parts with several pins (PLAN 17.2)", () => {
  const model = (id: string) => UPCOMING_MODELS.find((m) => m.id === id)!;
  const tree = (id: string) => viewShapes(model(id).view, upcomingPart(model(id)), "done");

  it("all 8 parts of phase 17.2 have a model", () => {
    expect(UPCOMING_MODELS.slice(13, 21).map((m) => m.id)).toEqual(["rgb-led", "hc-sr04", "joystick", "rotary-encoder", "keypad-4x4", "seven-segment", "tm1637-display", "traffic-light"]);
  });

  it("the parts dialog shows every model once, in lists short enough for the browser's 3D canvases", () => {
    expect(UPCOMING_GROUPS.flatMap((g) => g.models)).toEqual(UPCOMING_MODELS);
    for (const g of UPCOMING_GROUPS) expect(g.models.length, g.label).toBeLessThanOrEqual(14);
    expect(SUPPORTED_PARTS.length).toBeLessThanOrEqual(14);
  });

  it("a digit has seven bars that fit its box, the three flat ones between the four posts", () => {
    const s = segments(6, 10);
    expect(s.length).toBe(7);
    expect(s.filter((b) => b.w > b.h).map((b) => b.y)).toEqual([5, -5, 0]);
    expect(s.filter((b) => b.h > b.w).length).toBe(4);
    for (const b of s) expect(Math.abs(b.x) + b.w / 2 <= 3 + b.w && Math.abs(b.y) + b.h / 2 <= 5 + b.h).toBe(true);
  });

  it("RGB LED: four legs bent out to their holes and three chips under the dome", () => {
    const t = tree("rgb-led");
    expect(nodes(t, "lead").length).toBe(4);
    const m = meshes(t);
    expect(m.filter((x) => x.geometry === "lathe").length).toBe(1);
    expect(m.filter((x) => x.geometry === "box" && x.args[0] === 0.6).map((x) => x.color)).toEqual(["#ff3b30", "#35d04f", "#2f7bff"]);
  });

  it("HC-SR04: two transducers side by side; joystick: its cap stands out of the board; encoder: a shaft", () => {
    const cans = meshes(tree("hc-sr04")).filter((x) => x.geometry === "cylinder" && x.args[0] === 8);
    expect(cans.length).toBe(2);
    expect(Math.abs(cans[0]!.pos[2] - cans[1]!.pos[2])).toBe(26);
    const legX = holePos(upcomingPart(model("joystick")).legs.gnd!)[0];
    const cap = meshes(tree("joystick")).find((x) => x.geometry === "lathe")!;
    expect(Math.abs(cap.pos[0] - legX)).toBeGreaterThan(15);
    expect(meshes(tree("rotary-encoder")).some((x) => x.geometry === "cylinder" && x.args[2] === 13)).toBe(true);
  });

  it("7-segment digit: over the centre channel, seven lit bars and the dot on its top face", () => {
    const m = meshes(tree("seven-segment"));
    const body = m.find((x) => x.geometry === "roundedBox")!;
    expect(body.pos[0]).toBeCloseTo(1.27); // midway between columns d and h
    const lit = m.filter((x) => x.color === "#ff3b30");
    expect(lit.length).toBe(8);
    for (const x of lit) expect(x.pos[1]).toBeGreaterThan(body.pos[1] + 4);
    expect(nodes(tree("seven-segment"), "rod").length).toBe(10);
  });

  it("TM1637: four digits and a colon; traffic light: red above yellow above green", () => {
    const lit = meshes(tree("tm1637-display")).filter((x) => x.color === "#ff3b30");
    expect(lit.filter((x) => x.geometry === "box").length).toBe(28);
    expect(lit.filter((x) => x.geometry === "cylinder").length).toBe(2);
    const lamps = meshes(tree("traffic-light")).filter((x) => x.geometry === "lathe");
    expect(lamps.map((x) => x.color)).toEqual(["#ff3b30", "#ffd21f", "#35d04f"]);
    expect(lamps[0]!.pos[1]).toBeGreaterThan(lamps[1]!.pos[1]);
    expect(lamps[1]!.pos[1]).toBeGreaterThan(lamps[2]!.pos[1]);
  });

  it("keypad: 16 printed keys on the mat beside the breadboard, its plug in the eight holes", () => {
    const m = model("keypad-4x4");
    const t = tree(m.id);
    expect(nodes(t, "rod").length).toBe(8);
    const texts = nodes(t, "group").flatMap((g) => g.children).flatMap((c) => (c.node === "mesh" && c.material.map ? [c.material.map.text] : []));
    expect(texts.join("")).toBe("123A456B789C*0#D");
    const pad = meshes(t).find((x) => x.geometry === "box" && x.args[0] === 69)!;
    expect(pad.pos[0] - 69 / 2).toBeGreaterThan(BOARD.maxX);
    expect(pad.pos[1] - 0.5).toBeCloseTo(-BOARD.height);
    // number keys in one colour, the others in the accent colour
    const keys = meshes(t).filter((x) => x.geometry === "roundedBox");
    expect(keys.filter((x) => x.color === "#2f6fd6").length).toBe(10);
    expect(keys.filter((x) => x.color === "#d93a3a").length).toBe(6);
    expect(previewFrame(m.view).lookX).toBeGreaterThan(0);
  });
});

describe("models of the other boards (before any board pack)", () => {
  const all = (n: ShapeNode): ShapeNode[] => [n, ...(n.node === "group" ? n.children.flatMap(all) : [])];

  it("three more Picos, an Arduino Nano type board, then the two classic ESP32 dev kits, the S3 dev kit and the C3 SuperMini", () => {
    expect(BOARD_MODELS.map((b) => b.id)).toEqual(["pico", "pico-w", "pico-2", "arduino-nano", "esp32-devkit-v1", "esp32-devkitc-v4", "esp32-s3-devkitc-1", "esp32-c3-supermini"]);
    expect(BOARD_MODELS.map((b) => b.pinsPerSide * 2)).toEqual([40, 40, 40, 30, 30, 38, 44, 16]);
  });

  it("the Picos share the workbench Pico's outline and holes; only the wireless one has the shield, and the chip name differs", () => {
    const picos = BOARD_MODELS.filter((b) => b.id.startsWith("pico"));
    for (const b of picos) {
      expect(b.size).toEqual([PICO.width, PICO.length]);
      const { center, pins } = boardPlace(b);
      expect(center[2]).toBeCloseTo(PICO.centerZ);
      expect(pins.map((p) => p.join()).sort()).toEqual(Array.from({ length: 40 }, (_, i) => PICO.pinPos(i + 1).join()).sort());
    }
    const has = (id: string, type: string) => BOARD_MODELS.find((b) => b.id === id)!.features.some((f) => f.type === type);
    expect([has("pico", "shield"), has("pico-w", "shield"), has("pico-2", "shield")]).toEqual([false, true, false]);
    const chip = (id: string) => BOARD_MODELS.find((b) => b.id === id)!.features.flatMap((f) => (f.type === "chip" && f.label ? [f.label] : []))[0];
    expect([chip("pico"), chip("pico-w"), chip("pico-2")]).toEqual(["RP2040", "RP2040", "RP2350"]);
  });

  it("every board stands in real holes on both sides of the channel and covers its own pins", () => {
    for (const b of BOARD_MODELS) {
      const { center, pins } = boardPlace(b);
      expect(pins.length, b.id).toBe(b.pinsPerSide * 2);
      expect(b.cols[0] < "f" && b.cols[1] >= "f", b.id).toBe(true);
      for (const p of pins) {
        expect(Math.abs(p[0] - center[0]), b.id).toBeLessThan(b.size[0] / 2);
        expect(Math.abs(p[2] - center[2]), b.id).toBeLessThan(b.size[1] / 2);
      }
      // the pin lines are a whole number of holes apart and the board lies in the middle of them
      expect(center[0], b.id).toBeCloseTo((colX(b.cols[0]) + colX(b.cols[1])) / 2);
      expect(((colX(b.cols[1]) - colX(b.cols[0])) / PITCH) % 1, b.id).toBeCloseTo(0);
    }
  });

  it("everything on a board is on the board (a socket or antenna may reach 1 mm past the edge)", () => {
    for (const b of BOARD_MODELS) {
      const { center } = boardPlace(b);
      const t = boardShapes(b, "done");
      const m = meshes(t);
      const pcb = m.find((x) => x.geometry === "box" && x.args[0] === b.size[0] && x.args[2] === b.size[1])!;
      for (const x of m) {
        expect([...x.args, ...x.pos].every(Number.isFinite), b.id).toBe(true);
        if (x.geometry !== "box" && x.geometry !== "roundedBox") continue;
        if (x.pos[1] < pcb.pos[1]) continue; // the header strips below the board
        expect(Math.abs(x.pos[0] - center[0]) + x.args[0]! / 2, b.id).toBeLessThanOrEqual(b.size[0] / 2 + 0.01);
        expect(Math.abs(x.pos[2] - center[2]) + x.args[2]! / 2, b.id).toBeLessThanOrEqual(b.size[1] / 2 + 1);
        expect(x.pos[1], b.id).toBeGreaterThanOrEqual(pcb.pos[1]);
      }
      expect(all(t).filter((n) => n.node === "mesh" && n.pulse).length, b.id).toBe(1);
      for (const n of all(boardShapes(b, "ghost"))) if (n.node === "mesh") expect(n.material.opacity, b.id).toBeLessThan(1);
    }
  });

  it("Nano: the chip set on its corner stays between the pin lines; a 2 x 3 pin block stands at the far end", () => {
    const b = BOARD_MODELS.find((x) => x.id === "arduino-nano")!;
    const chip = b.features.find((f) => f.type === "chip")! as { size: [number, number]; at: [number, number] };
    // a square turned 45 degrees is wider by the square root of 2; with its legs it must clear the pin pads
    const reach = ((chip.size[0] + 1.8) / 2) * Math.SQRT2;
    expect(Math.abs(chip.at[0]) + reach).toBeLessThan((colX(b.cols[1]) - colX(b.cols[0])) / 2 - 0.95);
    const m = meshes(boardShapes(b, "done"));
    expect(m.filter((x) => x.geometry === "box" && x.args[0] === 0.64).length).toBe(6);
    const all2 = (n: ShapeNode): ShapeNode[] => [n, ...(n.node === "group" ? n.children.flatMap(all2) : [])];
    expect(all2(boardShapes(b, "done")).filter((n) => n.node === "mesh" && n.rotation?.[1] === Math.PI / 4).length).toBe(3);
  });

  it("the USB socket is at the row-1 end and the radio module at the other; names are printed on the shields", () => {
    for (const b of BOARD_MODELS) {
      const usb = b.features.filter((f) => f.type === "usb");
      expect(usb.length, b.id).toBeGreaterThan(0);
      for (const u of usb) expect(u.at[1], b.id).toBeLessThan(0);
      for (const f of b.features) if (f.type === "module" || f.type === "antenna" || f.type === "shield") expect(f.at[1], b.id).toBeGreaterThan(0);
    }
    const texts = (id: string) => all(boardShapes(BOARD_MODELS.find((b) => b.id === id)!, "done")).flatMap((n) => (n.node === "mesh" && n.material.map ? [n.material.map.text] : []));
    expect(texts("esp32-s3-devkitc-1")).toEqual(expect.arrayContaining(["ESP32-S3-WROOM-1", "USB", "UART", "BOOT", "RST"]));
    expect(texts("esp32-devkit-v1")).toContain("ESP32-WROOM-32");
    expect(BOARD_MODELS.find((b) => b.id === "esp32-s3-devkitc-1")!.features.filter((f) => f.type === "usb").length).toBe(2);
  });
});

describe("models of the I2C parts (PLAN 17.3)", () => {
  const all3 = (n: ShapeNode): ShapeNode[] => [n, ...(n.node === "group" ? n.children.flatMap(all3) : [])];
  const model = (id: string) => UPCOMING_MODELS.find((m) => m.id === id)!;
  const tree = (id: string) => viewShapes(model(id).view, upcomingPart(model(id)), "done");

  it("all 6 parts of phase 17.3 have a model", () => {
    expect(UPCOMING_MODELS.slice(21, 27).map((m) => m.id)).toEqual(["oled-ssd1306", "bme280", "mpu6050", "ds3231", "bh1750", "vl53l0x"]);
  });

  it("flat boards: the parts lie on top of the board, between the pin header and the far edge", () => {
    for (const id of ["bme280", "mpu6050", "bh1750", "vl53l0x"]) {
      const v = model(id).view as Extract<(typeof UPCOMING_MODELS)[number]["view"], { shape: "header-module" }>;
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
    const t = tree("oled-ssd1306");
    const texts = nodes(t, "group").flatMap((g) => g.children).flatMap((c) => (c.node === "mesh" && c.material.map ? [c.material.map.text] : []));
    expect(texts).toEqual(expect.arrayContaining(["Hello!  128x64", "GND", "VCC", "SCL", "SDA"]));
  });

  it("clock module: the coin cell is on the back of the board, the chips on the front", () => {
    const part = upcomingPart(model("ds3231"));
    const legX = holePos(part.legs.vcc!)[0];
    const m = meshes(tree("ds3231"));
    const cell = m.find((x) => x.geometry === "cylinder" && x.args[0] === 10)!;
    const chip = m.find((x) => x.geometry === "box" && x.args[1] === 10.3)!;
    // the front faces the channel (toward x = 0): the cell is on the other side of the legs
    expect(Math.abs(cell.pos[0])).toBeGreaterThan(Math.abs(legX));
    expect(Math.abs(chip.pos[0])).toBeLessThan(Math.abs(legX));
  });

  it("DS18B20 (17.4): a body round at the back and flat at the front, its name on the flat side, three legs", () => {
    expect(UPCOMING_MODELS.slice(27, 28).map((m) => m.id)).toEqual(["ds18b20"]);
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

describe("models of the basic parts (PLAN 17.5)", () => {
  const model = (id: string) => UPCOMING_MODELS.find((m) => m.id === id)!;
  const tree = (id: string) => viewShapes(model(id).view, upcomingPart(model(id)), "done");
  const all = (n: ShapeNode): ShapeNode[] => [n, ...(n.node === "group" ? n.children.flatMap(all) : [])];

  it("all 5 parts of phase 17.5 have a model", () => {
    expect(UPCOMING_MODELS.slice(28, 33).map((m) => m.id)).toEqual(["diode-1n4007", "electrolytic-capacitor", "ceramic-capacitor", "npn-transistor", "logic-mosfet"]);
  });

  it("diode: the band is at the cathode's end of the body", () => {
    const part = upcomingPart(model("diode-1n4007"));
    const t = tree("diode-1n4007");
    // inside the body's group, +z points from the anode to the cathode
    const group = all(t).find((n) => n.node === "group" && n.hover) as Extract<ShapeNode, { node: "group" }>;
    const [body, band] = group.children as Extract<ShapeNode, { node: "mesh" }>[];
    expect(band!.position![2]).toBeGreaterThan(0);
    expect(band!.position![2] + (band!.geometry.args as number[])[2]! / 2).toBeLessThanOrEqual((body!.geometry.args as number[])[2]! / 2 + 1e-9);
    const a = holePos(part.legs.anode!);
    const c = holePos(part.legs.cathode!);
    expect(group.rotation![1]).toBeCloseTo(Math.atan2(c[0] - a[0], c[2] - a[2]));
  });

  it("electrolytic capacitor: the stripe and its minus signs are on the negative leg's side", () => {
    const t = tree("electrolytic-capacitor");
    const stripe = all(t).find((n) => n.node === "mesh" && n.geometry.type === "cylinder" && n.geometry.arc) as Extract<ShapeNode, { node: "mesh" }>;
    const arc = (stripe.geometry as { arc: [number, number] }).arc;
    // centred on the group's +z (angle 0), which is turned toward the second leg
    expect((arc[0] + arc[1] / 2) % (2 * Math.PI)).toBeCloseTo(0);
    expect(arc[1]).toBeLessThan(Math.PI / 2);
    const signs = all(t).filter((n) => n.node === "mesh" && n.geometry.type === "box" && n.geometry.args[2] === 0.06) as Extract<ShapeNode, { node: "mesh" }>[];
    expect(signs.length).toBe(3);
    for (const s of signs) expect(s.position![2]).toBeGreaterThan(2.5);
  });

  it("ceramic capacitor: a disc with its code on both faces; transistor and MOSFET: three legs and a printed name", () => {
    const texts = (id: string) => all(tree(id)).flatMap((n) => (n.node === "mesh" && n.material.map ? [n.material.map.text] : []));
    expect(texts("ceramic-capacitor")).toEqual(["104", "104"]);
    expect(texts("npn-transistor")).toEqual(["NPN"]);
    expect(texts("logic-mosfet")).toEqual(["MOSFET"]);
    expect(nodes(tree("npn-transistor"), "lead").length).toBe(3);
    expect(nodes(tree("logic-mosfet"), "rod").length).toBe(3);
  });

  it("MOSFET: the metal tab stands above the body, behind it", () => {
    const m = meshes(tree("logic-mosfet"));
    const body = m.find((x) => x.geometry === "roundedBox")!;
    const tab = m.find((x) => x.geometry === "box" && x.args[1] === 6.4)!;
    expect(tab.pos[1] - 3.2).toBeCloseTo(body.pos[1] + 4.5);
    expect(tab.color).toBe("#c3c8cf");
  });
});

describe("models of the motors and 5 V parts (PLAN 17.6)", () => {
  const model = (id: string) => UPCOMING_MODELS.find((m) => m.id === id)!;
  const tree = (id: string) => viewShapes(model(id).view, upcomingPart(model(id)), "done");
  const all = (n: ShapeNode): ShapeNode[] => [n, ...(n.node === "group" ? n.children.flatMap(all) : [])];
  const onWires = ["servo-sg90", "dc-motor", "stepper-28byj-48", "lcd-1602-i2c", "vibration-motor"];

  it("all 8 parts of phase 17.6 have a model", () => {
    expect(UPCOMING_MODELS.slice(33, 41).map((m) => m.id)).toEqual(["servo-sg90", "relay-module", "dc-motor", "stepper-28byj-48", "neopixel-stick", "pir-hc-sr501", "lcd-1602-i2c", "vibration-motor"]);
  });

  it("parts on wires: one coloured wire per pin, from over its hole to the part on the mat beside the breadboard", () => {
    for (const id of onWires) {
      const m = model(id);
      const v = m.view as Extract<typeof m.view, { shape: "tethered" }>;
      const part = upcomingPart(m);
      const t = tree(id);
      const wires = nodes(t, "lead").filter((l) => l.points.length === 4 && l.points[0]![1] === 13.5);
      expect(wires.length, id).toBe(v.pins.length);
      expect(wires.map((w) => w.color), id).toEqual(v.wires);
      const cx = Object.values(part.legs).reduce((a, h) => a + holePos(h)[0], 0) / v.pins.length;
      for (const w of wires) {
        const end = w.points.at(-1)!;
        expect(cx + end[0], id).toBeGreaterThan(BOARD.maxX); // past the breadboard's edge
        expect(end[1], id).toBeGreaterThan(-BOARD.height); // above the mat
        expect(end[1], id).toBeLessThan(-BOARD.height + 12); // on the part, which is at most a few centimetres tall
      }
      // nothing of the part on the mat is sunk into the mat or inside the breadboard
      const unit = (all(t).filter((n) => n.node === "group") as Extract<ShapeNode, { node: "group" }>[]).find((g) => g.position?.[1] === -BOARD.height)!;
      expect(cx + unit.position![0], id).toBeGreaterThan(BOARD.maxX + 7);
      for (const n of unit.children) if (n.node === "mesh" && n.geometry.type === "box") expect(n.position![1] - n.geometry.args[1] / 2, id).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it("the same part on the left of the breadboard is mirrored: it lies past the left edge", () => {
    const m = model("servo-sg90");
    const part = upcomingPart({ ...m, legs: { signal: [0, "c"], vcc: [1, "c"], gnd: [2, "c"] } });
    const t = viewShapes(m.view, part, "done");
    const cx = holePos(part.legs.vcc!)[0];
    const unit = (all(t).filter((n) => n.node === "group") as Extract<ShapeNode, { node: "group" }>[]).find((g) => g.position?.[1] === -BOARD.height)!;
    expect(cx + unit.position![0]).toBeLessThan(BOARD.minX - 7);
    expect(unit.rotation).toEqual([0, Math.PI, 0]);
    for (const w of nodes(t, "lead")) expect(cx + w.points.at(-1)![0]).toBeLessThan(BOARD.minX);
  });

  it("LCD shows its two lines; the stepper has a five-wire cable between motor and driver", () => {
    const texts = all(tree("lcd-1602-i2c")).flatMap((n) => (n.node === "mesh" && n.material.map ? [n.material.map.text] : []));
    expect(texts).toEqual(["Hello, world!", "BreadPilot"]);
    expect(nodes(tree("stepper-28byj-48"), "lead").length).toBe(6 + 5);
  });

  it("relay module: the relay and a three-way screw terminal above it; LED stick: eight lit pixels in a row; PIR: a dome", () => {
    const relay = meshes(tree("relay-module"));
    const box = relay.find((x) => x.geometry === "roundedBox" && x.args[0] === 15.5)!;
    const block = relay.find((x) => x.geometry === "box" && x.args[0] === 10 && x.args[2] === 15)!;
    expect(block.pos[1]).toBeGreaterThan(box.pos[1] + 9.5);
    const lit = meshes(tree("neopixel-stick")).filter((x) => x.geometry === "cylinder" && x.args[0] === 1.9);
    expect(lit.length).toBe(8);
    expect(new Set(lit.map((x) => x.color)).size).toBe(8);
    expect(new Set(lit.map((x) => x.pos[1])).size).toBe(1);
    expect(meshes(tree("pir-hc-sr501")).filter((x) => x.geometry === "lathe").length).toBe(1);
  });

  it("the previews stand far enough back to show the part on its wires", () => {
    for (const id of onWires) expect(previewFrame(model(id).view).lookX, id).toBeGreaterThan(16);
    expect(previewFrame(model("lcd-1602-i2c").view).size).toBeGreaterThan(previewFrame(model("vibration-motor").view).size);
  });
});

describe("models of the SPI and UART parts (PLAN 17.7)", () => {
  const model = (id: string) => UPCOMING_MODELS.find((m) => m.id === id)!;
  const tree = (id: string) => viewShapes(model(id).view, upcomingPart(model(id)), "done");

  it("all 5 parts of phase 17.7 have a model, which makes every part of the plan's list: 46", () => {
    expect(UPCOMING_MODELS.slice(41).map((m) => m.id)).toEqual(["matrix-max7219", "rfid-rc522", "sd-card-module", "tft-st7735", "gps-neo-6m"]);
    expect(UPCOMING_MODELS.length).toBe(46);
    expect(new Set(UPCOMING_MODELS.map((m) => m.id)).size).toBe(46);
  });

  it("LED matrix: 64 dots in a square, the picture's dots lit, its top row at the top", () => {
    const v = model("matrix-max7219").view as Extract<(typeof UPCOMING_MODELS)[number]["view"], { shape: "upright-module" }>;
    const pic = v.features!.find((f) => f.type === "matrix") as { rows: string[] };
    const dots = meshes(tree("matrix-max7219")).filter((x) => x.geometry === "cylinder" && x.args[0] === 4 * 0.36);
    expect(dots.length).toBe(64);
    expect(dots.filter((x) => x.color === "#ff3b30").length).toBe(pic.rows.join("").split("#").length - 1);
    expect(pic.rows.every((r) => r.length === 8)).toBe(true);
    // the dots come row by row from the top: the last row of the picture is dark and lowest
    const last = dots.slice(56);
    expect(last.every((x) => x.color !== "#ff3b30")).toBe(true);
    expect(Math.max(...last.map((x) => x.pos[1]))).toBeLessThan(Math.min(...dots.slice(0, 8).map((x) => x.pos[1])));
  });

  it("the flat boards' parts are placed between the pin header and the far edge (the GPS antenna may reach past it)", () => {
    for (const id of ["rfid-rc522", "tft-st7735", "gps-neo-6m"]) {
      const v = model(id).view as Extract<(typeof UPCOMING_MODELS)[number]["view"], { shape: "header-module" }>;
      for (const f of v.features!) {
        if (!("at" in f)) continue;
        const up = "size" in f ? (typeof f.size === "number" ? f.size : f.size[1]) / 2 : 0;
        const across = "size" in f ? (typeof f.size === "number" ? f.size : f.size[0]) / 2 : 0;
        expect(f.at[1] - up, `${id} ${f.type}`).toBeGreaterThan(3);
        expect(f.at[1] + up, `${id} ${f.type}`).toBeLessThanOrEqual(v.board.size[0] + (f.type === "patch" ? 4 : 0));
        expect(Math.abs(f.at[0]) + across, `${id} ${f.type}`).toBeLessThanOrEqual(v.board.size[1] / 2);
      }
      expect(meshes(tree(id)).every((x) => [...x.args, ...x.pos].every(Number.isFinite)), id).toBe(true);
    }
  });

  it("RFID reader: three coil turns; colour display: seven colour bars; SD module: a card in the socket", () => {
    expect(meshes(tree("rfid-rc522")).filter((x) => x.color === "#d5d8dc").length).toBe(12);
    const bars = meshes(tree("tft-st7735")).filter((x) => x.geometry === "box" && x.args[0] === 0.05);
    expect(new Set(bars.map((x) => x.color)).size).toBe(7);
    const sd = meshes(tree("sd-card-module"));
    const socket = sd.find((x) => x.geometry === "box" && x.args[0] === 1.9)!;
    const card = sd.find((x) => x.geometry === "box" && x.args[0] === 0.8)!;
    expect(card.pos[1]).toBeGreaterThan(socket.pos[1]);
    expect(card.pos[1] + 4 - (3.2 + 42)).toBeLessThanOrEqual(3); // it sticks out of the board's top edge a little, like a real card
    expect(card.pos[1] + 4).toBeGreaterThan(3.2 + 42);
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
