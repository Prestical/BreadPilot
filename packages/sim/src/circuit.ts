// BreadPilot behaviour simulator: the circuit as the simulator sees it (M18 18.7c).
// Built from circuit-core's netlist of ANY Build, engine-made or wired by hand in the sandbox (M6):
// never from the layout engine's templates or block names. The result is plain data, so the worker
// thread (and later a browser Web Worker) can evaluate it with solver.mjs.
//
// Nodes are the nets with every switch open; a closed switch joins two of them. Facts come from the
// parts' packs (resistor ohms, LED forward voltage, module outputs and active levels) and the board
// (supply voltages, input thresholds and pull resistors from the RP2350 datasheet).

import { buildNets, resolveBuild, type Build, type ResolvedPart } from "@breadpilot/circuit-core";

export interface ElectricalModel {
  /** Number of base nets (all switches open). */
  nodes: number;
  /** Switch elements: closed, they join nodes a and b. `id` is "<ref>#<element index>". */
  switches: { id: string; ref: string; a: number; b: number; group?: string }[];
  resistors: { ref: string; a: number; b: number; ohms: number }[];
  /** Knobs: end1 —((1 − position) × ohms)— wiper —(position × ohms)— end2 (position 1 = wiper at end1). */
  pots: { ref: string; end1: number; wiper: number; end2: number; ohms: number }[];
  /** Resistors whose value depends on what they sense (light for an LDR, temperature for an NTC). */
  sensorResistors: ({ ref: string; a: number; b: number } & ({ kind: "ldr"; ohmsAt10Lux: number; gamma: number } | { kind: "ntc"; ohmsAt25C: number; betaK: number }))[];
  leds: { ref: string; anode: number; cathode: number; vf: number }[];
  /** Fixed voltages: power and ground pins. */
  supplies: { node: number; volts: number; pin: string }[];
  /** Header GPIOs and their node. */
  gpios: { gpio: number; node: number }[];
  /** Module outputs: drive their node to the module's supply (or 0) by what the module senses. */
  drivers: { ref: string; node: number; supplyNode: number; kind: "digital" | "analog"; activeLow: boolean; levelKnown: boolean }[];
  /** Module inputs that switch something on (a buzzer, a motor), by their pin level. */
  actuators: { ref: string; node: number; name: string; activeLow: boolean }[];
  /** I2C chips: answer at `address` on the bus whose SDA/SCL reach their legs (18.7d). */
  i2c: { ref: string; type: string; sda: number; scl: number; supply: number; address: number }[];
  /** One-wire sensors (DHT11/22, DS18B20): their data line and supply (18.7d). */
  oneWire: { ref: string; type: string; data: number; supply: number }[];
  /** Input thresholds and pull resistors (board facts). */
  inputHighMinV: number;
  inputLowMaxV: number;
  pullUpOhms: number;
  pullDownOhms: number;
}

/** The middle of a [min, max] range on a log scale (resistances spread by factors, not by ohms). */
const middle = ([lo, hi]: [number, number]) => Math.round(Math.sqrt(lo * hi));

/** GL5528-type LDR curve exponent: R ∝ lux^-γ. A typical value for CdS cells (no datasheet in docs/ yet). */
const LDR_GAMMA = 0.7;

export function electricalModel(build: Build): ElectricalModel {
  const { resolved, issues } = resolveBuild(build);
  if (!resolved) throw new Error(`The build can't be read: ${issues[0]?.message ?? "unknown error"}`);
  const nets = buildNets(resolved, new Set());
  const index = new Map(nets.all.map((n, i) => [n.id, i]));
  const legNode = (part: ResolvedPart, leg: string) => index.get(nets.legNet(part, leg).id)!;
  const pinNode = (phys: number) => index.get(nets.pinNet(phys).id)!;
  const g = resolved.board.electrical.gpioCurrent!;
  const has = (part: ResolvedPart, leg: string) => part.legs[leg] !== undefined;

  const model: ElectricalModel = {
    nodes: nets.all.length,
    switches: [],
    resistors: [],
    pots: [],
    sensorResistors: [],
    leds: [],
    supplies: [],
    gpios: [],
    drivers: [],
    actuators: [],
    i2c: [],
    oneWire: [],
    inputHighMinV: g.inputHighMinV,
    inputLowMaxV: g.inputLowMaxV,
    pullUpOhms: middle(g.pullUpOhms),
    pullDownOhms: middle(g.pullDownOhms),
  };

  for (const pin of resolved.board.pins) {
    if (pin.type === "ground") model.supplies.push({ node: pinNode(pin.phys), volts: 0, pin: pin.name });
    else if (pin.type === "power" && typeof pin.voltage === "number") model.supplies.push({ node: pinNode(pin.phys), volts: pin.voltage, pin: pin.name });
    else if (pin.type === "gpio" && pin.gpio !== undefined) model.gpios.push({ gpio: pin.gpio, node: pinNode(pin.phys) });
  }

  for (const part of resolved.parts) {
    const specs = (part.def.specs ?? {}) as Record<string, unknown>;
    const kindOf = part.def.id;
    // Elements.
    const resistors = part.def.elements.map((el, i) => ({ el, i })).filter(({ el }) => el.kind === "resistor" && has(part, el.a) && has(part, el.b));
    if (part.def.legs.some((l) => l.id === "wiper") && resistors.length === 2) {
      model.pots.push({ ref: part.ref, end1: legNode(part, "end1"), wiper: legNode(part, "wiper"), end2: legNode(part, "end2"), ohms: Number(part.props.ohms) || 10000 });
    } else {
      for (const { el } of resistors) {
        const a = legNode(part, el.a);
        const b = legNode(part, el.b);
        if (typeof specs.resistanceAt10LuxOhms !== "undefined") {
          const r10 = specs.resistanceAt10LuxOhms as number | [number, number];
          model.sensorResistors.push({ ref: part.ref, a, b, kind: "ldr", ohmsAt10Lux: Array.isArray(r10) ? middle(r10) : r10, gamma: LDR_GAMMA });
        } else if (typeof specs.resistanceAt25COhms === "number" && typeof specs.betaK === "number") {
          model.sensorResistors.push({ ref: part.ref, a, b, kind: "ntc", ohmsAt25C: specs.resistanceAt25COhms, betaK: specs.betaK });
        } else {
          model.resistors.push({ ref: part.ref, a, b, ohms: Number(part.props.ohms) || 0 });
        }
      }
    }
    part.def.elements.forEach((el, i) => {
      if (!has(part, el.a) || !has(part, el.b)) return;
      if (el.kind === "switch") model.switches.push({ id: `${part.ref}#${i}`, ref: part.ref, a: legNode(part, el.a), b: legNode(part, el.b), ...(el.group ? { group: el.group } : {}) });
      if (el.kind === "led") {
        const table = (specs.forwardVoltage ?? {}) as Record<string, number>;
        model.leds.push({ ref: part.ref, anode: legNode(part, el.a), cathode: legNode(part, el.b), vf: table[String(part.props.color)] ?? 1.8 });
      }
    });
    const level = typeof specs.activeLevel === "string" ? specs.activeLevel.toLowerCase() : undefined;
    const supply = part.def.legs.find((l) => l.kind === "power_in" && has(part, l.id));
    // Chips that talk: I2C (address from the pack: the module's usual one, the first listed) and
    // one-wire data lines (the legs that need a pull-up).
    const sda = part.def.legs.find((l) => l.kind === "i2c_sda" && has(part, l.id));
    const scl = part.def.legs.find((l) => l.kind === "i2c_scl" && has(part, l.id));
    if (sda && scl && supply) {
      const list = (specs.i2cAddresses ?? (specs.i2cAddress !== undefined ? [specs.i2cAddress] : [])) as number[];
      if (list.length) model.i2c.push({ ref: part.ref, type: part.def.id, sda: legNode(part, sda.id), scl: legNode(part, scl.id), supply: legNode(part, supply.id), address: list[0]! });
    }
    const data = part.def.legs.find((l) => l.needsPullUp && has(part, l.id));
    if (data && supply) model.oneWire.push({ ref: part.ref, type: part.def.id, data: legNode(part, data.id), supply: legNode(part, supply.id) });
    // Module legs: outputs that follow what the module senses, inputs that switch it on.
    for (const leg of part.def.legs.filter((l) => has(part, l.id))) {
      // One-wire data lines (DHT, DS18B20) talk a protocol; they are simulated in 18.7d, not as a level.
      if (leg.needsPullUp) continue;
      if ((leg.kind === "digital_out" || leg.kind === "analog_out") && supply && (leg.level === "vcc" || part.def.elements.some((e) => e.kind === "load"))) {
        // Modules only: an LDR/NTC/knob's analog_out is a node of the resistor network, not a source.
        if (!part.def.elements.some((e) => e.kind === "load")) continue;
        model.drivers.push({
          ref: part.ref,
          node: legNode(part, leg.id),
          supplyNode: legNode(part, supply.id),
          kind: leg.kind === "digital_out" ? "digital" : "analog",
          activeLow: level?.startsWith("low") ?? false,
          levelKnown: level !== undefined,
        });
      }
      if (leg.kind === "digital_in") {
        model.actuators.push({ ref: part.ref, node: legNode(part, leg.id), name: kindOf, activeLow: leg.activeLow === true || (level?.startsWith("low") ?? false) });
      }
    }
  }
  return model;
}
