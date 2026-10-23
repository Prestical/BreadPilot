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
    expect(allocatePins([{ kind: "led" }, { kind: "pot" }, { kind: "button", pin: "GP16" }])).toEqual(["GP17", "GP26", "GP16"]);
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
      "#23(GND) -> #RR-(GND)",
      "#21(GP16) -> #24j(R1.a)",
      "#28j(LED1.cathode) -> #RR-(GND)",
      "#22(GP17) -> #30j(BTN1.1b)",
      "#32j(BTN1.2b) -> #RR-(GND)",
    ]);
    expect(build.gpioModes).toEqual({ GP16: "out", GP17: "in_pullup" });
    expect(blocks.map((b) => [b.ref, b.gpio, b.rows])).toEqual([
      ["LED1", "GP16", [24, 28]],
      ["BTN1", "GP17", [30, 32]],
    ]);
    expect(validateBuild(build).issues).toEqual([]);
  });

  it("adds a 3V3 rail only when a part needs it", () => {
    const withPot = layoutProject([{ kind: "pot" }]).build.wires.map(formatWire);
    expect(withPot).toContain("#36(3V3) -> #RR+(3V3)");
    expect(layoutProject([{ kind: "led" }]).build.wires.map(formatWire)).not.toContain("#36(3V3) -> #RR+(3V3)");
  });

  it("fails clearly when the breadboard is full", () => {
    expect(() => layoutProject(Array.from({ length: 8 }, () => ({ kind: "led" as const })))).toThrow(/Not enough room/);
    expect(layoutProject([]).build).toEqual({ boardId: "pico-2-w", parts: [], wires: [], gpioModes: {} });
  });

  // Property test: any combination the layout engine accepts must validate with zero issues.
  it("never produces a circuit with errors or warnings (random combinations, both power modes)", () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const kinds: BlockKind[] = ["led", "button", "pot", "oled"];
    for (const power of POWER_MODES) {
      let laidOut = 0;
      for (let n = 0; n < 300; n++) {
        const count = 1 + Math.floor(rand() * 7);
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

  it("rails (default): one GND and one 3V3 wire feed the rails; parts use the rails", () => {
    const wires = layoutProject(reqs).build.wires.map(formatWire);
    expect(wires.filter((w) => /^#\d+\((GND|3V3)\)/.test(w))).toEqual(["#23(GND) -> #RR-(GND)", "#36(3V3) -> #RR+(3V3)"]);
    expect(wires.filter((w) => w.includes("#RR-"))).toHaveLength(4);
  });

  it("direct: no rails at all; every GND/3V3 wire goes from a Pico pin to the part", () => {
    const { build } = layoutProject(reqs, undefined, { power: "direct" });
    const wires = build.wires.map(formatWire);
    expect(wires.some((w) => w.includes("#R"))).toBe(false);
    expect(build.wires.every((w) => w.to.kind !== "rail" && w.from.kind !== "rail")).toBe(true);
    expect(wires).toContain("#36(3V3) -> #24j(POT1.end1)");
    expect(wires).toContain("#23(GND) -> #26j(POT1.end2)");
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

  it("direct: GND wires spread over the GND pins nearest the parts and skip AGND (pin 33)", () => {
    const leds: BlockRequest[] = Array.from({ length: 6 }, () => ({ kind: "led" }));
    const gnds = layoutProject(leds, undefined, { power: "direct" }).build.wires.flatMap((w) => (w.from.kind === "pico" && w.from.label === "GND" ? [w.from.phys] : []));
    expect(gnds).toEqual([23, 23, 28, 28, 38, 38]);
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
