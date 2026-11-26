// M18 18.4: break good circuits in known ways. Each break returns the broken build and the codes the
// validator must give for it (any one of them is enough, others may come too). Used by
// breaks.test.ts on random engine layouts of every part kind, in both power modes.

import { PACKS } from "../src/packs";
import type { Build, Column, Endpoint, Part, Wire } from "../src/types";

export interface Broken {
  build: Build;
  expect: string[];
  what: string;
}
export type Breaker = (b: Build) => Broken[];

const LEFT: Column[] = ["a", "b", "c", "d", "e"];
const RIGHT: Column[] = ["f", "g", "h", "i", "j"];
const ROWS = 63;
const FIRST_FREE_ROW = 21; // rows 1-20 hold the Pico

/**
 * A copy with the hole labels of the wires dropped ("#24j(R1.a)" → "#24j"): a moved leg would
 * otherwise only give E006 (label ≠ row contents) and hide what the break really does.
 */
const clone = (b: Build): Build => {
  const n = JSON.parse(JSON.stringify(b)) as Build;
  for (const w of n.wires) for (const e of [w.from, w.to]) if (e.kind === "hole") delete e.label;
  return n;
};
const defOf = (p: Part) => PACKS.find((x) => x.part.id === p.type)?.part;
const parseHole = (h: string) => ({ row: Number(/^\d+/.exec(h)![0]), col: h.slice(-1) as Column });
const halfOf = (col: Column) => (LEFT.includes(col) ? LEFT : RIGHT);
const pico = (phys: number, label: string): Endpoint => ({ kind: "pico", phys, label });
const hole = (h: string): Endpoint => {
  const { row, col } = parseHole(h);
  return { kind: "hole", row, col };
};

function usedHoles(b: Build): Set<string> {
  const used = new Set<string>();
  for (const p of b.parts) for (const h of Object.values(p.legs)) used.add(h);
  for (const w of b.wires) for (const e of [w.from, w.to]) if (e.kind === "hole" && e.col) used.add(`${e.row}${e.col}`);
  return used;
}

/** A free hole in the same strip (row and half) as `h`. */
function freeInStrip(b: Build, h: string): string | undefined {
  const { row, col } = parseHole(h);
  const used = usedHoles(b);
  return halfOf(col).map((c) => `${row}${c}`).find((x) => !used.has(x));
}

/** A hole in a strip nothing uses yet (no part, no wire). */
function emptyStrip(b: Build): string | undefined {
  const used = usedHoles(b);
  for (let row = ROWS; row >= FIRST_FREE_ROW; row--) {
    for (const half of [RIGHT, LEFT]) if (half.every((c) => !used.has(`${row}${c}`))) return `${row}${half[2]}`;
  }
  return undefined;
}

const jumpersOn = (b: Build, phys: number) => b.wires.filter((w) => [w.from, w.to].some((e) => e.kind === "pico" && e.phys === phys)).length;
const GROUND_PINS = [3, 8, 13, 18, 23, 28, 38];
const freeGround = (b: Build) => GROUND_PINS.find((p) => jumpersOn(b, p) < 2);

/** Driven GPIOs (out / pwm) with their physical pin, from the wires that reach them. */
function gpioPins(b: Build): { name: string; phys: number; mode: string }[] {
  const out: { name: string; phys: number; mode: string }[] = [];
  for (const w of b.wires) {
    for (const e of [w.from, w.to]) {
      if (e.kind === "pico" && /^GP\d+$/.test(e.label) && b.gpioModes[e.label] && !out.some((x) => x.phys === e.phys)) out.push({ name: e.label, phys: e.phys, mode: b.gpioModes[e.label]! });
    }
  }
  return out;
}

/** The resistor in series with an LED's anode (the LED block's current limiter). */
function ledResistors(b: Build): { led: Part; r: Part }[] {
  const strip = (h: string) => {
    const { row, col } = parseHole(h);
    return `${row}${halfOf(col)[0]}`;
  };
  const out: { led: Part; r: Part }[] = [];
  for (const led of b.parts.filter((p) => p.type === "led-5mm")) {
    const r = b.parts.find((p) => p.type === "resistor" && Object.values(p.legs).some((h) => strip(h) === strip(led.legs.anode!)));
    if (r) out.push({ led, r });
  }
  return out;
}

const addWire = (b: Build, w: Wire) => {
  const n = clone(b);
  n.wires.push(w);
  return n;
};

// ---------- the breaks ----------

/** A jumper around the LED's resistor: nothing limits the current any more. */
export const bypassResistor: Breaker = (b) =>
  ledResistors(b).flatMap(({ led, r }) => {
    const a = freeInStrip(b, r.legs.a!);
    if (!a) return [];
    const n = clone(b);
    const c = freeInStrip(n, r.legs.b!);
    if (!c) return [];
    n.wires.push({ from: hole(a), to: hole(c) });
    return [{ build: n, expect: ["E004"], what: `jumper around ${r.ref} (${led.ref}'s resistor)` }];
  });

/** The LED's resistor swapped for 10 Ω: far more current than the pin's drive strength. */
export const tinyResistor: Breaker = (b) =>
  ledResistors(b).map(({ led, r }) => {
    const n = clone(b);
    n.parts.find((p) => p.ref === r.ref)!.props = { ohms: 10 };
    return { build: n, expect: ["W011"], what: `${r.ref} (${led.ref}) is 10 Ω` };
  });

/** An LED turned around. */
export const ledBackwards: Breaker = (b) =>
  b.parts
    .filter((p) => p.type === "led-5mm")
    .map((led) => {
      const n = clone(b);
      const p = n.parts.find((x) => x.ref === led.ref)!;
      p.legs = { anode: led.legs.cathode!, cathode: led.legs.anode! };
      return { build: n, expect: ["W009"], what: `${led.ref} backwards` };
    });

/** Both legs of a two-leg part in one strip. */
export const oneStrip: Breaker = (b) =>
  b.parts
    .filter((p) => Object.keys(p.legs).length === 2 && (p.type === "led-5mm" || p.type === "resistor"))
    .flatMap((p) => {
      const [first, second] = Object.keys(p.legs) as [string, string];
      const to = freeInStrip(b, p.legs[first]!);
      if (!to) return [];
      const n = clone(b);
      n.parts.find((x) => x.ref === p.ref)!.legs[second] = to;
      return [{ build: n, expect: ["E005"], what: `${p.ref} with both legs in one strip` }];
    });

/** A GPIO wired straight to GND, to 3V3 or to VBUS (5 V). */
export const gpioToRail: Breaker = (b) =>
  gpioPins(b).flatMap((g) => {
    if (jumpersOn(b, g.phys) >= 2) return [];
    const out: Broken[] = [];
    const gnd = freeGround(b);
    if (gnd) out.push({ build: addWire(b, { from: pico(g.phys, g.name), to: pico(gnd, "GND") }), expect: ["E003"], what: `${g.name} to GND (pin ${gnd})` });
    if (jumpersOn(b, 36) < 2) out.push({ build: addWire(b, { from: pico(g.phys, g.name), to: pico(36, "3V3") }), expect: ["E003"], what: `${g.name} to 3V3` });
    if (jumpersOn(b, 40) < 2) out.push({ build: addWire(b, { from: pico(g.phys, g.name), to: pico(40, "VBUS") }), expect: ["E007"], what: `${g.name} to VBUS` });
    return out;
  });

/** Two outputs joined. */
export const joinOutputs: Breaker = (b) => {
  const outs = gpioPins(b).filter((g) => (g.mode === "out" || g.mode === "pwm") && jumpersOn(b, g.phys) < 2);
  if (outs.length < 2) return [];
  const [x, y] = outs as [(typeof outs)[0], (typeof outs)[0]];
  return [{ build: addWire(b, { from: pico(x.phys, x.name), to: pico(y.phys, y.name) }), expect: ["E003"], what: `${x.name} joined to ${y.name}` }];
};

/** A part's supply and ground legs swapped (module put in the wrong way round). */
export const supplyReversed: Breaker = (b) =>
  b.parts.flatMap((p) => {
    const def = defOf(p);
    const vcc = def?.legs.find((l) => l.kind === "power_in" && p.legs[l.id]);
    const gnd = def?.legs.find((l) => l.kind === "ground" && p.legs[l.id]);
    if (!vcc || !gnd) return [];
    const n = clone(b);
    const q = n.parts.find((x) => x.ref === p.ref)!;
    [q.legs[vcc.id], q.legs[gnd.id]] = [p.legs[gnd.id]!, p.legs[vcc.id]!];
    return [{ build: n, expect: ["E018"], what: `${p.ref} supply reversed` }];
  });

/** A part's supply leg moved to its own strip and fed from VBUS (5 V). */
export const supplyFrom5V: Breaker = (b) =>
  b.parts.flatMap((p) => {
    const def = defOf(p);
    const vcc = def?.legs.find((l) => l.kind === "power_in" && p.legs[l.id]);
    if (!vcc || jumpersOn(b, 40) >= 2) return [];
    const to = emptyStrip(b);
    if (!to) return [];
    // Only parts with a known reason to fail on 5 V: a 3.3 V-only supply (E014), a range below 5 V
    // (W010), or an output that follows the supply into a Pico pin (E007). Others may run on 5 V.
    const expect = [
      ...(vcc.maxSafeVoltage !== undefined && vcc.maxSafeVoltage < 5 ? ["E014"] : []),
      ...(vcc.voltageRange && vcc.voltageRange[1] < 5 ? ["W010"] : []),
      ...(def!.legs.some((l) => l.level === "vcc" && p.legs[l.id]) ? ["E007"] : []),
    ];
    if (!expect.length) return [];
    const n = clone(b);
    n.parts.find((x) => x.ref === p.ref)!.legs[vcc.id] = to;
    const feed = freeInStrip(n, to);
    if (!feed) return [];
    n.wires.push({ from: pico(40, "VBUS"), to: hole(feed) });
    return [{ build: n, expect, what: `${p.ref} powered from VBUS (5 V)` }];
  });

/** A part's ground wire removed: the part has no complete circuit. */
export const groundRemoved: Breaker = (b) =>
  b.parts.flatMap((p) => {
    const def = defOf(p);
    const gnd = def?.legs.find((l) => l.kind === "ground" && p.legs[l.id]);
    if (!gnd) return [];
    const { row, col } = parseHole(p.legs[gnd.id]!);
    const half = halfOf(col);
    const i = b.wires.findIndex((w) => [w.from, w.to].some((e) => e.kind === "hole" && e.row === row && e.col && half.includes(e.col)));
    if (i < 0) return [];
    const n = clone(b);
    n.wires.splice(i, 1);
    return [{ build: n, expect: ["W008"], what: `${p.ref}'s ground wire removed` }];
  });

/** A pull-up resistor (a resistor from a part's supply strip to its data strip) left out. */
export const pullUpRemoved: Breaker = (b) =>
  b.parts.flatMap((p) => {
    const def = defOf(p);
    if (!def) return [];
    const strip = (h: string) => {
      const { row, col } = parseHole(h);
      return `${row}${halfOf(col)[0]}`;
    };
    const vcc = def.legs.find((l) => l.kind === "power_in" && p.legs[l.id]);
    const data = def.legs.filter((l) => (l.kind === "digital_out" || l.kind === "digital_in") && p.legs[l.id]);
    if (!vcc) return [];
    return b.parts
      .filter((r) => r.type === "resistor")
      .filter((r) => {
        const s = Object.values(r.legs).map(strip);
        return s.includes(strip(p.legs[vcc.id]!)) && data.some((d) => s.includes(strip(p.legs[d.id]!)));
      })
      .map((r) => {
        const n = clone(b);
        n.parts = n.parts.filter((x) => x.ref !== r.ref);
        return { build: n, expect: ["W012"], what: `${p.ref}'s pull-up ${r.ref} removed` };
      });
  });

export const BREAKERS: Record<string, Breaker> = { bypassResistor, tinyResistor, ledBackwards, oneStrip, gpioToRail, joinOutputs, supplyReversed, supplyFrom5V, groundRemoved, pullUpRemoved };
