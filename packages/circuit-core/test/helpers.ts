import { parseConnections } from "../src/dsl";
import { validateBuild } from "../src/validate";
import type { Build, GpioMode, Part } from "../src/types";

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
