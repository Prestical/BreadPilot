// Pin allocator + layout engine.
// The LLM only says *what* it wants ("an LED", "a button"). This code decides
// which GPIO to use, where each part goes on the breadboard, and where every
// jumper goes. The result always passes validateBuild() (see test/layout.test.ts).
//
// Layout: the Pico sits in rows 1-20. Parts go below it from row 24 down, on the right half
// (columns f-j) or, mirrored, on the left half (a-e), each half its own stack (PLAN §21). A part
// goes to the half where its wires stay short: its pin on the same side of the Pico, not crossing it.
//
// Power (both modes are powered by the USB cable through the Pico):
// - "rails" (default): one wire from a Pico GND pin to the right − rail and (for knobs) one from
//   3V3(OUT) to the right + rail; every part then takes GND/3V3 from the rails. Both come from the
//   top of the Pico (GND pin 38, 3V3 pin 36), away from the signal pins near the parts.
// - "direct": no rails; every GND/3V3 wire goes straight from a Pico pin to the part. A Pico pin
//   has only two free holes next to it, so 3V3(OUT) (the only 3.3 V output) takes at most two
//   wires, which limits direct mode to two knobs. GND wires are spread over the GND pins.
//
// Wires at the Pico (PLAN §20): every pin choice is scored, not ranked. A pin near the parts on the
// right side is cheapest; a pin that already carries a wire, or whose neighbouring row does, costs
// more, so wires are spread out and easy to plug in. These are preferences, never bans: when only a
// crowded pin is left, it's used.

import { PICO_2_W } from "./board";
import { PICO_LAST_ROW, PICO_PINS_PER_SIDE, picoPinHole, BREADBOARD } from "./breadboard";
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
  /**
   * A part kept from an earlier version of the project (M9): it stays exactly where it was, so the
   * user doesn't touch it. Needs `pin` (its old GPIO; a display's SDA). See stableRequests().
   */
  place?: BlockPlace;
}

/** Where a kept part sits: its half, rows, part names (main first, as PlacedBlock.refs) and signal wire colour. */
export interface BlockPlace {
  side: Side;
  rows: [number, number];
  refs: string[];
  color?: string;
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
  /** The half of the breadboard it's on (a-e "L", f-j "R"). */
  side: Side;
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
  /** M9: the old version's part names. New parts never reuse them (a removed LED1 isn't replaced by a different LED1). */
  reservedRefs?: string[];
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

/** Soft costs for a wire on a Pico pin (PLAN §20). Lower is better; nothing is forbidden here. */
export const PIN_COST = {
  /** Per row away from the parts (they sit below the Pico). */
  perRow: 1,
  /** A pin on the other side of the Pico from its part: the wire crosses over the Pico. */
  crossing: 100,
  /** A wire in a neighbouring row (2.54 mm away): hard to plug in. */
  neighbour: 8,
  /** A second wire on the same pin: both of its free holes taken. */
  shared: 150,
  /** An ADC pin for a part that doesn't read analog values: keeps the 3 ADC pins for knobs. */
  adcForDigital: 1000,
} as const;

/** Soft costs for which half of the breadboard a part goes on (PLAN §21). */
export const SIDE_COST = {
  /** The first part on the left half: the left half needs its own GND feed (rails mode). */
  openLeft: 10,
  /** A left part that needs 3.3 V: a bridge wire from the right + rail (3V3(OUT) is on the right). */
  powerOnLeft: 20,
  /** Per row already used on that half: lower parts get longer wires. */
  perStackRow: 0.25,
} as const;

/** Halves of the breadboard: a-e ("L") and f-j ("R"); the Pico's pins 1-20 are on the left. */
export type Side = "L" | "R";
const sideOfPin = (p: BoardPin): Side => (p.phys <= PICO_PINS_PER_SIDE ? "L" : "R");

/** The wires at the Pico so far, for scoring the next pin. */
export class PinCrowd {
  private readonly wires = new Map<number, number>();
  constructor(private readonly board: Board) {}

  add(p: BoardPin): void {
    this.wires.set(p.phys, (this.wires.get(p.phys) ?? 0) + 1);
  }

  count(p: BoardPin): number {
    return this.wires.get(p.phys) ?? 0;
  }

  /**
   * What one more wire on `p` costs for a part on `side`; `together` = pins of the same part (an
   * I2C pair's other pin), whose row next to `p` doesn't count as crowding.
   */
  cost(p: BoardPin, together: BoardPin[] = [], side: Side = "R"): number {
    const { row } = picoPinHole(p.phys);
    const pinSide = sideOfPin(p);
    let cost = (pinSide === side ? 0 : PIN_COST.crossing) + (PICO_LAST_ROW - row) * PIN_COST.perRow + this.count(p) * PIN_COST.shared;
    for (const q of this.board.pins) {
      if (q.phys === p.phys || sideOfPin(q) !== pinSide || together.some((t) => t.phys === q.phys)) continue;
      if (this.count(q) > 0 && Math.abs(picoPinHole(q.phys).row - row) === 1) cost += PIN_COST.neighbour;
    }
    return cost;
  }
}

/** The cheapest item (ties: the first in `items`, i.e. the old fixed order). */
function cheapest<T>(items: T[], cost: (x: T) => number): T | undefined {
  let best: T | undefined;
  let bestCost = Infinity;
  for (const x of items) {
    const c = cost(x);
    if (c < bestCost) [best, bestCost] = [x, c];
  }
  return best;
}

const MIRROR: Record<Column, Column> = { a: "j", b: "i", c: "h", d: "g", e: "f", f: "e", g: "d", h: "c", i: "b", j: "a" };

/**
 * Where a template can go. Parts at the middle gap (columns e/f) take their rows on both halves: a
 * button straddles the gap, a header module's board lies over the other half. A template with legs
 * on only one half there (the display) stays on the right; everything else can be mirrored.
 */
function geometry(t: LayoutTemplate): { spans: boolean; sides: Side[] } {
  const cols = t.parts.flatMap((p) => Object.values(p.legs).map(([, c]) => c));
  const atGap = cols.some((c) => c === "e" || c === "f");
  const both = cols.some((c) => c <= "e") && cols.some((c) => c >= "f");
  return { spans: atGap, sides: atGap && !both ? ["R"] : ["R", "L"] };
}

const needsPower = (t: LayoutTemplate) => t.wires.some((w) => "power" in w);

/** The GND pin at the top of a side: the rail's feed wire, away from the signal pins. */
function topGround(board: Board, side: Side): BoardPin {
  return board.pins.filter((p) => p.type === "ground" && sideOfPin(p) === side && !p.aliases?.length).sort((a, b) => picoPinHole(a.phys).row - picoPinHole(b.phys).row)[0]!;
}
const v33Of = (board: Board) => board.pins.find((p) => p.type === "power" && p.voltage === 3.3)!;

interface PartPlan {
  choice: PinChoice;
  side: Side;
  rows: [number, number];
}

interface Plan {
  parts: PartPlan[];
  /** Some part is on the left half. */
  leftOpen: boolean;
}

/**
 * Picks each part's half, rows and GPIO(s), in request order (requested pins are reserved first).
 * Independent of the power mode on purpose: switching rails ↔ direct keeps every GPIO and place, so
 * the code stays valid. The power wires (rails or Pico pins) are chosen afterwards.
 */
function plan(requests: BlockRequest[], board: Board): Plan {
  const needs = requests.map((r) => templateOf(r.kind));
  // Per-part limits from the packs (e.g. displays that share one I2C address: one per bus).
  for (const kind of new Set(requests.map((r) => r.kind))) {
    const { t } = templateOf(kind);
    const n = requests.filter((r) => r.kind === kind).length;
    if (t.max !== undefined && n > t.max) throw new LayoutError(t.maxMessage!.replace("{n}", String(n)));
  }

  const crowd = new PinCrowd(board);
  // The rails' feed wires, counted in both power modes so the GPIOs don't depend on the mode.
  crowd.add(topGround(board, "R"));
  if (needs.some((n) => needsPower(n.t))) crowd.add(v33Of(board));

  const used = new Set<string>();
  const busesUsed = new Set<number>();
  const adcPins = board.pins.filter((p) => p.type === "gpio" && p.adc !== undefined).map((p) => p.name);
  const byName = (name: string) => board.pins.find((p) => p.type === "gpio" && p.name === name)!;
  const take = (c: PinChoice) => {
    used.add(c.gpio);
    crowd.add(byName(c.gpio));
    if (c.scl) {
      used.add(c.scl);
      crowd.add(byName(c.scl));
    }
    if (c.bus !== undefined) busesUsed.add(c.bus);
  };

  // Requested pins first, so automatic picks never take them. (Pairs are added to this list below.)
  const explicit: (PinChoice | undefined)[] = requests.map((r, i) => {
    if (!r.pin) return undefined;
    const { t, pin: need } = needs[i]!;
    const pin = board.pins.find((p) => p.type === "gpio" && p.name === r.pin!.toUpperCase());
    if (!pin) throw new LayoutError(`${r.pin} isn't a usable GPIO on the ${board.name}.`);
    if (need.need === "i2c-pair") {
      const pair = i2cPairs(board).find((p) => p.sda.name === pin.name && !used.has(p.sda.name) && !used.has(p.scl.name) && !busesUsed.has(p.bus));
      if (!pair) throw new LayoutError(`${pin.name} can't be the ${t.name}'s SDA pin here. I2C SDA pins: ${i2cPairs(board).map((p) => p.sda.name).join(", ")}.`);
      const c = { gpio: pair.sda.name, scl: pair.scl.name, bus: pair.bus };
      take(c);
      return c;
    }
    if (need.need === "adc" && pin.adc === undefined) throw new LayoutError(`${pin.name} can't read analog values; ${article(t.name)} ${t.name} needs ${orList(adcPins)}.`);
    if (used.has(pin.name)) throw new LayoutError(`${pin.name} was requested for two parts.`);
    const c = { gpio: pin.name };
    take(c);
    return c;
  });

  // I2C pairs next (pins only; places follow in request order): a pair needs two matching pins, which
  // single parts taking every other pin would otherwise break up. Scored for the pair's first side.
  const pairCost = (p: { sda: BoardPin; scl: BoardPin }, side: Side) =>
    crowd.cost(p.sda, [p.scl], side) + crowd.cost(p.scl, [p.sda], side) + [p.sda, p.scl].filter((x) => x.adc !== undefined).length * PIN_COST.adcForDigital;
  requests.forEach((r, i) => {
    if (explicit[i] || needs[i]!.pin.need !== "i2c-pair") return;
    const side = geometry(needs[i]!.t).sides[0]!;
    const pair = cheapest(
      i2cPairs(board).filter((p) => !used.has(p.sda.name) && !used.has(p.scl.name) && !busesUsed.has(p.bus)),
      (p) => pairCost(p, side),
    );
    if (!pair) throw new LayoutError(`No free I2C pin pair (SDA + SCL on the same bus) left for the ${needs[i]!.t.name}.`);
    const c = { gpio: pair.sda.name, scl: pair.scl.name, bus: pair.bus };
    take(c);
    explicit[i] = c;
  });

  const order = gpioPreference(board);
  /** The cheapest pin choice for request i if its part goes on `side`, with its cost. */
  const pickFor = (i: number, side: Side): { choice: PinChoice; cost: number } | null => {
    const need = needs[i]!.pin.need;
    const ex = explicit[i];
    if (ex) {
      const pins = [byName(ex.gpio), ...(ex.scl ? [byName(ex.scl)] : [])];
      return { choice: ex, cost: pins.filter((p) => sideOfPin(p) !== side).length * PIN_COST.crossing };
    }
    const digital = need !== "adc";
    const pinCost = (p: BoardPin) => crowd.cost(p, [], side) + (digital && p.adc !== undefined ? PIN_COST.adcForDigital : 0);
    const pin = cheapest(
      order.filter((p) => !used.has(p.name) && (digital || p.adc !== undefined)),
      pinCost,
    );
    return pin ? { choice: { gpio: pin.name }, cost: pinCost(pin) } : null;
  };

  const next: Record<Side, number> = { L: FIRST_PART_ROW, R: FIRST_PART_ROW };
  let leftOpen = false;
  // Kept parts (M9) are fixed first: new parts go below them on their half; a removed part's rows
  // stay empty, so nothing that stays has to move.
  requests.forEach((r, i) => {
    if (!r.place) return;
    if (!explicit[i]) throw new LayoutError(`A kept ${needs[i]!.t.name} needs its old pin.`);
    const { side, rows } = r.place;
    if (rows[1] > BREADBOARD.rows || rows[0] < FIRST_PART_ROW) throw new LayoutError(`The kept ${needs[i]!.t.name} doesn't fit on the breadboard any more.`);
    const after = rows[1] + 1 + BLOCK_GAP;
    if (geometry(needs[i]!.t).spans) next.L = next.R = Math.max(next.L, next.R, after);
    else next[side] = Math.max(next[side], after);
    if (side === "L" && !leftOpen) {
      leftOpen = true;
      crowd.add(topGround(board, "L"));
    }
  });
  const parts: PartPlan[] = requests.map((r, i) => {
    if (r.place) return { choice: explicit[i]!, side: r.place.side, rows: r.place.rows };
    const { t } = needs[i]!;
    const geo = geometry(t);
    let best: (PartPlan & { cost: number }) | null = null;
    let noPin = false;
    for (const side of geo.sides) {
      const start = geo.spans ? Math.max(next.L, next.R) : next[side];
      const end = start + t.height - 1;
      if (end > BREADBOARD.rows) continue;
      const pick = pickFor(i, side);
      if (!pick) {
        noPin = true;
        continue;
      }
      const cost =
        pick.cost +
        (side === "L" && !leftOpen ? SIDE_COST.openLeft : 0) +
        (side === "L" && needsPower(t) ? SIDE_COST.powerOnLeft : 0) +
        (start - FIRST_PART_ROW) * SIDE_COST.perStackRow;
      if (!best || cost < best.cost) best = { choice: pick.choice, side, rows: [start, end], cost };
    }
    if (!best) {
      if (!noPin) throw new LayoutError("Not enough room for all these parts on one breadboard.");
      const short = board.name.replace(/^Raspberry Pi /, "");
      const need = needs[i]!.pin.need;
      throw new LayoutError(need === "adc" ? `No ADC pins left: the ${short} has only ${COUNT_WORDS[adcPins.length] ?? adcPins.length} (${adcPins[0]}-${adcPins.at(-1)}).` : "No free GPIO pins left.");
    }
    if (!explicit[i]) take(best.choice); // requested pins and pairs were taken above
    if (best.side === "L" && !leftOpen) {
      leftOpen = true;
      crowd.add(topGround(board, "L")); // the left rail's feed wire (rails mode)
    }
    const after = best.rows[1] + 1 + BLOCK_GAP;
    if (geo.spans) next.L = next.R = after;
    else next[best.side] = after;
    return { choice: best.choice, side: best.side, rows: best.rows };
  });
  return { parts, leftOpen };
}

/**
 * GPIOs for the requested parts, exactly as layoutProject picks them (the same in both power
 * modes; `opts` is accepted for older callers).
 */
export function allocate(requests: BlockRequest[], board: Board = PICO_2_W, _opts: LayoutOptions = {}): PinChoice[] {
  return plan(requests, board).parts.map((p) => p.choice);
}

export function allocatePins(requests: BlockRequest[], board: Board = PICO_2_W, opts: LayoutOptions = {}): string[] {
  return allocate(requests, board, opts).map((c) => c.gpio);
}

const hole = (row: number, col: Column) => `${row}${col}`;
const at = (row: number, col: Column, label?: string): Endpoint => (label ? { kind: "hole", row, col, label } : { kind: "hole", row, col });
type RailId = "RR+" | "RR-" | "RL+" | "RL-";
const rail = (id: RailId, row: number): Endpoint => ({ kind: "rail", rail: id, row, label: id.endsWith("-") ? "GND" : "3V3" });
const railOf = (side: Side, polarity: "+" | "-"): RailId => `R${side}${polarity}` as RailId;

/**
 * GND and 3V3 pins for direct mode, scored like the GPIOs (for the part's side): every GND pin takes
 * one wire before any takes a second (at most WIRES_PER_PICO_PIN, its free holes). AGND (pin 33) is
 * left out, as in rails mode.
 */
function directSupply(board: Board, crowd: PinCrowd) {
  const grounds = board.pins.filter((p) => p.type === "ground" && !p.aliases?.length);
  const v33 = v33Of(board);
  const free = (p: BoardPin) => crowd.count(p) < WIRES_PER_PICO_PIN;
  return {
    ground(side: Side): BoardPin {
      const p = cheapest(grounds.filter(free), (g) => crowd.cost(g, [], side));
      if (!p) throw new LayoutError("Direct-to-Pico power has run out of GND pins for this many parts. Switch to breadboard rails.");
      crowd.add(p);
      return p;
    },
    power(): BoardPin {
      if (!free(v33)) throw new LayoutError(`Direct-to-Pico power: the Pico has one 3.3 V output (${v33.name}, pin ${v33.phys}) with room for ${WIRES_PER_PICO_PIN} wires, so at most ${WIRES_PER_PICO_PIN} parts that need 3.3 V (knobs, displays). Switch to breadboard rails for more.`);
      crowd.add(v33);
      return v33;
    },
  };
}

export function layoutProject(requests: BlockRequest[], board: Board = PICO_2_W, opts: LayoutOptions = {}): Layout {
  // No parts (e.g. a project that only uses the Pico's on-board LED): just the Pico, no wires.
  if (requests.length === 0) return { build: { boardId: board.id, parts: [], wires: [], gpioModes: {} }, blocks: [] };
  const { parts: plans, leftOpen } = plan(requests, board);
  const parts: Part[] = [];
  const wires: Wire[] = [];
  const blocks: PlacedBlock[] = [];
  const gpioModes: Build["gpioModes"] = {};
  const counters: Record<string, number> = {};
  // Kept parts keep their names (LED2 stays LED2); new parts are numbered after the highest kept one.
  const keptRefs = new Set([...requests.flatMap((r) => r.place?.refs ?? []), ...(opts.reservedRefs ?? [])]);
  for (const ref of keptRefs) {
    const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
    if (m) counters[m[1]!] = Math.max(counters[m[1]!] ?? 0, Number(m[2]));
  }
  const nextRef = (prefix: string) => {
    let ref: string;
    do ref = `${prefix}${(counters[prefix] = (counters[prefix] ?? 0) + 1)}`;
    while (keptRefs.has(ref));
    return ref;
  };
  // Signal wire colours: kept parts keep theirs; a new part takes the first colour not in use. During a
  // change, colours a part file fixes (a display's SDA/SCL) count as in use too; a new project keeps
  // today's colour order.
  const usedColors = new Set(requests.flatMap((r) => (r.place?.color ? [r.place.color] : [])));
  if (requests.some((r) => r.place)) for (const r of requests) for (const w of templateOf(r.kind).t.wires) if ("pin" in w && w.color) usedColors.add(w.color);
  const signalColor = (req: BlockRequest): string => {
    if (req.place?.color) return req.place.color;
    const free = WIRE_COLORS.signals.find((c) => !usedColors.has(c));
    const c = free ?? WIRE_COLORS.signals[blocks.length % WIRE_COLORS.signals.length]!;
    usedColors.add(c);
    return c;
  };
  // Takes a BoardPin, not a name: several pins share a name (eight are called GND).
  const pico = (p: BoardPin): Endpoint => ({ kind: "pico", phys: p.phys, label: p.name });
  const gpioPin = (name: string) => board.pins.find((x) => x.type === "gpio" && x.name === name)!;

  let direct: ReturnType<typeof directSupply> | null = null;
  if (opts.power === "direct") {
    // GND/3V3 wires go where the signal wires aren't.
    const crowd = new PinCrowd(board);
    for (const { choice } of plans) for (const name of [choice.gpio, choice.scl]) if (name) crowd.add(gpioPin(name));
    direct = directSupply(board, crowd);
  } else {
    // Rails: the right − rail from GND pin 38 and, when a part takes 3V3, the right + rail from
    // 3V3(OUT); with parts on the left half, the left − rail from its top GND pin, and a bridge
    // from the right + rail when a left part takes 3V3.
    const gndR = topGround(board, "R");
    wires.push({ from: pico(gndR), to: rail("RR-", picoPinHole(gndR.phys).row), color: WIRE_COLORS.gnd });
    if (requests.some((r) => needsPower(templateOf(r.kind).t))) {
      const v33 = v33Of(board);
      wires.push({ from: pico(v33), to: rail("RR+", picoPinHole(v33.phys).row), color: WIRE_COLORS.power });
    }
    if (leftOpen) {
      const gndL = topGround(board, "L");
      wires.push({ from: pico(gndL), to: rail("RL-", picoPinHole(gndL.phys).row), color: WIRE_COLORS.gnd });
    }
    if (plans.some((p, i) => p.side === "L" && needsPower(templateOf(requests[i]!.kind).t))) {
      wires.push({ from: rail("RR+", BREADBOARD.rows), to: rail("RL+", BREADBOARD.rows), color: WIRE_COLORS.power });
    }
  }
  // Wires from a part's hole to GND / 3V3: to its half's rail, or straight to a Pico pin in direct mode.
  const toGround = (from: Endpoint, row: number, side: Side): Wire =>
    direct ? { from: pico(direct.ground(side)), to: from, color: WIRE_COLORS.gnd } : { from, to: rail(railOf(side, "-"), row), color: WIRE_COLORS.gnd };
  const toPower = (from: Endpoint, row: number, side: Side): Wire =>
    direct ? { from: pico(direct.power()), to: from, color: WIRE_COLORS.power } : { from, to: rail(railOf(side, "+"), row), color: WIRE_COLORS.power };

  requests.forEach((req, i) => {
    const { t, pinName, pin } = templateOf(req.kind);
    const { choice, side, rows } = plans[i]!;
    const [r, end] = rows;
    // The template is drawn for the right half; on the left half every column is mirrored.
    const col = (c: Column) => (side === "L" ? MIRROR[c] : c);
    const color = signalColor(req);

    // Parts, each with the next free designator for its prefix (LED1, R1, ...); a kept part's own names.
    const refOf = new Map<string, string>();
    if (req.place) {
      // place.refs = [main, then the other parts in template order], as PlacedBlock.refs.
      const order = [t.main, ...t.parts.filter((p) => p.ref !== t.main).map((p) => p.ref)];
      order.forEach((tref, k) => {
        if (req.place!.refs[k]) refOf.set(tref, req.place!.refs[k]!);
      });
    }
    for (const tp of t.parts) {
      const ref = refOf.get(tp.ref) ?? nextRef(tp.ref);
      refOf.set(tp.ref, ref);
      const part: Part = { ref, type: tp.type === "self" ? templateOf(req.kind).pack.part.id : tp.type, legs: Object.fromEntries(Object.entries(tp.legs).map(([leg, [dr, c]]) => [leg, hole(r + dr, col(c))])) };
      if (tp.props) part.props = Object.fromEntries(Object.entries(tp.props).map(([k, v]) => [k, (v.request !== undefined ? req.props?.[v.request] : undefined) ?? v.default]));
      parts.push(part);
    }
    const end_ = ([dr, c, label]: TemplateHole) => {
      const [ref, leg] = label.split(".");
      return { endpoint: at(r + dr, col(c), `${refOf.get(ref!)}.${leg}`), row: r + dr };
    };
    const pinGpio = (name: string) => (name === `${pinName}.scl` ? choice.scl! : choice.gpio);
    for (const w of t.wires) {
      if ("ground" in w) {
        const e = end_(w.ground);
        wires.push(toGround(e.endpoint, e.row, side));
      } else if ("power" in w) {
        const e = end_(w.power);
        wires.push(toPower(e.endpoint, e.row, side));
      } else wires.push({ from: pico(gpioPin(pinGpio(w.pin))), to: end_(w.to).endpoint, color: w.color ?? color });
    }

    const refs = [refOf.get(t.main)!, ...t.parts.filter((p) => p.ref !== t.main).map((p) => refOf.get(p.ref)!)];
    if (pin.need === "i2c-pair") {
      const bus = choice.bus!;
      gpioModes[choice.gpio] = `i2c${bus}_sda`;
      gpioModes[choice.scl!] = `i2c${bus}_scl`;
      blocks.push({ kind: req.kind, ref: refs[0]!, refs, gpio: choice.gpio, mode: `i2c${bus}_sda`, scl: choice.scl!, bus, rows: [r, end], side });
    } else {
      gpioModes[choice.gpio] = pin.mode!;
      blocks.push({ kind: req.kind, ref: refs[0]!, refs, gpio: choice.gpio, mode: pin.mode!, rows: [r, end], side });
    }
  });

  return { build: { boardId: board.id, parts, wires, gpioModes }, blocks };
}

/**
 * M9 (project changes): marks which parts of a new plan are parts of the old layout, so they stay
 * exactly where they were (pins, holes, names, wire colour). A request matches an old block of the
 * same kind: first one on the pin the request names, then one with the same settings (an LED's
 * colour), then the others of that kind in their old order.
 * A request that names a different pin than every old block of its kind is placed fresh (the user
 * asked to move it). Old blocks nobody matches are the removed parts.
 */
export function stableRequests(old: Layout, requests: BlockRequest[]): BlockRequest[] {
  const taken = new Set<number>();
  // A block's settings as the layout made them: its parts' props, e.g. { color: "red" }.
  const propsOf = (b: PlacedBlock) => JSON.stringify(Object.fromEntries(old.build.parts.filter((x) => b.refs.includes(x.ref)).flatMap((x) => Object.entries(x.props ?? {})).sort()));
  const sameProps = (req: BlockRequest, b: PlacedBlock) => !req.props || JSON.stringify(Object.entries(req.props).sort()) === JSON.stringify(Object.entries(JSON.parse(propsOf(b)) as Record<string, unknown>).filter(([k]) => k in req.props!).sort());
  const colorOf = (b: PlacedBlock): string | undefined =>
    old.build.wires.find((w) => w.from.kind === "pico" && w.from.label === b.gpio && w.to.kind === "hole" && b.refs.some((r) => w.to.kind === "hole" && w.to.label?.startsWith(`${r}.`)))?.color;
  const keep = (req: BlockRequest, i: number): BlockRequest => {
    taken.add(i);
    const b = old.blocks[i]!;
    const color = colorOf(b);
    return { ...req, pin: b.gpio, place: { side: b.side, rows: b.rows, refs: b.refs, ...(color ? { color } : {}) } };
  };
  const out: (BlockRequest | null)[] = requests.map(() => null);
  // Pass 1: same kind on the pin the request names.
  requests.forEach((req, k) => {
    if (!req.pin) return;
    const i = old.blocks.findIndex((b, j) => !taken.has(j) && b.kind === req.kind && b.gpio === req.pin!.toUpperCase());
    if (i >= 0) out[k] = keep(req, i);
  });
  // Pass 2: requests without a pin, on a block of their kind with the same settings.
  requests.forEach((req, k) => {
    if (out[k] || req.pin || !req.props) return;
    const i = old.blocks.findIndex((b, j) => !taken.has(j) && b.kind === req.kind && sameProps(req, b));
    if (i >= 0) out[k] = keep(req, i);
  });
  // Pass 3: requests without a pin take the remaining old blocks of their kind, in old order.
  requests.forEach((req, k) => {
    if (out[k] || req.pin) return;
    const i = old.blocks.findIndex((b, j) => !taken.has(j) && b.kind === req.kind);
    if (i >= 0) out[k] = keep(req, i);
  });
  return requests.map((req, k) => out[k] ?? req);
}
