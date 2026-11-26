// Safety validator. Every rule here has golden tests in
// test/validate.test.ts. Messages are written for beginners.
//
// Switches (buttons) are checked in every position: a circuit that is only
// shorted while a button is pressed is still a short. Above MAX_EXHAUSTIVE_SWITCHES
// contacts the net checks stay complete (see switchStates); the LED path checks then
// see none, one, two or the largest sets of pressed switches.

import { pinByGpio } from "./board";
import { buildNets, partElements, type Net, type Nets, type PartElement } from "./netlist";
import { legLabel, resolveBuild, type Resolved, type ResolvedPart } from "./resolve";
import { formatOhms } from "./units";
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
    // A contact that says how it closes ("slid toward outer leg 1") is described that way.
    const how = closed.filter((s) => s.el.closed).map((s) => `${s.part.ref} is ${s.el.closed}`);
    const refs = [...new Set(closed.filter((s) => !s.el.closed).map((s) => s.part.ref))];
    const pressed = refs.length ? [`${refs.join(" and ")} ${refs.length > 1 ? "are" : "is"} pressed`] : [];
    return `when ${[...pressed, ...how].join(" and ")}`;
  };
  // Contacts of one switch in the same group are never closed together (a slide switch's two sides).
  const possible = (s: PartElement[]) => {
    const groups = s.filter((x) => x.el.group).map((x) => `${x.part.ref}#${x.el.group}`);
    return new Set(groups).size === groups.length;
  };
  const subsets: PartElement[][] = [];
  if (switches.length <= MAX_EXHAUSTIVE_SWITCHES) {
    for (let mask = 0; mask < 1 << switches.length; mask++) subsets.push(switches.filter((_, i) => mask & (1 << i)));
  } else {
    // Too many for every combination. Closing a switch only joins nets, so whatever a net check
    // finds (shorts, 5 V into a GPIO, two outputs joined) is still there with more switches
    // closed: the largest possible states cover every combination for those checks. Smaller
    // states come first so a message names the fewest switches ("when BTN1 and BTN2 are pressed").
    subsets.push([], ...switches.map((s) => [s]));
    for (let i = 0; i < switches.length; i++) {
      for (let j = i + 1; j < switches.length; j++) subsets.push([switches[i]!, switches[j]!]);
    }
    subsets.push(...largestStates(switches));
  }
  return subsets.filter(possible).map((s) => ({ closed: new Set(s.map((x) => x.id)), when: describe(s) }));
}

/**
 * Every largest set of switch contacts that can be closed together: all ungrouped contacts, plus
 * one contact from each group (a slide switch is slid to one side at a time).
 */
function largestStates(switches: PartElement[]): PartElement[][] {
  const free = switches.filter((s) => !s.el.group);
  const groups = new Map<string, PartElement[]>();
  for (const s of switches.filter((x) => x.el.group)) {
    const key = `${s.part.ref}#${s.el.group}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  let states: PartElement[][] = [free];
  for (const contacts of groups.values()) states = states.flatMap((st) => contacts.map((c) => [...st, c]));
  return states;
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
  const worstResistor = new Map<string, { pe: PartElement; ma: number }>();

  for (const state of switchStates(elements)) {
    const nets = buildNets(resolved, state.closed);
    const when = state.when ? { when: state.when } : {};
    const allReleased = state.when === "";

    for (const net of nets.all) checkNet(net, nets, resolved, modeOf, allReleased, when, out);
    if (allReleased) checkReleasedOnly(nets, resolved, elements, modeOf, out);

    for (const led of leds) ledFacts.get(led.id)!.push(analyzeLed(led, nets, elements, modeOf));
    const cur = stateCurrents(nets, elements, resolved, modeOf);
    checkGpioCurrents(cur, resolved, when, out);
    for (const [id, r] of cur.resistors) if (r.ma > (worstResistor.get(id)?.ma ?? 0)) worstResistor.set(id, r);
    worstLoad3v3 = Math.max(worstLoad3v3, load3v3(nets, elements) + cur.chain3v3);
  }

  // E017: a resistor past its power rating (P = I² × R), at its worst switch state and output level.
  for (const { pe, ma } of worstResistor.values()) {
    const rating = Number(pe.part.def.specs?.maxPowerW) || 0;
    const ohms = Number(pe.part.props.ohms) || 0;
    const watts = (ma / 1000) ** 2 * ohms;
    if (rating > 0 && watts > rating) {
      out.add({ code: "E017", severity: "error", message: `${pe.part.ref} (${formatOhms(ohms)}) would turn about ${Math.round(watts * 1000)} mW into heat with ${fmtMa(ma)} mA through it, more than the ${Math.round(rating * 1000)} mW a usual breadboard resistor can take. It gets hot and can burn. Use a bigger resistor.`, parts: [pe.part.ref] });
    }
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
    out.add({ code: "W001", severity: "warning", message: `Parts on the 3V3 pin draw about ${Math.round(worstLoad3v3)} mA, more than the ${threeV3.maxLoadMa} mA the datasheet recommends. Power big loads from a separate supply.`, pins: [threeV3.name] });
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
      (l) => (l.leg.kind === "digital_out" || l.leg.kind === "analog_out" || l.leg.kind === "i2c_sda" || l.leg.kind === "i2c_scl") && l.leg.level === "vcc" && partSupplyVoltage(l.part, nets) > resolved.board.electrical.adcPinMaxInputVoltage,
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
            : highOutput.leg.kind === "analog_out"
            ? `${legLabel(highOutput.part, highOutput.leg)} can rise to the module's ~${v} V supply, and it's wired to ${pinText(g)}. Pico pins take at most 3.3 V: power ${highOutput.part.ref} from 3V3 (pin 36).`
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
    // E018 / W008: ground legs on a supply (the part is in the wrong way round), or on nothing.
    const powered = part.def.legs.some((l) => l.kind === "power_in" && part.legs[l.id] && partSupplyVoltage(part, nets) > 0);
    for (const leg of part.def.legs.filter((l) => l.kind === "ground" && part.legs[l.id])) {
      const net = nets.legNet(part, leg.id);
      const supply = net.pins.find(isPower);
      if (supply) {
        out.add({ code: "E018", severity: "error", message: `${legLabel(part, leg)} is connected to ${pinText(supply)}. ${part.ref} is in the wrong way round or its GND wire goes to a supply; reversed power can destroy it. Its GND leg goes to GND.`, parts: [part.ref], pins: [supply.name] });
      } else if (powered && !net.pins.some(isGround)) {
        out.add({ code: "W008", severity: "warning", message: `${legLabel(part, leg)} isn't connected to GND, so ${part.ref} won't work.`, parts: [part.ref] });
      }
    }
    // W012: a data line that needs a pull-up resistor to a supply (DHT, 1-Wire).
    for (const leg of part.def.legs.filter((l) => l.needsPullUp && part.legs[l.id])) {
      const net = nets.legNet(part, leg.id);
      if (!net.pins.some(isGpio)) continue;
      const pulled = reachable(nets, elements, net, (n) => n !== net && n.pins.some(isPower), ["resistor"]);
      if (!pulled) {
        out.add({ code: "W012", severity: "warning", message: `${legLabel(part, leg)} needs a pull-up resistor to the part's supply (a few kΩ, from ${leg.label.split(" ")[0]} to VCC). Without it ${part.ref} can't answer the Pico, and every reading fails.`, parts: [part.ref] });
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
      // Current can't flow up out of GND or down into a supply: those nets end a walk.
      if (dir === "up" ? n.pins.some(isGround) : n.pins.some(isPower)) continue;
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
      // An input joined to GND (by a pressed button) can't be what would light the LED.
      found = n.pins.some(isGround) ? undefined : n.pins.find((p) => isGpio(p) && INPUT_MODES.has(modeOf(p)!));
      return !!found;
    });
    if (found) facts.inputSourcedBy = found;
  }
  facts.resistorFree = walk(anode, "up", isSource, false) && walk(cathode, "down", isSink, false);
  return facts;
}
// ---------- Currents through resistors and LEDs (W011, E016, E017, part of W001) ----------

interface CurrentPath {
  ma: number;
  resistors: PartElement[];
}

const MAX_PATH_ELEMENTS = 8;
const MAX_PATHS = 64;

/** The LED's forward voltage for its colour (pack fact); 1.8 V when unknown (more current: the safe side). */
function forwardVoltage(part: ResolvedPart): number {
  const table = (part.def.specs?.forwardVoltage ?? {}) as Record<string, number>;
  return table[String(part.props.color)] ?? 1.8;
}

/**
 * Series paths of resistors and LEDs from `start` to a net where `endVolts` gives a voltage, with
 * the current each would carry: (voltage difference − LED drops) / resistance. `downhill` means
 * current flows from `start` toward the end (LEDs only anode → cathode), else from the end into
 * `start`. A path stops at any other net with a Pico pin (another driver). Paths with no resistor
 * are E003/E004's job; parts with no resistance value (modules) aren't counted.
 */
function currentPaths(nets: Nets, elements: PartElement[], start: Net, startVolts: number, endVolts: (n: Net) => number | undefined, downhill: boolean): CurrentPath[] {
  const edges = elements.filter((e) => (e.el.kind === "resistor" || e.el.kind === "led") && e.part.legs[e.el.a] && e.part.legs[e.el.b]);
  const paths: CurrentPath[] = [];
  const visit = (net: Net, seen: Set<string>, ohms: number, drop: number, resistors: PartElement[]) => {
    for (const e of edges) {
      if (paths.length >= MAX_PATHS) return;
      const a = nets.legNet(e.part, e.el.a);
      const b = nets.legNet(e.part, e.el.b);
      let next: Net | undefined;
      if (e.el.kind === "resistor") next = a.id === net.id ? b : b.id === net.id ? a : undefined;
      else next = downhill ? (a.id === net.id ? b : undefined) : b.id === net.id ? a : undefined;
      if (!next || seen.has(next.id)) continue;
      const r = e.el.kind === "resistor" ? Number(e.part.props.ohms) || 0 : 0;
      const nOhms = ohms + r;
      const nDrop = drop + (e.el.kind === "led" ? forwardVoltage(e.part) : 0);
      const nRes = e.el.kind === "resistor" ? [...resistors, e] : resistors;
      const v = endVolts(next);
      if (v !== undefined) {
        const ma = nOhms > 0 ? (Math.max(0, Math.abs(startVolts - v) - nDrop) / nOhms) * 1000 : 0;
        if (ma > 0) paths.push({ ma, resistors: nRes });
      } else if (!next.pins.length && seen.size < MAX_PATH_ELEMENTS) {
        visit(next, new Set([...seen, next.id]), nOhms, nDrop, nRes);
      }
    }
  };
  visit(start, new Set([start.id]), 0, 0, []);
  return paths;
}

const sumMa = (paths: CurrentPath[]) => paths.reduce((s, p) => s + p.ma, 0);
const fmtMa = (ma: number) => (ma >= 10 ? String(Math.round(ma)) : String(Math.round(ma * 10) / 10));

interface StateCurrents {
  /** Per driven GPIO: current given when HIGH (to GND) and taken when LOW (from a supply). */
  pins: { pin: BoardPin; source: number; sink: number }[];
  /** Current through each resistor (by element id), worst of the two output levels plus supply paths. */
  resistors: Map<string, { pe: PartElement; ma: number }>;
  /** Current from the 3V3 pin through resistor/LED paths to GND. */
  chain3v3: number;
}

function stateCurrents(nets: Nets, elements: PartElement[], resolved: Resolved, modeOf: (p: BoardPin) => GpioMode | undefined): StateCurrents {
  const high = resolved.board.electrical.logicVoltage;
  const toGround = (n: Net) => (n.pins.some(isGround) ? 0 : undefined);
  const toSupply = (n: Net) => {
    const v = n.pins.filter(isPower).map((p) => p.voltage ?? 0);
    return v.length ? Math.max(...v) : undefined;
  };
  const sourced = new Map<string, { pe: PartElement; ma: number }>();
  const sunk = new Map<string, { pe: PartElement; ma: number }>();
  const add = (m: Map<string, { pe: PartElement; ma: number }>, paths: CurrentPath[]) => {
    for (const p of paths) for (const r of p.resistors) m.set(r.id, { pe: r, ma: (m.get(r.id)?.ma ?? 0) + p.ma });
  };
  const pins: StateCurrents["pins"] = [];
  for (const pin of resolved.board.pins.filter((p) => isGpio(p) && isDriven(modeOf(p)))) {
    const net = nets.pinNet(pin.phys);
    if (net.pins.some((p) => !isGpio(p))) continue; // tied to a rail: E003
    const up = currentPaths(nets, elements, net, high, toGround, true);
    const down = currentPaths(nets, elements, net, 0, toSupply, false);
    add(sourced, up);
    add(sunk, down);
    pins.push({ pin, source: sumMa(up), sink: sumMa(down) });
  }
  // Supply → resistors/LEDs → GND: flows whatever the outputs do.
  const always = new Map<string, { pe: PartElement; ma: number }>();
  let chain3v3 = 0;
  const supplyNets = new Map<string, Net>();
  for (const p of resolved.board.pins.filter(isPower)) supplyNets.set(nets.pinNet(p.phys).id, nets.pinNet(p.phys));
  for (const net of supplyNets.values()) {
    if (net.pins.some(isGround)) continue; // E001
    const paths = currentPaths(nets, elements, net, toSupply(net)!, toGround, true);
    add(always, paths);
    if (net.pins.some((p) => isPower(p) && p.voltage === high)) chain3v3 += sumMa(paths);
  }
  const resistors = new Map<string, { pe: PartElement; ma: number }>();
  for (const id of new Set([...sourced.keys(), ...sunk.keys(), ...always.keys()])) {
    const pe = (sourced.get(id) ?? sunk.get(id) ?? always.get(id))!.pe;
    resistors.set(id, { pe, ma: Math.max(sourced.get(id)?.ma ?? 0, sunk.get(id)?.ma ?? 0) + (always.get(id)?.ma ?? 0) });
  }
  return { pins, resistors, chain3v3 };
}

/** W011 (one pin past its drive strength) and E016 (all GPIOs together past the chip's limit) in one switch state. */
function checkGpioCurrents(cur: StateCurrents, resolved: Resolved, when: { when?: string }, out: IssueList) {
  const g = resolved.board.electrical.gpioCurrent;
  if (!g) return;
  for (const { pin, source, sink } of cur.pins) {
    const worst = Math.max(source, sink);
    if (worst <= g.defaultDriveMa + 1e-9) continue;
    const how = source >= sink ? `give about ${fmtMa(source)} mA when HIGH` : `take about ${fmtMa(sink)} mA when LOW`;
    out.add({
      code: "W011",
      severity: "warning",
      message: `${pinText(pin)} would ${how}, more than the ${g.defaultDriveMa} mA its output is set up for. Past that the pin's voltage drops below what the RP2350 datasheet guarantees (${g.outputHighMinV} V for HIGH, ${g.outputLowMaxV} V for LOW), so an LED gets dimmer and other parts may misread it. Use a bigger resistor (330 Ω keeps a red LED under ${g.defaultDriveMa} mA).`,
      pins: [pin.name],
      ...when,
    });
  }
  const total = (key: "source" | "sink") => cur.pins.reduce((s, p) => s + p[key], 0);
  const list = (key: "source" | "sink") => cur.pins.filter((p) => p[key] > 0).map((p) => `${p.pin.name} ${fmtMa(p[key])} mA`).join(", ");
  const src = total("source");
  if (src > g.maxTotalSourceMa) {
    out.add({ code: "E016", severity: "error", message: `With all outputs HIGH at once the GPIOs give about ${fmtMa(src)} mA together (${list("source")}), more than the ${g.maxTotalSourceMa} mA the RP2350 datasheet allows for all GPIOs together. Use bigger resistors, fewer parts on GPIOs, or a transistor for big loads.`, pins: cur.pins.filter((p) => p.source > 0).map((p) => p.pin.name), ...when });
  }
  const snk = total("sink");
  if (snk > g.maxTotalSinkMa) {
    out.add({ code: "E016", severity: "error", message: `With all outputs LOW at once the GPIOs take about ${fmtMa(snk)} mA together (${list("sink")}), more than the ${g.maxTotalSinkMa} mA the RP2350 datasheet allows into all GPIOs together. Use bigger resistors, fewer parts on GPIOs, or a transistor for big loads.`, pins: cur.pins.filter((p) => p.sink > 0).map((p) => p.pin.name), ...when });
  }
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
