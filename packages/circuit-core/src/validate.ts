// Safety validator. Every rule here has golden tests in
// test/validate.test.ts. Messages are written for beginners.
//
// Switches (buttons) are checked in every position: a circuit that is only
// shorted while a button is pressed is still a short.

import { pinByGpio } from "./board";
import { buildNets, partElements, type Net, type Nets, type PartElement } from "./netlist";
import { legLabel, resolveBuild, type Resolved, type ResolvedPart } from "./resolve";
import type { BoardPin, Build, GpioMode, Issue, ValidationReport } from "./types";

const MAX_EXHAUSTIVE_SWITCHES = 8;

const INPUT_MODES: ReadonlySet<GpioMode> = new Set(["in", "in_pullup", "in_pulldown", "adc"]);
/** Modes where the Pico actively drives the pin (an output in electrical terms). */
export function isDriven(mode: GpioMode | undefined): boolean {
  if (!mode || INPUT_MODES.has(mode)) return false;
  return !/^(spi\d_rx|uart\d_rx)$/.test(mode);
}

const pinText = (p: BoardPin) => `${p.name} (pin ${p.phys})`;
const isPower = (p: BoardPin) => p.type === "power";
const isGround = (p: BoardPin) => p.type === "ground";
const isGpio = (p: BoardPin) => p.type === "gpio";

interface SwitchState {
  closed: Set<string>;
  /** "" for all buttons released, else e.g. "when BTN1 is pressed". */
  when: string;
}

function switchStates(elements: PartElement[]): SwitchState[] {
  const switches = elements.filter((e) => e.el.kind === "switch");
  const describe = (closed: PartElement[]) => {
    if (closed.length === 0) return "";
    const refs = [...new Set(closed.map((s) => s.part.ref))];
    return `when ${refs.join(" and ")} ${refs.length > 1 ? "are" : "is"} pressed`;
  };
  const subsets: PartElement[][] = [];
  if (switches.length <= MAX_EXHAUSTIVE_SWITCHES) {
    for (let mask = 0; mask < 1 << switches.length; mask++) subsets.push(switches.filter((_, i) => mask & (1 << i)));
  } else {
    subsets.push([], switches, ...switches.map((s) => [s]));
  }
  return subsets.map((s) => ({ closed: new Set(s.map((x) => x.id)), when: describe(s) }));
}

class IssueList {
  private byKey = new Map<string, Issue>();
  add(issue: Issue) {
    const key = `${issue.code}|${issue.message}`;
    const existing = this.byKey.get(key);
    if (!existing) this.byKey.set(key, issue);
    else if (existing.when && !issue.when) delete existing.when; // happens with buttons released too → always
  }
  addAll(issues: Issue[]) {
    issues.forEach((i) => this.add(i));
  }
  list(): Issue[] {
    return [...this.byKey.values()];
  }
}

export function validateBuild(build: Build): ValidationReport {
  const out = new IssueList();
  const { resolved, issues } = resolveBuild(build);
  out.addAll(issues);
  if (resolved) {
    checkModes(resolved, build, out);
    checkCircuit(resolved, build, out);
  }
  const list = out.list().sort((a, b) => (a.severity === b.severity ? a.code.localeCompare(b.code) : a.severity === "error" ? -1 : 1));
  const errors = list.filter((i) => i.severity === "error").length;
  return { ok: errors === 0, errors, warnings: list.length - errors, issues: list };
}

// ---------- GPIO mode declarations: E006, E008, E009, E010 ----------
function checkModes(resolved: Resolved, build: Build, out: IssueList) {
  const { board } = resolved;
  const buses = new Map<string, Set<string>>();
  for (const [name, mode] of Object.entries(build.gpioModes)) {
    const internal = board.internalGpio.find((g) => g.name === name);
    if (internal) {
      out.add({ code: "E010", severity: "error", message: `${name} is used inside the Pico 2 W (${internal.use}) and isn't on any pin. Pick another GPIO.`, pins: [name] });
      continue;
    }
    const pin = pinByGpio(board, name);
    if (!pin) {
      out.add({ code: "E006", severity: "error", message: `"${name}" isn't a GPIO on the Pico 2 W (use GP0-GP22 or GP26-GP28).`, pins: [name] });
      continue;
    }
    if (mode === "adc" && pin.adc === undefined) {
      out.add({ code: "E008", severity: "error", message: `${pinText(pin)} can't read analog values. Only GP26, GP27 and GP28 have an ADC.`, pins: [name] });
    }
    const bus = /^(i2c|spi|uart)(\d)_(\w+)$/.exec(mode);
    if (bus) {
      const fn = `${bus[1]!.toUpperCase()}${bus[2]}_${bus[3]!.toUpperCase()}`;
      if (!pin.functions?.includes(fn)) {
        const ok = board.pins.filter((p) => p.functions?.includes(fn)).map((p) => p.name);
        out.add({ code: "E009", severity: "error", message: `${pinText(pin)} can't be ${fn}. Pins that can: ${ok.join(", ")}.`, pins: [name] });
      }
      const key = `${bus[1]}${bus[2]}`;
      if (!buses.has(key)) buses.set(key, new Set());
      buses.get(key)!.add(bus[3]!);
    }
  }
  for (const [key, signals] of buses) {
    const label = key.toUpperCase();
    if (key.startsWith("i2c") && !(signals.has("sda") && signals.has("scl"))) {
      out.add({ code: "E009", severity: "error", message: `${label} needs both an SDA and an SCL pin.` });
    }
    if (key.startsWith("spi") && !signals.has("sck")) {
      out.add({ code: "E009", severity: "error", message: `${label} needs an SCK (clock) pin.` });
    }
  }
}

// ---------- Electrical checks ----------
interface LedFacts {
  forward: boolean;
  backward: boolean;
  inputSourcedBy?: BoardPin;
  resistorFree: boolean;
}

function checkCircuit(resolved: Resolved, build: Build, out: IssueList) {
  const elements = partElements(resolved);
  const modeOf = (p: BoardPin) => build.gpioModes[p.name];
  const leds = elements.filter((e) => e.el.kind === "led");
  const ledFacts = new Map<string, LedFacts[]>(leds.map((l) => [l.id, []]));
  let worstLoad3v3 = 0;

  for (const state of switchStates(elements)) {
    const nets = buildNets(resolved, state.closed);
    const when = state.when ? { when: state.when } : {};
    const allReleased = state.when === "";

    for (const net of nets.all) checkNet(net, nets, resolved, modeOf, allReleased, when, out);
    if (allReleased) checkReleasedOnly(nets, resolved, elements, modeOf, out);

    for (const led of leds) ledFacts.get(led.id)!.push(analyzeLed(led, nets, elements, modeOf));
    worstLoad3v3 = Math.max(worstLoad3v3, load3v3(nets, elements));
  }

  // LEDs: aggregate over all switch positions.
  for (const led of leds) {
    const facts = ledFacts.get(led.id)!;
    const ref = led.part.ref;
    const anode = led.part.def.legs.find((l) => l.id === led.el.a)!;
    if (facts.some((f) => f.resistorFree)) {
      out.add({ code: "E004", severity: "error", message: `${ref} has no resistor in its path. Without one, too much current flows and the LED (or the Pico pin) can burn out. Add a 220-330 Ω resistor in series.`, parts: [ref] });
    }
    const input = facts.find((f) => f.inputSourcedBy)?.inputSourcedBy;
    if (input && !facts.some((f) => f.forward)) {
      out.add({ code: "E011", severity: "error", message: `${pinText(input)} is set as an input, but it's the pin that would light ${ref}. Set it to "out".`, parts: [ref], pins: [input.name] });
    } else if (!facts.some((f) => f.forward)) {
      if (facts.some((f) => f.backward)) {
        out.add({ code: "W009", severity: "warning", message: `${ref} is in backwards, so it won't light. Turn it around: the ${anode.label} goes toward the pin, the other leg toward GND.`, parts: [ref] });
      } else {
        out.add({ code: "W008", severity: "warning", message: `${ref} isn't part of a complete circuit, so it will never light. It needs a path from a pin, through a resistor and the LED, to GND.`, parts: [ref] });
      }
    }
  }

  const threeV3 = resolved.board.pins.find((p) => p.type === "power" && p.voltage === 3.3);
  if (threeV3?.maxLoadMa && worstLoad3v3 > threeV3.maxLoadMa) {
    out.add({ code: "W001", severity: "warning", message: `Parts on the 3V3 pin draw about ${worstLoad3v3} mA, more than the ${threeV3.maxLoadMa} mA the datasheet recommends. Power big loads from a separate supply.`, pins: [threeV3.name] });
  }
}

function checkNet(
  net: Net,
  nets: Nets,
  resolved: Resolved,
  modeOf: (p: BoardPin) => GpioMode | undefined,
  allReleased: boolean,
  when: { when?: string },
  out: IssueList,
) {
  const powers = net.pins.filter(isPower);
  const grounds = net.pins.filter(isGround);
  const gpios = net.pins.filter(isGpio);
  const pinNames = net.pins.map((p) => p.name);

  // E001: power straight to ground.
  if (powers.length && grounds.length) {
    out.add({ code: "E001", severity: "error", message: `Short circuit: ${pinText(powers[0]!)} is connected straight to ${pinText(grounds[0]!)}. This can damage the Pico or your USB port.`, pins: pinNames, wires: net.wires, ...when });
  }
  // E002 / W007: two supplies joined.
  const has = (n: string) => powers.find((p) => p.name === n);
  const threeV3 = has("3V3");
  const higher = has("VBUS") ?? has("VSYS");
  if (threeV3 && higher) {
    out.add({ code: "E002", severity: "error", message: `${pinText(threeV3)} is connected to ${pinText(higher)}. These are different voltages (3.3 V and ~5 V) and must never be joined.`, pins: pinNames, wires: net.wires, ...when });
  }
  const vbus = has("VBUS");
  const vsys = has("VSYS");
  if (vbus && vsys) {
    out.add({ code: "W007", severity: "warning", message: `${pinText(vbus)} is joined to ${pinText(vsys)}. The datasheet allows this only when USB is the only power source.`, pins: pinNames, wires: net.wires, ...when });
  }

  // E003: GPIO tied directly to a supply, ground, or another output.
  const driven = gpios.filter((p) => isDriven(modeOf(p)));
  const rail = powers[0] ?? grounds[0];
  if (rail) {
    const tied = allReleased ? gpios : driven;
    for (const g of tied) {
      const why = isDriven(modeOf(g))
        ? `When the code drives it the other way, it shorts.`
        : `It can never change, and it shorts if the code ever makes it an output.`;
      out.add({ code: "E003", severity: "error", message: `${pinText(g)} is connected straight to ${pinText(rail)} with nothing in between. ${why}`, pins: [g.name, rail.name], wires: net.wires, ...when });
    }
  }
  if (driven.length >= 2) {
    out.add({ code: "E003", severity: "error", message: `${driven.map(pinText).join(" and ")} are both outputs and connected together. If one goes HIGH and the other LOW, they short.`, pins: driven.map((p) => p.name), wires: net.wires, ...when });
  }

  // E007: more than 3.3 V into a GPIO.
  if (gpios.length) {
    const fiveV = powers.find((p) => (p.voltage ?? 0) > resolved.board.electrical.adcPinMaxInputVoltage);
    const highOutput = net.legs.find(
      (l) => (l.leg.kind === "digital_out" || l.leg.kind === "i2c_sda" || l.leg.kind === "i2c_scl") && l.leg.level === "vcc" && partSupplyVoltage(l.part, nets) > resolved.board.electrical.adcPinMaxInputVoltage,
    );
    for (const g of gpios) {
      if (fiveV) {
        out.add({ code: "E007", severity: "error", message: `${pinText(g)} is connected to ${pinText(fiveV)} (~5 V). Pico GPIOs work at 3.3 V; 5 V can damage them.`, pins: [g.name, fiveV.name], wires: net.wires, ...when });
      }
      if (highOutput) {
        const v = partSupplyVoltage(highOutput.part, nets);
        const message =
          highOutput.leg.kind === "digital_out"
            ? `${legLabel(highOutput.part, highOutput.leg)} outputs ~${v} V into ${pinText(g)}. Pico GPIOs work at 3.3 V: add a voltage divider (e.g. 1 kΩ + 2 kΩ) or a level shifter.`
            : `${legLabel(highOutput.part, highOutput.leg)} can be pulled up to the module's ~${v} V supply, and it's wired to ${pinText(g)}. Pico GPIOs work at 3.3 V: power ${highOutput.part.ref} from 3V3 (pin 36).`;
        out.add({ code: "E007", severity: "error", message, pins: [g.name], parts: [highOutput.part.ref], ...when });
      }
    }
  }

  // W005: RUN / 3V3_EN to ground.
  if (grounds.length) {
    for (const c of net.pins.filter((p) => p.type === "control")) {
      const effect = c.name === "RUN" ? "holds the Pico in reset (it stops running)" : "turns off the Pico's 3.3 V supply";
      out.add({ code: "W005", severity: "warning", message: `${pinText(c)} is connected to GND, which ${effect}.`, pins: [c.name], ...when });
    }
  }
  // W006: anything on ADC_VREF.
  const vref = net.pins.find((p) => p.type === "reference");
  if (vref && (net.wires.length || net.legs.length || net.pins.length > 1)) {
    out.add({ code: "W006", severity: "warning", message: `${pinText(vref)} is the ADC's reference voltage. Only connect an external voltage reference here; use 3V3 (pin 36) to power parts.`, pins: [vref.name] });
  }

  // E008: analog output (e.g. potentiometer wiper) into a non-ADC GPIO.
  for (const l of net.legs.filter((l) => l.leg.kind === "analog_out")) {
    for (const g of gpios) {
      if (modeOf(g) === "adc" && g.adc !== undefined) continue;
      const reason = g.adc === undefined ? `${pinText(g)} can't read analog values; use GP26, GP27 or GP28` : `set ${g.name} to "adc" mode`;
      out.add({ code: "E008", severity: "error", message: `${legLabel(l.part, l.leg)} gives an analog voltage, but ${reason}.`, pins: [g.name], parts: [l.part.ref] });
    }
  }

  // W002: high-current parts straight on a GPIO.
  for (const l of net.legs.filter((l) => l.leg.highCurrent)) {
    for (const g of gpios) {
      out.add({ code: "W002", severity: "warning", message: `${l.part.def.name} ${l.part.ref} is driven straight from ${pinText(g)}. A GPIO can't supply enough current: use a transistor or motor driver.`, pins: [g.name], parts: [l.part.ref] });
    }
  }
}

/** Checks that only make sense with all buttons released (wiring as built). */
function checkReleasedOnly(
  nets: Nets,
  resolved: Resolved,
  elements: PartElement[],
  modeOf: (p: BoardPin) => GpioMode | undefined,
  out: IssueList,
) {
  // E005: both ends of an element in the same strip/net → part does nothing (or is always "pressed").
  for (const pe of elements) {
    if (pe.el.kind === "short") continue;
    if (!pe.part.legs[pe.el.a] || !pe.part.legs[pe.el.b]) continue;
    if (nets.legNet(pe.part, pe.el.a).id !== nets.legNet(pe.part, pe.el.b).id) continue;
    const a = pe.part.def.legs.find((l) => l.id === pe.el.a)!;
    const b = pe.part.def.legs.find((l) => l.id === pe.el.b)!;
    const message =
      pe.el.kind === "switch"
        ? `${pe.part.ref} acts as if it's always pressed: its ${a.label} and ${b.label} are connected through the breadboard. Turn the button 90° so it straddles the center channel.`
        : `${pe.part.ref} is shorted out: its ${a.label} and ${b.label} are in the same connected strip, so current skips the part. Move one leg to another row.`;
    out.add({ code: "E005", severity: "error", message, parts: [pe.part.ref] });
  }

  // E012: GPIO used without a declared mode.
  for (const pin of resolved.board.pins.filter(isGpio)) {
    const net = nets.pinNet(pin.phys);
    const used = net.wires.length > 0 || net.legs.length > 0;
    if (used && !modeOf(pin)) {
      out.add({ code: "E012", severity: "error", message: `${pinText(pin)} is connected, but it isn't set as an input or output. Declare its mode (e.g. "out" for an LED, "in_pullup" for a button).`, pins: [pin.name] });
    }
  }

  // W003: floating or pointless inputs.
  for (const pin of resolved.board.pins.filter(isGpio)) {
    const mode = modeOf(pin);
    if (mode !== "in") continue;
    const net = nets.pinNet(pin.phys);
    if (!net.wires.length && !net.legs.length) continue;
    const reaches = (pred: (n: Net) => boolean) => reachable(nets, elements, net, pred, ["resistor", "load"]);
    const anchored = reaches((n) => n.pins.some((p) => isPower(p) || isGround(p) || (isGpio(p) && isDriven(modeOf(p))))) || net.legs.some((l) => l.leg.kind === "digital_out");
    if (!anchored) {
      out.add({ code: "W003", severity: "warning", message: `${pinText(pin)} is an input with nothing pulling it HIGH or LOW, so it will read random values while the button is released. Use "in_pullup" (button to GND) or "in_pulldown" (button to 3V3).`, pins: [pin.name] });
    }
  }
  pullDirectionCheck(resolved, elements, modeOf, out);
  checkI2cLegs(resolved, nets, modeOf, out);

  // W010 / W008: supply legs of parts.
  for (const part of resolved.parts) {
    for (const leg of part.def.legs.filter((l) => l.kind === "power_in" && part.legs[l.id])) {
      const v = partSupplyVoltage(part, nets);
      if (leg.maxSafeVoltage !== undefined && v > leg.maxSafeVoltage) {
        out.add({ code: "E014", severity: "error", message: `${legLabel(part, leg)} gets ~${v} V. Power ${part.ref} from 3V3 (pin 36) instead: at ${v} V its data lines may carry ${v} V into the Pico's 3.3 V GPIOs.`, parts: [part.ref] });
      } else if (v === 0) {
        out.add({ code: "W008", severity: "warning", message: `${legLabel(part, leg)} isn't connected to a power pin, so ${part.ref} won't work.`, parts: [part.ref] });
      } else if (leg.voltageRange && (v < leg.voltageRange[0] || v > leg.voltageRange[1])) {
        out.add({ code: "W010", severity: "warning", message: `${part.ref} needs ${leg.voltageRange[0]}-${leg.voltageRange[1]} V on ${leg.label}, but it gets ~${v} V.`, parts: [part.ref] });
      }
    }
    // Completely unconnected parts.
    const connected = Object.keys(part.legs).some((legId) => {
      const net = nets.legNet(part, legId);
      return net.pins.length > 0 || net.wires.length > 0 || net.legs.some((l) => l.part.ref !== part.ref);
    });
    if (!connected && part.def.elements.every((e) => e.kind !== "led")) {
      out.add({ code: "W008", severity: "warning", message: `${part.ref} isn't connected to anything yet.`, parts: [part.ref] });
    }
  }
}

/**
 * E015: a part's I2C lines must reach a Pico pin set to the matching I2C signal, SDA and SCL on
 * the same bus (I2C0 or I2C1). Catches swapped SDA/SCL, unconnected lines, plain GPIO modes and
 * lines split across buses.
 */
function checkI2cLegs(resolved: Resolved, nets: Nets, modeOf: (p: BoardPin) => GpioMode | undefined, out: IssueList) {
  for (const part of resolved.parts) {
    const lines = part.def.legs.filter((l) => (l.kind === "i2c_sda" || l.kind === "i2c_scl") && part.legs[l.id]);
    if (!lines.length) continue;
    const buses = new Set<string>();
    for (const leg of lines) {
      const signal = leg.kind === "i2c_sda" ? "sda" : "scl";
      const gpios = nets.legNet(part, leg.id).pins.filter(isGpio);
      if (!gpios.length) {
        out.add({ code: "E015", severity: "error", message: `${legLabel(part, leg)} isn't wired to a Pico pin. Connect it to an I2C ${signal.toUpperCase()} pin (e.g. ${signal === "sda" ? "GP16 (pin 21)" : "GP17 (pin 22)"}).`, parts: [part.ref] });
        continue;
      }
      for (const g of gpios) {
        const mode = modeOf(g) ?? "";
        const m = /^i2c(\d)_(sda|scl)$/.exec(mode);
        if (!m) {
          out.add({ code: "E015", severity: "error", message: `${legLabel(part, leg)} goes to ${pinText(g)}, which isn't set up as I2C ${signal.toUpperCase()}. Set its mode to "i2c0_${signal}" or "i2c1_${signal}" (whichever bus the pin supports).`, pins: [g.name], parts: [part.ref] });
        } else if (m[2] !== signal) {
          out.add({ code: "E015", severity: "error", message: `${legLabel(part, leg)} goes to ${pinText(g)}, which is the I2C ${m[2]!.toUpperCase()} line: SDA and SCL are swapped.`, pins: [g.name], parts: [part.ref] });
        } else buses.add(m[1]!);
      }
    }
    if (buses.size > 1) {
      out.add({ code: "E015", severity: "error", message: `${part.ref}'s SDA and SCL are on different I2C buses (I2C${[...buses].sort().join(" and I2C")}). Use an SDA and SCL pair from the same bus.`, parts: [part.ref] });
    }
  }
}

/** W003 (pull direction): pull-up with a button to 3V3 always reads 1; pull-down with a button to GND always reads 0. */
function pullDirectionCheck(resolved: Resolved, elements: PartElement[], modeOf: (p: BoardPin) => GpioMode | undefined, out: IssueList) {
  for (const sw of elements.filter((e) => e.el.kind === "switch")) {
    const nets = buildNets(resolved, new Set([sw.id]));
    for (const pin of resolved.board.pins.filter(isGpio)) {
      const mode = modeOf(pin);
      if (mode !== "in_pullup" && mode !== "in_pulldown") continue;
      const net = nets.pinNet(pin.phys);
      if (!net.legs.some((l) => l.part.ref === sw.part.ref)) continue;
      const toPower = net.pins.some(isPower);
      const toGround = net.pins.some(isGround);
      if (mode === "in_pullup" && toPower && !toGround) {
        out.add({ code: "W003", severity: "warning", message: `${pinText(pin)} uses a pull-up, but ${sw.part.ref} connects it to 3V3, so it always reads 1. Wire the button to GND instead (or use "in_pulldown").`, pins: [pin.name], parts: [sw.part.ref] });
      }
      if (mode === "in_pulldown" && toGround && !toPower) {
        out.add({ code: "W003", severity: "warning", message: `${pinText(pin)} uses a pull-down, but ${sw.part.ref} connects it to GND, so it always reads 0. Wire the button to 3V3 instead (or use "in_pullup").`, pins: [pin.name], parts: [sw.part.ref] });
      }
    }
  }
}

// ---------- helpers ----------

/** Highest supply voltage on any power_in leg of the part (0 if unpowered). */
function partSupplyVoltage(part: ResolvedPart, nets: Nets): number {
  let v = 0;
  for (const leg of part.def.legs.filter((l) => l.kind === "power_in" && part.legs[l.id])) {
    for (const p of nets.legNet(part, leg.id).pins) if (isPower(p)) v = Math.max(v, p.voltage ?? 0);
  }
  return v;
}

/** BFS over nets through elements of the given kinds (both directions). */
function reachable(
  nets: Nets,
  elements: PartElement[],
  start: Net,
  pred: (n: Net) => boolean,
  through: string[],
  exclude?: string,
): boolean {
  const seen = new Set([start.id]);
  const queue = [start];
  while (queue.length) {
    const net = queue.shift()!;
    if (pred(net)) return true;
    for (const pe of elements) {
      if (pe.id === exclude || !through.includes(pe.el.kind)) continue;
      if (!pe.part.legs[pe.el.a] || !pe.part.legs[pe.el.b]) continue;
      const a = nets.legNet(pe.part, pe.el.a);
      const b = nets.legNet(pe.part, pe.el.b);
      const next = a.id === net.id ? b : b.id === net.id ? a : null;
      if (next && !seen.has(next.id)) {
        seen.add(next.id);
        queue.push(next);
      }
    }
  }
  return false;
}

function analyzeLed(led: PartElement, nets: Nets, elements: PartElement[], modeOf: (p: BoardPin) => GpioMode | undefined): LedFacts {
  const facts: LedFacts = { forward: false, backward: false, resistorFree: false };
  if (!led.part.legs[led.el.a] || !led.part.legs[led.el.b]) return facts;
  const anode = nets.legNet(led.part, led.el.a);
  const cathode = nets.legNet(led.part, led.el.b);
  if (anode.id === cathode.id) return facts; // E005 covers it

  const isSource = (n: Net) => n.pins.some((p) => isPower(p) || (isGpio(p) && isDriven(modeOf(p))));
  const isSink = (n: Net) => n.pins.some((p) => isGround(p) || (isGpio(p) && isDriven(modeOf(p))));
  const ledEdges = elements.filter((e) => e.el.kind === "led" && e.id !== led.id && e.part.legs[e.el.a] && e.part.legs[e.el.b]);
  const resistive = elements.filter((e) => (e.el.kind === "resistor" || e.el.kind === "load") && e.part.legs[e.el.a] && e.part.legs[e.el.b]);

  // Walks toward a source ("up": against current flow) or a sink ("down"). Resistive parts
  // conduct both ways; other LEDs only in their forward direction. With resistive=false only
  // LEDs are followed (used to find paths with no resistor at all).
  const walk = (start: Net, dir: "up" | "down", pred: (n: Net) => boolean, withResistive = true) => {
    const seen = new Set([start.id]);
    const queue = [start];
    while (queue.length) {
      const n = queue.shift()!;
      if (pred(n)) return true;
      const step = (to: Net) => {
        if (!seen.has(to.id)) {
          seen.add(to.id);
          queue.push(to);
        }
      };
      if (withResistive) {
        for (const e of resistive) {
          const a = nets.legNet(e.part, e.el.a);
          const b = nets.legNet(e.part, e.el.b);
          if (a.id === n.id) step(b);
          else if (b.id === n.id) step(a);
        }
      }
      for (const e of ledEdges) {
        const a = nets.legNet(e.part, e.el.a);
        const b = nets.legNet(e.part, e.el.b);
        if (dir === "down" && a.id === n.id) step(b);
        if (dir === "up" && b.id === n.id) step(a);
      }
    }
    return false;
  };

  facts.forward = walk(anode, "up", isSource) && walk(cathode, "down", isSink);
  facts.backward = walk(cathode, "up", isSource) && walk(anode, "down", isSink);
  if (!facts.forward && walk(cathode, "down", isSink)) {
    let found: BoardPin | undefined;
    walk(anode, "up", (n) => {
      found = n.pins.find((p) => isGpio(p) && INPUT_MODES.has(modeOf(p)!));
      return !!found;
    });
    if (found) facts.inputSourcedBy = found;
  }
  facts.resistorFree = walk(anode, "up", isSource, false) && walk(cathode, "down", isSink, false);
  return facts;
}
/** Current drawn from the 3V3 pin by parts with a known load. */
function load3v3(nets: Nets, elements: PartElement[]): number {
  let total = 0;
  for (const pe of elements) {
    if (pe.el.kind !== "load" || !pe.el.currentMa) continue;
    if (!pe.part.legs[pe.el.a] || !pe.part.legs[pe.el.b]) continue;
    const a = nets.legNet(pe.part, pe.el.a);
    const b = nets.legNet(pe.part, pe.el.b);
    const on3v3 = (n: Net) => n.pins.some((p) => p.type === "power" && p.voltage === 3.3);
    const onGnd = (n: Net) => n.pins.some(isGround);
    if ((on3v3(a) && onGnd(b)) || (on3v3(b) && onGnd(a))) total += pe.el.currentMa;
  }
  return total;
}
