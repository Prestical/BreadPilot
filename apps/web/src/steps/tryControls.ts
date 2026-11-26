// The Code tab's "Try it" panel (M8 8.C3c): which control each input of the circuit gets, and how its
// outputs are shown. From the circuit only (the simulator's input slots and parts), never from the
// idea. Plain functions, so they are tested without a browser.

import { PACKS, type Build } from "@breadpilot/circuit-core";
import type { ElectricalModel, InputSlot } from "@breadpilot/sim/browser";

export type ControlKind = "hold" | "toggle" | "side" | "slider";

export interface TryControl {
  ref: string;
  /** The part, as the packs name it: "Push button (6 mm, 4 legs)". */
  part: string;
  /** What the control changes, in plain words: "Press", "Tilted", "Knob", "Temperature". */
  label: string;
  kind: ControlKind;
  /** The simulator's input slots it writes: one, or a slide switch's two sides. */
  slots: number[];
  /** Slider range and step, in the slot's own units (a knob 0-1). */
  min: number;
  max: number;
  step: number;
  /** Shown after a slider's value ("°C", "%", "lux"); a 0-1 value shown as % has unit "%" and percent. */
  unit: string;
  percent?: boolean;
  /** A slider over a wide range (light) moves on a log scale. */
  log?: boolean;
  /** The range isn't the part's own measuring range (none recorded): only for trying the code. */
  testRange?: boolean;
  /** A toggle's or a slide switch's two states, and the value each one sets. */
  options?: [{ label: string; value: number }, { label: string; value: number }];
  /** The value at the start (slot units; a slide switch: 0 = side 1). */
  value: number;
}

const partOf = (build: Build, ref: string) => build.parts.find((p) => p.ref === ref);
const defOf = (type: string) => PACKS.find((p) => p.part.id === type)?.part;
const range = (type: string, key: string): [number, number] | undefined => {
  // A spec is a plain value in the loaded packs, or a fact with its source ({ value, src }).
  const raw = defOf(type)?.specs?.[key] as unknown;
  const v = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { value?: unknown }).value : raw;
  return Array.isArray(v) && v.length === 2 ? [Number(v[0]), Number(v[1])] : undefined;
};

/** A digital module's output, in plain words, by part type ("triggered" when it has none). */
const SENSED: Record<string, string> = {
  "touch-sensor": "Touched",
  "hall-sensor": "Magnet near",
  "ir-obstacle-sensor": "Something in front",
  "flame-sensor": "Flame seen",
  "sound-sensor": "Loud sound",
  "vibration-sensor": "Shaken",
};

/** A chip quantity's slider: [label, part spec with its range, test range when none, step, unit]. */
const QUANTITY: Record<string, [string, string, [number, number], number, string]> = {
  temperature: ["Temperature", "temperatureRangeC", [-20, 60], 0.5, "°C"],
  humidity: ["Humidity", "humidityRangeRH", [0, 100], 1, "%"],
  pressure: ["Pressure", "pressureRangeHpa", [300, 1100], 1, "hPa"],
  // MPU-6050: tilt as the share of gravity along X, turning in °/s within the chip's default ±250 °/s.
  ax: ["Tilt", "", [-1, 1], 0.05, "g"],
  gz: ["Turning", "", [-250, 250], 5, "°/s"],
};

const two = (a: string, b: string): TryControl["options"] => [
  { label: a, value: 0 },
  { label: b, value: 1 },
];

export function controlsFor(slots: InputSlot[], build: Build, model: ElectricalModel): TryControl[] {
  const out: TryControl[] = [];
  const base = (ref: string) => {
    const type = partOf(build, ref)?.type ?? "";
    return { ref, type, part: defOf(type)?.name ?? ref };
  };
  slots.forEach((slot, i) => {
    const { ref, type, part } = base(slot.ref);
    const common = { ref, part, min: 0, max: 1, step: 1, unit: "", value: slot.value };
    if (slot.group === "switches") {
      const sw = model.switches.find((s) => s.id === slot.key || s.ref === slot.key);
      if (sw?.group) {
        // A slide switch: one control for its two contacts (exactly one closed).
        const same = out.find((c) => c.ref === ref && c.kind === "side");
        if (same) same.slots.push(i);
        else out.push({ ...common, label: "Position", kind: "side", slots: [i], options: two("Side 1", "Side 2"), value: 0 });
        return;
      }
      // A switch closed at rest (a tilt switch upright) opens when used.
      const used = sw?.restsClosed ? 0 : 1;
      const states = (rest: string, use: string): TryControl["options"] => [
        { label: rest, value: 1 - used },
        { label: use, value: used },
      ];
      if (type === "tilt-switch") out.push({ ...common, label: "Tilted", kind: "toggle", slots: [i], options: states("Upright", "Tilted") });
      else if (type === "reed-switch") out.push({ ...common, label: "Magnet near", kind: "toggle", slots: [i], options: states("No magnet", "Magnet near") });
      else out.push({ ...common, label: "Press", kind: "hold", slots: [i] });
      return;
    }
    if (slot.group === "pots") {
      out.push({ ...common, label: "Knob", kind: "slider", slots: [i], step: 0.01, unit: "%", percent: true });
      return;
    }
    // Sensors: a module's output, a light- or temperature-dependent resistor, or a chip's quantity.
    const [, q] = slot.key.split(".");
    if (q !== undefined || model.i2c.some((c) => c.ref === ref) || model.oneWire.some((c) => c.ref === ref)) {
      if (q === undefined || q === "") {
        const r = range(type, "luxRange");
        out.push({ ...common, label: "Light", kind: "slider", slots: [i], min: r?.[0] ?? 1, max: r?.[1] ?? 10000, step: 1, unit: "lux", log: true, ...(r ? {} : { testRange: true }) });
        return;
      }
      const [label, spec, test, step, unit] = QUANTITY[q] ?? [q, "", [0, 100], 1, ""];
      const r = spec ? range(type, spec) : undefined;
      out.push({ ...common, label, kind: "slider", slots: [i], min: (r ?? test)[0], max: (r ?? test)[1], step, unit, ...(r || !spec ? {} : { testRange: true }) });
      return;
    }
    const resistor = model.sensorResistors.find((r) => r.ref === ref);
    if (resistor?.kind === "ldr") {
      out.push({ ...common, label: "Light", kind: "slider", slots: [i], min: 1, max: 10000, step: 1, unit: "lux", log: true, testRange: true });
      return;
    }
    if (resistor?.kind === "ntc") {
      out.push({ ...common, label: "Temperature", kind: "slider", slots: [i], min: -20, max: 100, step: 0.5, unit: "°C", testRange: true });
      return;
    }
    const driver = model.drivers.find((d) => d.ref === ref);
    if (driver?.kind === "analog") out.push({ ...common, label: "Reading", kind: "slider", slots: [i], step: 0.01, unit: "%", percent: true });
    else out.push({ ...common, label: SENSED[type] ?? "Triggered", kind: "toggle", slots: [i], options: two("No", "Yes") });
  });
  return out;
}

/** What each slot gets when a control is set to v (a slide switch closes one side and opens the other). */
export function controlWrites(c: TryControl, v: number): [number, number][] {
  if (c.kind === "side") return c.slots.map((slot, n) => [slot, n === v ? 1 : 0]);
  return [[c.slots[0]!, v]];
}

/** A log slider's position (0-1000) and back. */
export const LOG_STEPS = 1000;
export const toPosition = (c: TryControl, v: number) => (c.log ? Math.round((Math.log(Math.max(v, c.min) / c.min) / Math.log(c.max / c.min)) * LOG_STEPS) : v);
export const fromPosition = (c: TryControl, pos: number) => (c.log ? Math.round(c.min * (c.max / c.min) ** (pos / LOG_STEPS)) : pos);

/** A slider's value as text: "50 %", "22.5 °C", "300 lux". */
export function valueText(c: TryControl, v: number): string {
  if (c.percent) return `${Math.round(v * 100)} %`;
  const digits = c.step < 1 ? (c.step < 0.1 ? 2 : 1) : 0;
  return `${v.toFixed(digits)}${c.unit ? ` ${c.unit}` : ""}`;
}

/** CSS colours of the LED colours the LED part allows. */
const LED_COLOURS: Record<string, string> = { red: "#ff3b30", green: "#22c55e", yellow: "#facc15", blue: "#3b82f6", white: "#f8fafc" };

export interface TryOutputs {
  leds: { ref: string; colour: string; name: string }[];
  modules: { ref: string; type: string; name: string }[];
  displays: { ref: string; name: string }[];
}

export function outputsFor(build: Build, model: ElectricalModel): TryOutputs {
  const name = (ref: string) => defOf(partOf(build, ref)?.type ?? "")?.name ?? ref;
  return {
    leds: model.leds.map((l) => {
      const color = String(partOf(build, l.ref)?.props?.color ?? "red");
      return { ref: l.ref, colour: LED_COLOURS[color] ?? LED_COLOURS.red!, name: `${color} LED` };
    }),
    modules: model.actuators.map((a) => ({ ref: a.ref, type: a.name, name: name(a.ref) })),
    displays: model.i2c.filter((c) => c.type.startsWith("oled")).map((c) => ({ ref: c.ref, name: name(c.ref) })),
  };
}

/** An LED's brightness 0-1: its current over its full-on current. */
export const brightness = (ma: number | undefined, full: number | undefined) => (!ma ? 0 : full && full > 0 ? Math.min(1, ma / full) : 1);

/** A buzzer or motor's state in words. A passive buzzer sounds only with a tone; held on without one it is silent. */
export function moduleText(type: string, s: { on: number; freq: number } | undefined): string {
  const on = s?.on ?? 0;
  if (type === "passive-buzzer") return on > 0 && s!.freq > 0 ? `tone ${Math.round(s!.freq)} Hz` : on > 0 ? "held on, no tone (silent)" : "quiet";
  if (type === "active-buzzer") return on > 0 ? (on < 1 ? `beeping (${Math.round(on * 100)} % of the time)` : "beeping") : "quiet";
  return on > 0 ? (on < 1 ? `running (${Math.round(on * 100)} %)` : "running") : "off";
}

/** How a run ended, in plain words, with the main.py line of an error. */
export function endText(end: { ended: string; error?: { type: string; message: string; line?: number } }): string {
  if (end.ended === "error" && end.error) return `Stopped with ${end.error.type}: ${end.error.message}${end.error.line ? ` (line ${end.error.line})` : ""}. On the Pico it stops there the same way.`;
  if (end.ended === "finished") return "The program finished.";
  if (end.ended === "stopped") return "Stopped.";
  if (end.ended === "time limit") return "Stopped after 6 hours.";
  if (["reset", "soft reset", "bootloader", "deep sleep"].includes(end.ended)) return `The program asked for ${end.ended}: on the Pico it would restart or sleep here.`;
  return end.ended;
}
