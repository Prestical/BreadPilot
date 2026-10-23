// Build steps: turns a validated Build into ordered,
// beginner-friendly instructions. Written by code, not by the LLM, so the hole
// numbers in the text always match the 3D scene.
//
// Order: breadboard → Pico → parts → ground wires → signal wires → power wires → USB last.

import { holeKey, picoPinHole, stripOfHole } from "./breadboard";
import { formatWire } from "./dsl";
import { legLabel, resolveBuild, type Resolved, type ResolvedEnd, type ResolvedPart } from "./resolve";
import { PACKS, packOfPart, type TextTemplates } from "./packs";
import { validateBuild } from "./validate";
import type { Build, Issue, RailId } from "./types";

export type StepKind = "intro" | "place-pico" | "place-part" | "wire" | "usb";
export type WireRole = "ground" | "signal" | "power";

export interface BuildStep {
  index: number;
  kind: StepKind;
  title: string;
  /** Plain-English instruction. */
  text: string;
  /** Why this step is needed, written by code from the actual circuit (never by the LLM). */
  why: string;
  /** Extra hint, e.g. how to tell the LED legs apart. */
  tip?: string;
  /** Connection line in the DSL, for wire steps. */
  dsl?: string;
  partRef?: string;
  wireIndex?: number;
  wireRole?: WireRole;
  /** Holes ("27g") and rails the camera should frame and the scene should highlight. */
  focus: { holes: string[]; rails: RailId[] };
}

export class StepsError extends Error {
  constructor(public issues: Issue[]) {
    super(`Build has ${issues.length} error(s); steps are only made for safe builds.`);
  }
}

const BAND_COLORS = ["black", "brown", "red", "orange", "yellow", "green", "blue", "violet", "grey", "white"];

/** 4-band resistor color code, e.g. 330 Ω → orange, orange, brown, gold. */
export function resistorBands(ohms: number): [string, string, string, string] {
  if (!Number.isFinite(ohms) || ohms < 10) throw new Error(`Unsupported resistor value ${ohms} Ω`);
  const exp = Math.floor(Math.log10(ohms)) - 1;
  const digits = Math.round(ohms / 10 ** exp);
  const [d1, d2] = [Math.floor(digits / 10), digits % 10];
  return [BAND_COLORS[d1]!, BAND_COLORS[d2]!, BAND_COLORS[exp]!, "gold"];
}

export function formatOhms(ohms: number): string {
  if (ohms >= 1_000_000) return `${+(ohms / 1_000_000).toFixed(2)} MΩ`;
  if (ohms >= 1000) return `${+(ohms / 1000).toFixed(2)} kΩ`;
  return `${ohms} Ω`;
}

const RAIL_TEXT: Record<RailId, string> = {
  "RL+": "the left + rail (red line)",
  "RL-": "the left − rail (blue line)",
  "RR+": "the right + rail (red line)",
  "RR-": "the right − rail (blue line)",
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function wireRole(resolved: Resolved, ends: [ResolvedEnd, ResolvedEnd]): WireRole {
  let role: WireRole = "signal";
  for (const end of ends) {
    if (end.kind === "rail") role = end.rail.endsWith("-") ? "ground" : "power";
    else if (end.picoPin) {
      const pin = resolved.board.pins.find((p) => p.phys === end.picoPin)!;
      if (pin.type === "ground") role = "ground";
      if (pin.type === "power") role = "power";
    }
  }
  return role;
}

function describeEnd(resolved: Resolved, end: ResolvedEnd, otherRow: number | undefined): string {
  if (end.kind === "rail") {
    const row = end.row ?? otherRow;
    return `${RAIL_TEXT[end.rail]}${row ? `, next to row ${row}` : ""}`;
  }
  const key = holeKey(end.hole);
  if (end.picoPin) {
    const pin = resolved.board.pins.find((p) => p.phys === end.picoPin)!;
    return `hole ${key}, right next to Pico pin ${pin.phys} (${pin.name})`;
  }
  const strip = stripOfHole(end.hole);
  for (const part of resolved.parts) {
    for (const leg of part.def.legs) {
      const h = part.legs[leg.id];
      if (h && stripOfHole(h) === strip) return `hole ${key}, in the same row as ${legLabel(part, leg)}`;
    }
  }
  const pin = resolved.board.pins.find((p) => stripOfHole(picoPinHole(p.phys)) === strip);
  if (pin) return `hole ${key}, in the same row as Pico pin ${pin.phys} (${pin.name})`;
  return `hole ${key}`;
}

// Part texts come from each part's pack (parts/<id>/text.json) with {placeholders}; parts without
// one get the generic sentences below.
type Vars = Record<string, () => string>;

/** Fills {placeholders}; values are computed only when used (e.g. color bands throw for odd values). */
function fill(template: string, vars: Vars): string {
  return template.replace(/\{([^}]*)\}/g, (_m, key: string) => String(vars[key]?.() ?? `{${key}}`));
}

function partVars(part: ResolvedPart): Vars {
  const holes = () => Object.values(part.legs).map(holeKey);
  const vars: Vars = {
    ref: () => part.ref,
    name: () => part.def.name,
    list: () => {
      const legsText = part.def.legs.filter((l) => part.legs[l.id]).map((l) => `${l.label} into hole ${holeKey(part.legs[l.id]!)}`);
      return legsText.length > 1 ? `${legsText.slice(0, -1).join(", ")} and ${legsText.at(-1)}` : (legsText[0] ?? "");
    },
    holes: () => holes().join(", "),
    ohms: () => formatOhms(Number(part.props.ohms)),
    bands: () => resistorBands(Number(part.props.ohms)).join(", "),
    note: () => (typeof part.def.specs?.note === "string" ? part.def.specs.note : ""),
  };
  part.def.legs.forEach((l, i) => {
    vars[`hole.${l.id}`] = () => holeKey(part.legs[l.id]!);
    vars[`holes.${i}`] = () => String(holes()[i]);
  });
  for (const k of Object.keys(part.def.props ?? {})) vars[`prop.${k}`] = () => String(part.props[k] ?? part.def.props![k]!.default);
  return vars;
}

const DEFAULT_PLACE = { title: "Place {ref} ({name})", text: "Place {name} {ref}: {list}.", tip: "{note}" };

function partText(part: ResolvedPart): { title: string; text: string; tip?: string } {
  const t = packOfPart(part.def)?.text?.place ?? DEFAULT_PLACE;
  const vars = partVars(part);
  const title = fill(t.title, vars);
  const text = fill(t.text, vars);
  const tip = t.tip === undefined ? "" : fill(t.tip, vars);
  return { title, text, ...(tip ? { tip } : {}) };
}

const ROLE_ORDER: Record<WireRole, number> = { ground: 0, signal: 1, power: 2 };
const ROLE_TEXT: Record<WireRole, string> = { ground: "ground", signal: "signal", power: "power" };

// ---------- "why" notes ----------
// Written from the resolved circuit so they're always true for this build. A 4B model
// wrote plausible but wrong physics here (e.g. "the button's negative side").

const legsInStrip = (resolved: Resolved, strip: string) =>
  resolved.parts.flatMap((part) => part.def.legs.filter((l) => part.legs[l.id] && stripOfHole(part.legs[l.id]!) === strip).map((leg) => ({ part, leg })));

const hasElement = (part: ResolvedPart, kind: string) => part.def.elements.some((e) => e.kind === kind);
/** A plain resistor: its only element is one resistor (a potentiometer has two). */
const isResistor = (part: ResolvedPart) => part.def.elements.length === 1 && part.def.elements[0]!.kind === "resistor";

/** The LED wired in series with a resistor (sharing a strip with one of its legs). */
function ledOnResistor(resolved: Resolved, resistor: ResolvedPart): ResolvedPart | undefined {
  const strips = Object.values(resistor.legs).map(stripOfHole);
  return resolved.parts.find((p) => hasElement(p, "led") && Object.values(p.legs).some((h) => strips.includes(stripOfHole(h))));
}

function ledCurrentMa(led: ResolvedPart, ohms: number, supply = 3.3): { vf: number; ma: number } {
  const table = (led.def.specs?.forwardVoltage ?? {}) as Record<string, number>;
  const vf = table[String(led.props.color)] ?? 2.0;
  return { vf, ma: Math.round(((supply - vf) / ohms) * 10000) / 10 };
}

function partWhy(resolved: Resolved, part: ResolvedPart): string {
  const t = packOfPart(part.def)?.text;
  const vars = partVars(part);
  if (t?.whyWithLed) {
    const led = ledOnResistor(resolved, part);
    if (led) {
      const { vf, ma } = ledCurrentMa(led, Number(part.props.ohms));
      return fill(t.whyWithLed, { ...vars, led: () => led.ref, vf: () => String(vf), ma: () => String(ma) });
    }
  }
  if (t?.why) return fill(t.why, vars);
  return typeof part.def.specs?.note === "string" ? part.def.specs.note : `${part.ref} is part of this project's circuit.`;
}

/** The first pack (in pack order) with a text for this wire and a part leg in the strip. */
function packWireText(legs: { part: ResolvedPart }[], key: keyof NonNullable<TextTemplates["wire"]>, extra: Vars = {}): string | undefined {
  for (const pack of PACKS) {
    const text = pack.text?.wire?.[key];
    const hit = text && legs.find((l) => l.part.def.id === pack.meta.id);
    if (hit) return fill(text, { ...partVars(hit.part), ...extra });
  }
  return undefined;
}

function wireWhy(resolved: Resolved, build: Build, ends: [ResolvedEnd, ResolvedEnd]): string {
  const pinEnd = ends.find((e) => e.kind === "hole" && e.picoPin);
  const pin = pinEnd && pinEnd.kind === "hole" ? resolved.board.pins.find((p) => p.phys === pinEnd.picoPin) : undefined;
  const rail = ends.find((e) => e.kind === "rail");
  const plain = ends.find((e) => e.kind === "hole" && !e.picoPin);
  const legs = plain && plain.kind === "hole" ? legsInStrip(resolved, stripOfHole(plain.hole)) : [];
  const minus = rail?.kind === "rail" && rail.rail.endsWith("-");
  const plus = rail?.kind === "rail" && rail.rail.endsWith("+");
  // A part's GND/3V3 wire goes to a rail, or straight to a Pico pin (direct power mode).
  const ground = minus || (!rail && pin?.type === "ground");
  const power = plus || (!rail && pin?.type === "power");
  const source = rail ? "the + rail" : `the Pico's ${pin?.name} pin`;

  if (pin?.type === "ground" && minus) return "This puts ground (0 V) on the whole − rail, so every part can reach GND with a short wire.";
  if (pin?.type === "power" && plus) return `This puts ${pin.name} on the whole + rail, so parts that need power can reach it with a short wire.`;
  if (ground) {
    const text = packWireText(legs, "ground");
    if (text) return text;
    if (legs[0]) return `This connects ${legs[0].part.ref} to ground (0 V).`;
  }
  if (power) {
    const text = packWireText(legs, "power");
    if (text) return text;
    if (legs[0]) return `This powers ${legs[0].part.ref} from ${source}.`;
  }
  if (pin?.type === "gpio") {
    const mode = build.gpioModes[pin.name];
    const signal = { pin: () => pin.name };
    if (mode === "out" || mode === "pwm") {
      const own = packWireText(legs, "out", signal);
      if (own) return own;
      const res = legs.find((l) => isResistor(l.part));
      const led = res ? ledOnResistor(resolved, res.part) : legs.find((l) => hasElement(l.part, "led"))?.part;
      return `${pin.name} is an output: when the code turns it on (3.3 V), current flows${res ? ` through ${res.part.ref}` : ""}${led ? ` and lights ${led.ref}` : ""}.`;
    }
    if (mode === "in_pullup" || mode === "in_pulldown" || mode === "in") {
      const own = packWireText(legs, "in", signal);
      if (own) return own;
      const btn = legs.find((l) => hasElement(l.part, "switch"));
      const states = mode === "in_pullup" ? "1 while it's released and 0 while it's pressed" : mode === "in_pulldown" ? "0 while it's released and 1 while it's pressed" : "its state";
      return `${pin.name} is the input the code reads${btn ? ` to see ${btn.part.ref}: ${states}` : ""}.`;
    }
    const i2c = mode ? /^i2c(\d)_(sda|scl)$/.exec(mode) : null;
    if (i2c) {
      const own = packWireText(legs, i2c[2] === "sda" ? "i2c_sda" : "i2c_scl", { ...signal, bus: () => i2c[1]! });
      if (own) return own;
      // Fallbacks keep the wording from before part packs (the display was the only I2C part), so
      // behaviour stays identical; packs give their own text (wire.i2c_sda / wire.adc).
      const to = legs[0] ? ` to ${legs[0].part.ref}` : "";
      return i2c[2] === "sda"
        ? `${pin.name} is the I2C${i2c[1]} data line (SDA): the Pico sends the pixels${to} on this wire.`
        : `${pin.name} is the I2C${i2c[1]} clock line (SCL): it sets the pace for the data on SDA.`;
    }
    if (mode === "adc") return packWireText(legs, "adc", signal) ?? `${pin.name} is an analog input (ADC): it measures the knob's middle-leg voltage and gives the code a number from 0 to 65535.`;
    return `${pin.name} carries the signal${legs[0] ? ` to ${legs[0].part.ref}` : ""}.`;
  }
  return "This joins two rows so current can flow between them.";
}

export function buildSteps(build: Build): BuildStep[] {
  const report = validateBuild(build);
  const errors = report.issues.filter((i) => i.severity === "error");
  if (errors.length) throw new StepsError(errors);
  const { resolved } = resolveBuild(build);
  if (!resolved) throw new StepsError(report.issues);

  const steps: Omit<BuildStep, "index">[] = [];
  steps.push({
    kind: "intro",
    title: "Get your breadboard ready",
    text: "Put the breadboard in front of you with row 1 at the top. Columns a-e are on the left of the center channel, f-j on the right.",
    why: "Holding the board the same way as the 3D view makes every hole number easy to find.",
    tip: "Keep the USB cable unplugged until the last step.",
    focus: { holes: ["1a", "63j"], rails: [] },
  });
  steps.push({
    kind: "place-pico",
    title: "Insert the Pico 2 W",
    text: "Press the Pico across the center channel with its USB connector toward row 1. Pin 1 goes into hole 1c and pin 40 into hole 1h, so the pins fill rows 1-20 in columns c and h.",
    why: "Each Pico pin now sits in its own breadboard row, so a wire plugged into that row connects to that pin. The channel keeps the two sides apart.",
    tip: "Press gently and evenly on both edges until the header sits flat on the breadboard.",
    focus: { holes: ["1c", "20h"], rails: [] },
  });

  for (const part of resolved.parts) {
    const t = partText(part);
    steps.push({ kind: "place-part", ...t, why: partWhy(resolved, part), partRef: part.ref, focus: { holes: Object.values(part.legs).map(holeKey), rails: [] } });
  }

  const wires = resolved.wires
    .map((w) => ({ w, wire: build.wires[w.index]!, role: wireRole(resolved, w.ends) }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.w.index - b.w.index);

  for (const { w, wire, role } of wires) {
    const rowOf = (e: ResolvedEnd) => (e.kind === "hole" ? e.hole.row : e.row);
    const [a, b] = w.ends;
    const color = wire.color ?? defaultColor(role);
    const holes = w.ends.flatMap((e) => (e.kind === "hole" ? [holeKey(e.hole)] : []));
    steps.push({
      kind: "wire",
      title: `${capitalize(color)} wire (${ROLE_TEXT[role]})`,
      text: `Take a ${color} jumper wire. Plug one end into ${describeEnd(resolved, a, rowOf(b))}. Plug the other end into ${describeEnd(resolved, b, rowOf(a))}.`,
      why: wireWhy(resolved, build, w.ends),
      dsl: formatWire(wire),
      wireIndex: w.index,
      wireRole: role,
      focus: { holes, rails: w.ends.flatMap((e) => (e.kind === "rail" ? [e.rail] : [])) },
    });
  }

  steps.push({
    kind: "usb",
    title: "Check, then plug in USB",
    text: "Compare your board with the 3D view one more time. If every wire matches, plug the USB cable into the Pico. Power always goes in last.",
    why: "Power goes in last, so a misplaced wire can't cause a short while you're still building.",
    tip: "If anything gets hot or smells, unplug the USB cable right away.",
    focus: { holes: ["1c", "1h"], rails: [] },
  });

  return steps.map((s, index) => ({ index, ...s }));
}

export function defaultColor(role: WireRole): string {
  return role === "ground" ? "black" : role === "power" ? "red" : "yellow";
}
