import { describe, expect, it } from "vitest";
import { formatWire } from "../src/dsl";
import { allocatePins, gpioPreference, layoutProject, LayoutError, POWER_MODES, WIRES_PER_PICO_PIN, type BlockKind, type BlockRequest } from "../src/layout";
import { buildSteps } from "../src/steps";
import { validateBuild } from "../src/validate";

describe("pin allocator", () => {
  it("prefers right-side pins near the parts area and keeps ADC pins for last", () => {
    const order = gpioPreference().map((p) => p.name);
    expect(order.slice(0, 3)).toEqual(["GP16", "GP17", "GP18"]);
    expect(order.slice(-3)).toEqual(["GP28", "GP27", "GP26"].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    expect(order).toHaveLength(26);
  });

  it("gives potentiometers ADC pins and honours requested pins", () => {
    // GP16 is requested; GP17 (the next row) is passed over for GP18 so the wires aren't side by side.
    expect(allocatePins([{ kind: "led" }, { kind: "pot" }, { kind: "button", pin: "GP16" }])).toEqual(["GP18", "GP26", "GP16"]);
  });

  it("refuses impossible requests", () => {
    expect(() => allocatePins([{ kind: "pot", pin: "GP15" }])).toThrow(LayoutError);
    expect(() => allocatePins([{ kind: "pot" }, { kind: "pot" }, { kind: "pot" }, { kind: "pot" }])).toThrow(/only three/);
    expect(() => allocatePins([{ kind: "led", pin: "GP25" }])).toThrow(/isn't a usable GPIO/);
    expect(() => allocatePins([{ kind: "led", pin: "GP16" }, { kind: "button", pin: "GP16" }])).toThrow(/two parts/);
  });
});

describe("layout engine", () => {
  it("lays out LED + button with wires in the user-facing DSL", () => {
    const { build, blocks } = layoutProject([{ kind: "led" }, { kind: "button" }]);
    expect(build.wires.map(formatWire)).toEqual([
      "#38(GND) -> #RR-(GND)",
      "#21(GP16) -> #24j(R1.a)",
      "#28j(LED1.cathode) -> #RR-(GND)",
      "#24(GP18) -> #30j(BTN1.1b)",
      "#32j(BTN1.2b) -> #RR-(GND)",
    ]);
    expect(build.gpioModes).toEqual({ GP16: "out", GP18: "in_pullup" });
    expect(blocks.map((b) => [b.ref, b.gpio, b.rows])).toEqual([
      ["LED1", "GP16", [24, 28]],
      ["BTN1", "GP18", [30, 32]],
    ]);
    expect(validateBuild(build).issues).toEqual([]);
  });

  it("adds a 3V3 rail only when a part needs it", () => {
    const withPot = layoutProject([{ kind: "pot" }]).build.wires.map(formatWire);
    expect(withPot).toContain("#36(3V3) -> #RR+(3V3)");
    expect(layoutProject([{ kind: "led" }]).build.wires.map(formatWire)).not.toContain("#36(3V3) -> #RR+(3V3)");
  });

  it("fails clearly when the breadboard is full", () => {
    // Both halves hold 12 LEDs; the 13th doesn't fit.
    expect(() => layoutProject(Array.from({ length: 12 }, () => ({ kind: "led" as const })))).not.toThrow();
    expect(() => layoutProject(Array.from({ length: 13 }, () => ({ kind: "led" as const })))).toThrow(/Not enough room/);
    expect(layoutProject([]).build).toEqual({ boardId: "pico-2-w", parts: [], wires: [], gpioModes: {} });
  });

  // Property test: any combination the layout engine accepts must validate with zero issues.
  it("never produces a circuit with errors or warnings (random combinations, both power modes)", () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const kinds: BlockKind[] = ["led", "button", "pot", "oled"];
    for (const power of POWER_MODES) {
      let laidOut = 0;
      for (let n = 0; n < 600; n++) {
        const count = 1 + Math.floor(rand() * 12); // up to 12 parts, so the left half is used too
        const reqs: BlockRequest[] = Array.from({ length: count }, () => ({ kind: kinds[Math.floor(rand() * kinds.length)]! }));
        let layout;
        try {
          layout = layoutProject(reqs, undefined, { power });
        } catch (e) {
          expect(e).toBeInstanceOf(LayoutError);
          continue;
        }
        laidOut++;
        const report = validateBuild(layout.build);
        expect(report.issues, `${power} ${JSON.stringify(reqs)}`).toEqual([]);
      }
      expect(laidOut, power).toBeGreaterThan(150);
    }
  });
});

describe("power modes", () => {
  const reqs: BlockRequest[] = [{ kind: "pot" }, { kind: "led", props: { color: "green" } }, { kind: "button" }];

  it("rails (default): one GND and one 3V3 wire feed the rails, both from the top of the Pico", () => {
    const wires = layoutProject(reqs).build.wires.map(formatWire);
    expect(wires.filter((w) => /^#\d+\((GND|3V3)\)/.test(w))).toEqual(["#38(GND) -> #RR-(GND)", "#36(3V3) -> #RR+(3V3)"]);
    expect(wires.filter((w) => w.includes("#RR-"))).toHaveLength(4);
  });

  it("direct: no rails at all; every GND/3V3 wire goes from a Pico pin to the part", () => {
    const { build } = layoutProject(reqs, undefined, { power: "direct" });
    const wires = build.wires.map(formatWire);
    expect(wires.some((w) => w.includes("#R"))).toBe(false);
    expect(build.wires.every((w) => w.to.kind !== "rail" && w.from.kind !== "rail")).toBe(true);
    expect(wires).toContain("#36(3V3) -> #24j(POT1.end1)");
    expect(wires).toContain("#28(GND) -> #26j(POT1.end2)");
    // Every part's GND on its own pin (none shared while another GND pin is free).
    const gnds = build.wires.flatMap((w) => (w.from.kind === "pico" && w.from.label === "GND" ? [w.from.phys] : []));
    expect(new Set(gnds).size).toBe(gnds.length);
    // Each Pico pin has only WIRES_PER_PICO_PIN free holes next to it.
    const perPin = new Map<number, number>();
    for (const w of build.wires) if (w.from.kind === "pico") perPin.set(w.from.phys, (perPin.get(w.from.phys) ?? 0) + 1);
    expect(Math.max(...perPin.values())).toBeLessThanOrEqual(WIRES_PER_PICO_PIN);
    expect(validateBuild(build).issues).toEqual([]);
  });

  it("switching modes keeps the GPIOs and the parts' places (the code stays valid)", () => {
    const rails = layoutProject(reqs);
    const direct = layoutProject(reqs, undefined, { power: "direct" });
    expect(direct.blocks).toEqual(rails.blocks);
    expect(direct.build.parts).toEqual(rails.build.parts);
    expect(direct.build.gpioModes).toEqual(rails.build.gpioModes);
  });

  it("direct: one GND wire per GND pin, on the part's own side of the Pico, skipping AGND (pin 33)", () => {
    const leds: BlockRequest[] = Array.from({ length: 6 }, () => ({ kind: "led" }));
    const { build, blocks } = layoutProject(leds, undefined, { power: "direct" });
    const gnds = build.wires.flatMap((w) => (w.from.kind === "pico" && w.from.label === "GND" ? [w.from.phys] : []));
    expect(blocks.map((b) => b.side)).toEqual(["R", "R", "R", "L", "L", "L"]);
    expect(gnds).toEqual([28, 23, 38, 13, 18, 8]); // right-side GND pins for the right parts, left-side for the left
    expect(gnds).not.toContain(33);
  });

  it("direct: seven parts (the most that fit) get seven different GND pins", () => {
    const eight: BlockRequest[] = [...Array.from({ length: 5 }, () => ({ kind: "led" as const })), ...Array.from({ length: 2 }, () => ({ kind: "button" as const }))];
    const gnds = layoutProject(eight, undefined, { power: "direct" }).build.wires.flatMap((w) => (w.from.kind === "pico" && w.from.label === "GND" ? [w.from.phys] : []));
    expect(gnds).toHaveLength(7);
    expect(new Set(gnds).size).toBe(7); // 7 GND pins without AGND: all different
  });

  it("direct: at most two knobs (one 3V3 pin), with advice to use the rails", () => {
    const three: BlockRequest[] = [{ kind: "pot" }, { kind: "pot" }, { kind: "pot" }];
    expect(() => layoutProject(three, undefined, { power: "direct" })).toThrow(/at most 2 parts that need 3.3 V.*breadboard rails/);
    expect(() => layoutProject(three)).not.toThrow();
  });

  it("direct: step text names the Pico pin instead of a rail", () => {
    const steps = buildSteps(layoutProject(reqs, undefined, { power: "direct" }).build);
    const wireSteps = steps.filter((s) => s.kind === "wire");
    expect(wireSteps.every((s) => !/rail/.test(s.text + s.why))).toBe(true);
    expect(wireSteps.map((s) => s.why)).toContain("This puts 3.3 V on the other outer leg of POT1, so turning the knob gives any voltage from 0 to 3.3 V.");
    expect(wireSteps.find((s) => s.dsl?.startsWith("#23(GND) -> #32j"))?.why).toMatch(/^This completes LED1's circuit/);
  });
});

// Wire crowding at the Pico (PLAN §20): wires in neighbouring rows or two on one pin are hard to plug
// in. Measured on typical projects; the numbers may only go down. (Before the crowding score:
// rails 28 neighbouring pairs; direct 15 shared pins and 30 neighbouring pairs.)
describe("wire crowding at the Pico", () => {
  const projects: BlockRequest[][] = [
    [{ kind: "led" }],
    [{ kind: "led" }, { kind: "button" }],
    [{ kind: "led" }, { kind: "led" }, { kind: "led" }],
    [{ kind: "led" }, { kind: "led" }, { kind: "led" }, { kind: "led" }, { kind: "button" }, { kind: "button" }],
    [{ kind: "pot" }, { kind: "led" }],
    [{ kind: "pot" }, { kind: "pot" }, { kind: "led" }, { kind: "led" }],
    [{ kind: "oled" }, { kind: "button" }],
    [{ kind: "oled" }, { kind: "button" }, { kind: "button" }, { kind: "led" }],
    Array.from({ length: 6 }, () => ({ kind: "led" as const })),
  ];
  const crowding = (power: "rails" | "direct") => {
    let shared = 0;
    let neighbours = 0;
    let crossing = 0;
    for (const reqs of projects) {
      const perPin = new Map<number, number>();
      for (const w of layoutProject(reqs, undefined, { power }).build.wires) {
        if (w.from.kind !== "pico") continue;
        perPin.set(w.from.phys, (perPin.get(w.from.phys) ?? 0) + 1);
        // A wire from a left-side pin (1-20) to the right half, or the other way: over the Pico.
        if (w.to.kind === "hole" && w.from.phys <= 20 !== w.to.col! <= "e") crossing++;
      }
      shared += [...perPin.values()].filter((n) => n > 1).length;
      // Rows on the same side: pins 1-20 left (row = pin), 21-40 right (row = 41 - pin).
      const rows = new Set([...perPin.keys()].map((phys) => (phys <= 20 ? `L${phys}` : `R${41 - phys}`)));
      for (const r of rows) if (rows.has(`${r[0]}${Number(r.slice(1)) + 1}`)) neighbours++;
    }
    return { shared, neighbours, crossing };
  };

  it("rails: no shared pins and few wires in neighbouring rows", () => {
    const c = crowding("rails");
    expect(c.shared).toBe(0);
    expect(c.neighbours).toBeLessThanOrEqual(2);
    expect(c.crossing).toBe(0);
  });

  it("direct: only the single 3V3 pin is ever shared, and fewer neighbouring rows", () => {
    const c = crowding("direct");
    expect(c.shared).toBeLessThanOrEqual(1); // two knobs need 3V3 and the Pico has one 3V3(OUT) pin
    expect(c.neighbours).toBeLessThanOrEqual(12);
    // A fourth GND wire for right-side parts comes from a left GND pin rather than doubling up.
    expect(c.crossing).toBeLessThanOrEqual(2);
  });
});

// Both halves of the breadboard (PLAN §21): parts go where their wires stay short.
describe("two-sided layout", () => {
  const game: BlockRequest[] = [{ kind: "led" }, { kind: "led" }, { kind: "led" }, { kind: "led" }, { kind: "button" }, { kind: "button" }];

  it("opens the left half when the right side's spaced pins run out, with left-side pins", () => {
    const { build, blocks } = layoutProject(game);
    expect(blocks.map((b) => `${b.gpio}@${b.side}`)).toEqual(["GP16@R", "GP18@R", "GP20@R", "GP15@L", "GP13@L", "GP11@L"]);
    // Left parts are mirrored onto columns a-e and their wires stay on the left.
    const leftRefs = new Set(blocks.filter((b) => b.side === "L").flatMap((b) => b.refs));
    for (const part of build.parts.filter((p) => leftRefs.has(p.ref) && !p.ref.startsWith("BTN"))) {
      for (const h of Object.values(part.legs)) expect(h.at(-1)! <= "e", `${part.ref} ${h}`).toBe(true);
    }
    expect(validateBuild(build).issues).toEqual([]);
  });

  it("rails: the left − rail is fed from the top left GND pin, once", () => {
    const wires = layoutProject(game).build.wires.map(formatWire);
    expect(wires.filter((w) => w.endsWith("#RL-(GND)") && w.startsWith("#3(GND)"))).toEqual(["#3(GND) -> #RL-(GND)"]);
    expect(wires.filter((w) => w.startsWith("#") && /^#\d+\(GND\)/.test(w))).toHaveLength(2); // pin 38 → right rail, pin 3 → left rail
    expect(layoutProject([{ kind: "led" }, { kind: "button" }]).build.wires.map(formatWire).some((w) => w.includes("RL"))).toBe(false); // small projects: right half only
  });

  it("small projects stay on the right half", () => {
    for (const reqs of [[{ kind: "led" }], [{ kind: "led" }, { kind: "button" }], [{ kind: "pot" }, { kind: "led" }], [{ kind: "oled" }, { kind: "button" }]] as BlockRequest[][]) {
      expect(layoutProject(reqs).blocks.every((b) => b.side === "R"), JSON.stringify(reqs)).toBe(true);
    }
  });

  it("knobs and displays stay on the right (ADC pins and 3V3 are there); the display blocks both halves", () => {
    const { blocks } = layoutProject([...Array.from({ length: 9 }, () => ({ kind: "led" as const })), { kind: "pot" }]);
    expect(blocks.find((b) => b.kind === "pot")!.side).toBe("R");
    const withOled = layoutProject([{ kind: "led" }, { kind: "oled" }, { kind: "led" }, { kind: "led" }, { kind: "led" }]);
    const oled = withOled.blocks.find((b) => b.kind === "oled")!;
    expect(oled.side).toBe("R");
    // Nothing on the left half inside the display's rows (its board lies over that half).
    for (const b of withOled.blocks.filter((x) => x.side === "L")) expect(b.rows[1] < oled.rows[0] || b.rows[0] > oled.rows[1], b.ref).toBe(true);
  });

  it("switching power modes keeps every GPIO and place with parts on both halves", () => {
    const rails = layoutProject(game);
    const direct = layoutProject(game, undefined, { power: "direct" });
    expect(direct.blocks).toEqual(rails.blocks);
    expect(direct.build.parts).toEqual(rails.build.parts);
    expect(direct.build.gpioModes).toEqual(rails.build.gpioModes);
  });
});

