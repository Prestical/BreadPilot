import { fileURLToPath } from "node:url";
import { readPacks } from "../scripts/gen-parts";
import { CATALOG } from "../src/catalog";
import { parseConnections } from "../src/dsl";
import { loadPack } from "../src/packs";
import { validateBuild } from "../src/validate";
import type { Build, GpioMode, Part } from "../src/types";

/**
 * Parts only the safety tests use (26/11/2026: the app ships only parts the engine can plan): a DC
 * motor straight on a GPIO pin (current limits) and the HC-SR04, a 5 V sensor (5 V into a 3.3 V
 * pin, the voltage divider). Loaded and checked like a pack, then added to the catalog for the tests.
 */
for (const pack of readPacks(fileURLToPath(new URL("./fixtures/parts", import.meta.url))).map(loadPack)) CATALOG[pack.part.id] = pack.part;

/** Builds a Build from parts + DSL text. Throws on DSL syntax errors (tests should be explicit). */
export function mk(parts: Part[], dsl: string, gpioModes: Record<string, GpioMode> = {}): Build {
  const parsed = parseConnections(dsl);
  if (parsed.errors.length) throw new Error(`DSL error in test: ${JSON.stringify(parsed.errors)}`);
  return { boardId: "pico-2-w", parts, wires: parsed.wires, gpioModes };
}

export function codes(b: Build): string[] {
  return validateBuild(b).issues.map((i) => i.code).sort();
}

export const led = (ref: string, anode: string, cathode: string): Part => ({ ref, type: "led-5mm", legs: { anode, cathode } });
export const res = (ref: string, a: string, b: string, ohms = 330): Part => ({ ref, type: "resistor", legs: { a, b }, props: { ohms } });
export const btn = (ref: string, row: number): Part => ({
  ref,
  type: "button-6mm",
  legs: { "1a": `${row}e`, "1b": `${row}f`, "2a": `${row + 2}e`, "2b": `${row + 2}f` },
});
export const pot = (ref: string, row: number): Part => ({
  ref,
  type: "potentiometer",
  legs: { end1: `${row}h`, wiper: `${row + 1}h`, end2: `${row + 2}h` },
});
export const motor = (ref: string, a: string, b: string): Part => ({ ref, type: "dc-motor", legs: { a, b } });
export const sonar = (ref: string, row: number): Part => ({
  ref,
  type: "hc-sr04",
  legs: { vcc: `${row}g`, trig: `${row + 1}g`, echo: `${row + 2}g`, gnd: `${row + 3}g` },
});
