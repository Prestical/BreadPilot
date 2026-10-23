// Pin allocator + layout engine.
// The LLM only says *what* it wants ("an LED", "a button"). This code decides
// which GPIO to use, where each part goes on the breadboard, and where every
// jumper goes. The result always passes validateBuild() (see test/layout.test.ts).
//
// Layout: the Pico sits in rows 1-20. Parts go on the right half (columns f-j)
// from row 24 down, one block after another.
//
// Power (both modes are powered by the USB cable through the Pico):
// - "rails" (default): one wire from a Pico GND pin to the right − rail and (for knobs) one from
//   3V3(OUT) to the right + rail; every part then takes GND/3V3 from the rails.
// - "direct": no rails; every GND/3V3 wire goes straight from a Pico pin to the part. A Pico pin
//   has only two free holes next to it, so each GND pin takes two wires and 3V3(OUT) (the only
//   3.3 V output) takes two, which limits direct mode to two knobs.

import { PICO_2_W } from "./board";
import { PICO_LAST_ROW, picoPinHole, BREADBOARD } from "./breadboard";
import { packByKind, type LayoutTemplate, type Pack, type TemplateHole } from "./packs";
import type { Board, BoardPin, Build, Column, Endpoint, GpioMode, Part, Wire } from "./types";

/** A part pack's plan kind, e.g. "led", "button", "pot", "oled" (see parts/<id>/pack.json). */
export type BlockKind = string;

export interface BlockRequest {
  kind: BlockKind;
  /** Optional GPIO the user asked for, e.g. "GP15". */
  pin?: string;
  /** Values the template asks for (layout.json `props.*.request`), e.g. an LED's color. */
  props?: Record<string, string | number>;
}

export interface PlacedBlock {
  kind: BlockKind;
  /** Main part ref (LED1, BTN1, POT1). */
  ref: string;
  /** All part refs in the block (e.g. LED1 + R1). */
  refs: string[];
  /** The block's GPIO; for a display, its SDA pin. */
  gpio: string;
  mode: GpioMode;
  /** Displays (I2C): the SCL pin and the bus number. */
  scl?: string;
  bus?: 0 | 1;
  rows: [number, number];
}

export interface Layout {
  build: Build;
  blocks: PlacedBlock[];
}

export class LayoutError extends Error {}

export type PowerMode = "rails" | "direct";
export const POWER_MODES: readonly PowerMode[] = ["rails", "direct"];

export interface LayoutOptions {
  /** Where parts take GND and 3V3 from (default "rails"). */
  power?: PowerMode;
}

/** Free breadboard holes next to each Pico pin (columns a-b or i-j; c-h are under the Pico). */
export const WIRES_PER_PICO_PIN = 2;

export const WIRE_COLORS = { gnd: "black", power: "red", signals: ["yellow", "green", "blue", "orange", "white", "purple"] };

const FIRST_PART_ROW = PICO_LAST_ROW + 4;
const BLOCK_GAP = 1;

/** The pack and layout template for a plan kind. */
function templateOf(kind: BlockKind): { pack: Pack; t: LayoutTemplate; pinName: string; pin: LayoutTemplate["pins"][string] } {
  const pack = packByKind(kind);
  if (!pack?.layout) throw new LayoutError(`Unknown part kind "${kind}".`);
  const [pinName, pin] = Object.entries(pack.layout.pins)[0]!;
  return { pack, t: pack.layout, pinName, pin };
}

const article = (noun: string) => (/^[aeiou]/i.test(noun) ? "an" : "a");
const orList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}` : (xs[0] ?? ""));
const COUNT_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight"];

export function gpioPreference(board: Board = PICO_2_W): BoardPin[] {
  const gpios = board.pins.filter((p) => p.type === "gpio");
  const rank = (p: BoardPin) => (p.phys > 20 ? 0 : 1000) - picoPinHole(p.phys).row;
  const sorted = [...gpios].sort((a, b) => rank(a) - rank(b));
  return [...sorted.filter((p) => p.adc === undefined), ...sorted.filter((p) => p.adc !== undefined)];
}

export interface PinChoice {
  /** The GPIO; for a display, its SDA pin. */
  gpio: string;
  scl?: string;
  bus?: 0 | 1;
}

/** I2C SDA/SCL pairs (SDA on GPn, SCL on GPn+1, same bus), in the order of gpioPreference. */
export function i2cPairs(board: Board = PICO_2_W): { sda: BoardPin; scl: BoardPin; bus: 0 | 1 }[] {
  return gpioPreference(board).flatMap((sda) => {
    const m = sda.functions?.map((f) => /^I2C(\d)_SDA$/.exec(f)).find(Boolean);
    if (!m) return [];
    const bus = Number(m[1]) as 0 | 1;
    const scl = board.pins.find((p) => p.type === "gpio" && p.gpio === sda.gpio! + 1 && p.functions?.includes(`I2C${bus}_SCL`));
    return scl ? [{ sda, scl, bus }] : [];
  });
}

export function allocate(requests: BlockRequest[], board: Board = PICO_2_W): PinChoice[] {
  const used = new Set<string>();
  const busesUsed = new Set<number>();
  const result: PinChoice[] = new Array(requests.length);
  const needs = requests.map((r) => templateOf(r.kind));
  const adcPins = board.pins.filter((p) => p.type === "gpio" && p.adc !== undefined).map((p) => p.name);
  const suits = (i: number, p: BoardPin) => (needs[i]!.pin.need === "adc" ? p.adc !== undefined : true);
  const take = (i: number, c: PinChoice) => {
    used.add(c.gpio);
    if (c.scl) used.add(c.scl);
    if (c.bus !== undefined) busesUsed.add(c.bus);
    result[i] = c;
  };
  // Per-part limits from the packs (e.g. displays that share one I2C address: one per bus).
  for (const kind of new Set(requests.map((r) => r.kind))) {
    const { t } = templateOf(kind);
    const n = requests.filter((r) => r.kind === kind).length;
    if (t.max !== undefined && n > t.max) throw new LayoutError(t.maxMessage!.replace("{n}", String(n)));
  }
  const freePair = (pred: (p: { sda: BoardPin; scl: BoardPin; bus: 0 | 1 }) => boolean) =>
    i2cPairs(board).find((p) => !used.has(p.sda.name) && !used.has(p.scl.name) && !busesUsed.has(p.bus) && pred(p));

  // Explicit requests first so automatic picks never take them.
  requests.forEach((r, i) => {
    if (!r.pin) return;
    const { t, pin: need } = needs[i]!;
    const pin = board.pins.find((p) => p.type === "gpio" && p.name === r.pin!.toUpperCase());
    if (!pin) throw new LayoutError(`${r.pin} isn't a usable GPIO on the ${board.name}.`);
    if (need.need === "i2c-pair") {
      const pair = freePair((p) => p.sda.name === pin.name);
      if (!pair) throw new LayoutError(`${pin.name} can't be the ${t.name}'s SDA pin here. I2C SDA pins: ${i2cPairs(board).map((p) => p.sda.name).join(", ")}.`);
      return take(i, { gpio: pair.sda.name, scl: pair.scl.name, bus: pair.bus });
    }
    if (!suits(i, pin)) throw new LayoutError(`${pin.name} can't read analog values; ${article(t.name)} ${t.name} needs ${orList(adcPins)}.`);
    if (used.has(pin.name)) throw new LayoutError(`${pin.name} was requested for two parts.`);
    take(i, { gpio: pin.name });
  });
  // Pin pairs next: they need a matching pair, which is harder to find than a single pin.
  requests.forEach((r, i) => {
    if (r.pin || needs[i]!.pin.need !== "i2c-pair") return;
    const pair = freePair(() => true);
    if (!pair) throw new LayoutError(`No free I2C pin pair (SDA + SCL on the same bus) left for the ${needs[i]!.t.name}.`);
    take(i, { gpio: pair.sda.name, scl: pair.scl.name, bus: pair.bus });
  });
  const order = gpioPreference(board);
  requests.forEach((r, i) => {
    if (result[i]) return;
    const pin = order.find((p) => !used.has(p.name) && suits(i, p));
    if (!pin) {
      const short = board.name.replace(/^Raspberry Pi /, "");
      throw new LayoutError(needs[i]!.pin.need === "adc" ? `No ADC pins left: the ${short} has only ${COUNT_WORDS[adcPins.length] ?? adcPins.length} (${adcPins[0]}-${adcPins.at(-1)}).` : "No free GPIO pins left.");
    }
    take(i, { gpio: pin.name });
  });
  return result;
}

export function allocatePins(requests: BlockRequest[], board: Board = PICO_2_W): string[] {
  return allocate(requests, board).map((c) => c.gpio);
}

const hole = (row: number, col: Column) => `${row}${col}`;
const at = (row: number, col: Column, label?: string): Endpoint => (label ? { kind: "hole", row, col, label } : { kind: "hole", row, col });
const rail = (id: "RR+" | "RR-", row: number): Endpoint => ({ kind: "rail", rail: id, row, label: id === "RR-" ? "GND" : "3V3" });

/**
 * GND and 3V3 pins for direct mode, nearest the parts first (right side, lowest rows), each
 * usable for WIRES_PER_PICO_PIN wires. AGND (pin 33) is left out, as in rails mode.
 */
function directSupply(board: Board) {
  const near = (p: BoardPin) => (p.phys > 20 ? 0 : 1000) - picoPinHole(p.phys).row;
  const grounds = board.pins.filter((p) => p.type === "ground" && !p.aliases?.length).sort((a, b) => near(a) - near(b));
  const v33 = board.pins.find((p) => p.type === "power" && p.voltage === 3.3)!;
  const used = new Map<number, number>();
  const take = (p: BoardPin) => used.set(p.phys, (used.get(p.phys) ?? 0) + 1);
  const free = (p: BoardPin) => (used.get(p.phys) ?? 0) < WIRES_PER_PICO_PIN;
  return {
    ground(): BoardPin {
      const p = grounds.find(free);
      if (!p) throw new LayoutError("Direct-to-Pico power has run out of GND pins for this many parts. Switch to breadboard rails.");
      take(p);
      return p;
    },
    power(): BoardPin {
      if (!free(v33)) throw new LayoutError(`Direct-to-Pico power: the Pico has one 3.3 V output (${v33.name}, pin ${v33.phys}) with room for ${WIRES_PER_PICO_PIN} wires, so at most ${WIRES_PER_PICO_PIN} parts that need 3.3 V (knobs, displays). Switch to breadboard rails for more.`);
      take(v33);
      return v33;
    },
  };
}

export function layoutProject(requests: BlockRequest[], board: Board = PICO_2_W, opts: LayoutOptions = {}): Layout {
  // No parts (e.g. a project that only uses the Pico's on-board LED): just the Pico, no wires.
  if (requests.length === 0) return { build: { boardId: board.id, parts: [], wires: [], gpioModes: {} }, blocks: [] };
  const pins = allocate(requests, board);
  const parts: Part[] = [];
  const wires: Wire[] = [];
  const blocks: PlacedBlock[] = [];
  const gpioModes: Build["gpioModes"] = {};
  const counters: Record<string, number> = {};
  const nextRef = (prefix: string) => `${prefix}${(counters[prefix] = (counters[prefix] ?? 0) + 1)}`;
  // Takes a BoardPin, not a name: several pins share a name (eight are called GND).
  const pico = (p: BoardPin): Endpoint => ({ kind: "pico", phys: p.phys, label: p.name });
  const gpioPin = (name: string) => board.pins.find((x) => x.type === "gpio" && x.name === name)!;

  const direct = opts.power === "direct" ? directSupply(board) : null;
  // Wires from a part's hole to GND / 3V3: to the rail, or straight to a Pico pin in direct mode.
  const toGround = (from: Endpoint, row: number): Wire =>
    direct ? { from: pico(direct.ground()), to: from, color: WIRE_COLORS.gnd } : { from, to: rail("RR-", row), color: WIRE_COLORS.gnd };
  const toPower = (from: Endpoint, row: number): Wire =>
    direct ? { from: pico(direct.power()), to: from, color: WIRE_COLORS.power } : { from, to: rail("RR+", row), color: WIRE_COLORS.power };

  if (!direct) {
    // Ground rail from the right-side GND pin closest to the parts.
    const gnd = board.pins
      .filter((p) => p.type === "ground" && p.phys > 20 && !p.aliases?.length)
      .sort((a, b) => picoPinHole(b.phys).row - picoPinHole(a.phys).row)[0]!;
    wires.push({ from: pico(gnd), to: rail("RR-", picoPinHole(gnd.phys).row), color: WIRE_COLORS.gnd });
    // 3V3 rail only when a part takes power from it.
    if (requests.some((r) => templateOf(r.kind).t.wires.some((w) => "power" in w))) {
      const v33 = board.pins.find((p) => p.type === "power" && p.voltage === 3.3)!;
      wires.push({ from: pico(v33), to: rail("RR+", picoPinHole(v33.phys).row), color: WIRE_COLORS.power });
    }
  }

  let row = FIRST_PART_ROW;
  requests.forEach((req, i) => {
    const { t, pinName, pin } = templateOf(req.kind);
    const choice = pins[i]!;
    const r = row;
    const end = r + t.height - 1;
    if (end > BREADBOARD.rows) throw new LayoutError("Not enough room for all these parts on one breadboard.");
    const color = WIRE_COLORS.signals[blocks.length % WIRE_COLORS.signals.length]!;

    // Parts, each with the next free designator for its prefix (LED1, R1, ...).
    const refOf = new Map<string, string>();
    for (const tp of t.parts) {
      const ref = nextRef(tp.ref);
      refOf.set(tp.ref, ref);
      const part: Part = { ref, type: tp.type === "self" ? templateOf(req.kind).pack.part.id : tp.type, legs: Object.fromEntries(Object.entries(tp.legs).map(([leg, [dr, col]]) => [leg, hole(r + dr, col)])) };
      if (tp.props) part.props = Object.fromEntries(Object.entries(tp.props).map(([k, v]) => [k, (v.request !== undefined ? req.props?.[v.request] : undefined) ?? v.default]));
      parts.push(part);
    }
    const end_ = ([dr, col, label]: TemplateHole) => {
      const [ref, leg] = label.split(".");
      return { endpoint: at(r + dr, col, `${refOf.get(ref!)}.${leg}`), row: r + dr };
    };
    const pinGpio = (name: string) => (name === `${pinName}.scl` ? choice.scl! : choice.gpio);
    for (const w of t.wires) {
      if ("ground" in w) {
        const e = end_(w.ground);
        wires.push(toGround(e.endpoint, e.row));
      } else if ("power" in w) {
        const e = end_(w.power);
        wires.push(toPower(e.endpoint, e.row));
      } else wires.push({ from: pico(gpioPin(pinGpio(w.pin))), to: end_(w.to).endpoint, color: w.color ?? color });
    }

    const refs = [refOf.get(t.main)!, ...t.parts.filter((p) => p.ref !== t.main).map((p) => refOf.get(p.ref)!)];
    if (pin.need === "i2c-pair") {
      const bus = choice.bus!;
      gpioModes[choice.gpio] = `i2c${bus}_sda`;
      gpioModes[choice.scl!] = `i2c${bus}_scl`;
      blocks.push({ kind: req.kind, ref: refs[0]!, refs, gpio: choice.gpio, mode: `i2c${bus}_sda`, scl: choice.scl!, bus, rows: [r, end] });
    } else {
      gpioModes[choice.gpio] = pin.mode!;
      blocks.push({ kind: req.kind, ref: refs[0]!, refs, gpio: choice.gpio, mode: pin.mode!, rows: [r, end] });
    }
    row = end + 1 + BLOCK_GAP;
  });

  return { build: { boardId: board.id, parts, wires, gpioModes }, blocks };
}
