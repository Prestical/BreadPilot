// BreadPilot behaviour simulator: the inputs of a live run (M8 8.C3, the Code tab's preview).
// One slot per thing a person can change while the program runs, from the circuit only (the same
// parts the automatic test run uses): each switch or switch contact, each knob, and what each sensor
// senses. The page writes them into the run's SharedArrayBuffer (live.mjs).

import type { ElectricalModel } from "./circuit";
import { testRun } from "./scenario";
import { solveCircuit, type PinState } from "./solver.mjs";
import type { SimEvent } from "./trace";

export interface InputSlot {
  group: "switches" | "pots" | "sensors";
  /** The solver's key: "BTN1", "SW1#1" (a slide switch contact), "POT1", "LDR1", "DHT1.temperature". */
  key: string;
  /** The part it belongs to. */
  ref: string;
  /** The value at the start: switches at rest (open, or closed for a tilt switch upright), knobs in the middle, sensors at rest. */
  value: number;
}

export function inputSlots(model: ElectricalModel): InputSlot[] {
  const { scenario } = testRun(model);
  const refOf = (key: string) => key.split(/[#.]/)[0]!;
  const rest = (list: [number, number][] | undefined) => (list?.[0]?.[0] === 0 ? list[0][1] : 0);
  return [
    ...Object.entries(scenario.switches).map(([key, list]) => ({ group: "switches" as const, key, ref: refOf(key), value: rest(list) })),
    ...Object.keys(scenario.pots).map((key) => ({ group: "pots" as const, key, ref: key, value: 0.5 })),
    ...Object.entries(scenario.sensors).map(([key, list]) => ({ group: "sensors" as const, key, ref: refOf(key), value: rest(list) })),
  ];
}

/** What the preview shows, updated from the run's events (8.C3b). */
export interface PreviewState {
  /** The newest picture of each display: base64 of its 128×64 MONO_VLSB buffer (framePixels). */
  frames: Record<string, string>;
  /** Each LED's current in mA (PWM averaged): brightness = ma / ledFullMa. */
  leds: Record<string, number>;
  /** Buzzers and motors: on (0-1, the share of time for PWM) and the tone in Hz (0 = none). */
  modules: Record<string, { on: number; freq: number }>;
  /** The printed lines, newest last (at most MAX_PRINTS). */
  prints: string[];
  /** What isn't simulated (Wi-Fi…), and input pins wired to nothing: said once each. */
  notes: string[];
  /** Real milliseconds the run has fallen behind (0 = it keeps up with real time). */
  behindMs: number;
  /** Virtual time of the newest event, µs. */
  t: number;
}

export const MAX_PRINTS = 200;

export const emptyPreview = (): PreviewState => ({ frames: {}, leds: {}, modules: {}, prints: [], notes: [], behindMs: 0, t: 0 });

/** The state after a batch of events (a new object, so a page can compare by reference). */
export function applyEvents(state: PreviewState, events: SimEvent[]): PreviewState {
  if (!events.length) return state;
  const next: PreviewState = { ...state, frames: { ...state.frames }, leds: { ...state.leds }, modules: { ...state.modules } };
  const printed: string[] = [];
  const notes = new Set(state.notes);
  for (const e of events) {
    next.t = Math.max(next.t, e.t);
    if (e.kind === "frame") next.frames[String(e.a)] = String(e.b);
    else if (e.kind === "led") next.leds[String(e.a)] = Number(e.b);
    else if (e.kind === "actuator") next.modules[String(e.a)] = { on: Number(e.b), freq: Number(e.c) || 0 };
    else if (e.kind === "print") printed.push(String(e.a));
    else if (e.kind === "slow") next.behindMs = Number(e.a);
    else if (e.kind === "unsimulated") notes.add(`Not simulated: ${String(e.a)}.`);
    else if (e.kind === "floating") notes.add(`GP${String(e.a)} is an input wired to nothing (no pull), so it reads at random on the board.`);
  }
  if (printed.length) next.prints = [...state.prints, ...printed].slice(-MAX_PRINTS);
  if (notes.size !== state.notes.length) next.notes = [...notes];
  return next;
}

/** A 128×64 MONO_VLSB picture as one byte per pixel (1 = lit), row by row. */
export function framePixels(b64: string, width = 128, height = 64): Uint8Array {
  const raw = atob(b64);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[y * width + x] = (raw.charCodeAt((y >> 3) * width + x) >> (y & 7)) & 1;
  }
  return out;
}

/**
 * Each LED's current when it is fully on: its Pico pins on the anode side driven HIGH and on the
 * cathode side LOW (directly or through one resistor), everything else at rest. The page shows an
 * LED's brightness as its current over this, so a PWM-dimmed LED looks dim.
 */
export function ledFullMa(model: ElectricalModel): Record<string, number> {
  const rest = { switches: {}, pots: {}, sensors: {} };
  const open = solveCircuit(model, rest, {});
  const side = (node: number) => {
    const g = open.group(node);
    const groups = new Set([g, ...model.resistors.flatMap((r) => (open.group(r.a) === g ? [open.group(r.b)] : open.group(r.b) === g ? [open.group(r.a)] : []))]);
    return model.gpios.filter((p) => groups.has(open.group(p.node))).map((p) => p.gpio);
  };
  const out: Record<string, number> = {};
  for (const led of model.leds) {
    const pins: Record<number, PinState> = {};
    for (const g of side(led.anode)) pins[g] = { mode: "out", level: 1 };
    for (const g of side(led.cathode)) pins[g] = { mode: "out", level: 0 };
    out[led.ref] = Math.round((solveCircuit(model, rest, pins).ledMa[led.ref] ?? 0) * 100) / 100;
  }
  return out;
}
