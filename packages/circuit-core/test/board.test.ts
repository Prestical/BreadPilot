import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPinLikeLabel, labelMatchesPin, parseBoard, PICO_2_W, pinByPhys } from "../src/board";
import { picoFreeHoles, picoPinHole } from "../src/breadboard";
import { pinoutMarkdown } from "../src/pinout-text";

// These assertions restate facts from docs/hardware/pico-2-w/ (pinout PDF + datasheet §2.1, §3.2).
describe("Pico 2 W ground truth", () => {
  const pins = PICO_2_W.pins;

  it("has 40 physical pins numbered 1-40", () => {
    expect(pins.map((p) => p.phys).sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  });

  it("exposes exactly 26 GPIO: GP0-GP22 and GP26-GP28 (datasheet §3.2)", () => {
    const gpio = pins.filter((p) => p.type === "gpio").map((p) => p.gpio).sort((a, b) => a! - b!);
    expect(gpio).toEqual([...Array.from({ length: 23 }, (_, i) => i), 26, 27, 28]);
  });

  it("has ground on pins 3, 8, 13, 18, 23, 28, 33 (AGND) and 38", () => {
    expect(pins.filter((p) => p.type === "ground").map((p) => p.phys)).toEqual([3, 8, 13, 18, 23, 28, 33, 38]);
    expect(pinByPhys(PICO_2_W, 33)!.aliases).toContain("AGND");
  });

  it("has the special pins of datasheet §2.1 at the right numbers", () => {
    const at = (n: number) => pinByPhys(PICO_2_W, n)!.name;
    expect([at(30), at(35), at(36), at(37), at(39), at(40)]).toEqual(["RUN", "ADC_VREF", "3V3", "3V3_EN", "VSYS", "VBUS"]);
    expect(pinByPhys(PICO_2_W, 36)!.maxLoadMa).toBe(300);
  });

  // RP2350 datasheet: PADS_BANK0 DRIVE reset (Table 885), Table 1683 and §14.9.4.1.
  it("has the RP2350's GPIO current facts, each with its source", () => {
    const g = PICO_2_W.electrical.gpioCurrent!;
    expect(g.defaultDriveMa).toBe(4);
    expect(g.driveStrengthsMa).toEqual([2, 4, 8, 12]);
    expect([g.outputHighMinV, g.outputLowMaxV]).toEqual([2.62, 0.5]);
    expect([g.maxTotalSourceMa, g.maxTotalSinkMa]).toEqual([100, 100]);
    expect([g.inputHighMinV, g.inputLowMaxV]).toEqual([2.0, 0.8]);
    expect([g.pullUpOhms, g.pullDownOhms]).toEqual([[32000, 86000], [36000, 113000]]);
    const src = (PICO_2_W.electrical as unknown as { gpioCurrent: { src: { doc: string }[] } }).gpioCurrent.src;
    expect(src.length).toBeGreaterThan(0);
    // The PDF isn't committed (size): each cited file is listed in reference.md with its SHA-256,
    // and a local copy, if there is one, must match it.
    const dir = join(__dirname, "../../../docs/hardware/rp2350");
    const reference = readFileSync(join(dir, "reference.md"), "utf8");
    for (const s of src) {
      const row = reference.split("\n").find((l) => l.startsWith(`| ${s.doc} |`));
      expect(row, s.doc).toBeDefined();
      const sha = /\b([0-9a-f]{64})\b/.exec(row!)![1];
      const local = join(dir, s.doc);
      if (existsSync(local)) expect(createHash("sha256").update(readFileSync(local)).digest("hex")).toBe(sha);
    }
  });

  it("puts ADC0-2 on GP26-28 (pins 31, 32, 34)", () => {
    expect(pins.filter((p) => p.adc !== undefined).map((p) => [p.phys, p.name, p.adc])).toEqual([
      [31, "GP26", 0],
      [32, "GP27", 1],
      [34, "GP28", 2],
    ]);
  });

  it("keeps internal GPIOs (GP23, GP24, GP25, GP29) off the header", () => {
    expect(PICO_2_W.internalGpio.map((g) => g.name)).toEqual(["GP23", "GP24", "GP25", "GP29"]);
    for (const g of PICO_2_W.internalGpio) expect(pins.some((p) => p.name === g.name)).toBe(false);
  });

  it("cites a documentation source for every pin", () => {
    for (const p of pins) expect(p.src.length).toBeGreaterThan(0);
  });

  it("rejects broken board data", () => {
    const broken = structuredClone(PICO_2_W);
    broken.pins[1]!.phys = 1;
    expect(() => parseBoard(broken)).toThrow(/duplicate physical pin 1/);
  });

  it("matches pin labels, including aliases and GPIOn", () => {
    const p36 = pinByPhys(PICO_2_W, 36)!;
    expect(labelMatchesPin(p36, "3V3(OUT)")).toBe(true);
    expect(labelMatchesPin(pinByPhys(PICO_2_W, 20)!, "gpio15")).toBe(true);
    expect(labelMatchesPin(pinByPhys(PICO_2_W, 33)!, "GP15")).toBe(false);
    expect(isPinLikeLabel(PICO_2_W, "GND")).toBe(true);
    expect(isPinLikeLabel(PICO_2_W, "LED")).toBe(false);
    expect(isPinLikeLabel(PICO_2_W, "LED1.anode")).toBe(false);
  });
});

describe("Pico on the breadboard", () => {
  it("places pins 1-20 in column c and 40-21 in column h", () => {
    expect(picoPinHole(1)).toEqual({ row: 1, col: "c" });
    expect(picoPinHole(20)).toEqual({ row: 20, col: "c" });
    expect(picoPinHole(21)).toEqual({ row: 20, col: "h" });
    expect(picoPinHole(33)).toEqual({ row: 8, col: "h" });
    expect(picoPinHole(40)).toEqual({ row: 1, col: "h" });
  });

  it("offers the outermost free holes first", () => {
    expect(picoFreeHoles(3)).toEqual([{ row: 3, col: "a" }, { row: 3, col: "b" }]);
    expect(picoFreeHoles(33)).toEqual([{ row: 8, col: "j" }, { row: 8, col: "i" }]);
  });
});

describe("generated pinout text (RAG)", () => {
  it("is up to date with the board JSON (run `npm run gen:pinout`)", () => {
    const file = readFileSync(new URL("../../../data/boards/pico-2-w.pinout.generated.md", import.meta.url), "utf8");
    expect(file).toBe(pinoutMarkdown(PICO_2_W));
  });

  it("describes pin 33 as GND / AGND with its jumper holes", () => {
    expect(pinoutMarkdown(PICO_2_W)).toContain("Physical pin 33 is GND / AGND. It is a ground (GND) pin.");
    expect(pinoutMarkdown(PICO_2_W)).toContain("plug jumpers into hole 8j or 8i");
  });
});
