// BreadPilot behaviour simulator: behaviour claims and S006 (M18 18.7g, was M8 8.4).
// The code AI states what its program makes happen, in words built from the circuit only
// ("BTN1 pressed" → "LED1 on"). The simulator, not the AI, decides whether each claim holds during
// the automatic test run. A claim that can't be read or checked is said so, never passed.
//
// What each word means (general rules, the same for every project):
//   when  "<switch> pressed" (tilt switch "tilted", reed switch "near a magnet"): each time the test closes it
//         "<module> triggered" / "<module> high": the module senses (digital) or reads high (analog)
//         "<knob> turned up" / "turned down": the sweep from low to high, or back
//         "<LDR> dark" / "bright", "<NTC> warm" / "cold", "<chip> temperature high" / "low", ...
//   then  "<LED> on" / "off": on (off) for at least 100 ms (or half the time) of one of those times
//         "<LED> blinks": it changes at least 3 times within one of those times
//         "<LED> brighter" / "dimmer": brighter (dimmer) at the end of the time than at its start
//         (a sweep) or than just before it
//         "<module> on" / "off": a buzzer or motor, like an LED
//         "<display> changes": a new picture within one of those times (or just after it)
// So "on" doesn't say the LED is off at other times: an LED that is always on passes (S003's job).
// What it catches is an output doing the opposite of the claim, such as an inverted button.

import type { Build } from "@breadpilot/circuit-core";
import { electricalModel, type ElectricalModel } from "./circuit";
import type { Finding } from "./findings";
import type { SimResult } from "./run";
import { QUANTITIES, testRun, type TestRun } from "./scenario";

export interface Claim {
  when: string;
  then: string;
}

export interface CheckedClaim extends Claim {
  /** true: it happened; false: it didn't (an S006); null: it couldn't be checked (see notes). */
  held: boolean | null;
}

export interface ClaimWords {
  when: string[];
  then: string[];
  /** What a sensor phrase means in the test run ("DHT1 temperature high" → "30 C"), so a claim can fit the program's thresholds. */
  values: Record<string, string>;
}

const MS = 1000;
const S = 1_000_000;
/** At most this many claims are checked (the rest are said to be unchecked). */
export const MAX_CLAIMS = 6;

interface Window {
  from: number;
  to: number;
  /** A sweep (a knob): "brighter" compares its end with its start. */
  ramp?: boolean;
}
type Then = { ref: string; kind: "led" | "actuator"; word: "on" | "off" | "blinks" | "brighter" | "dimmer" } | { ref: string; kind: "frame"; word: "changes" };

/** Switch words by part type (one switch per part; slide switches have no word: two sides). */
const SWITCH_WORD: Record<string, string> = { "tilt-switch": "tilted", "reed-switch": "near a magnet" };
/** Chip quantities in words: [word for the quantity, word above rest, word below rest]. */
const CHIP_WORDS: Record<string, [string, string, string]> = {
  temperature: ["temperature", "high", "low"],
  humidity: ["humidity", "high", "low"],
  pressure: ["pressure", "high", "low"],
  ax: ["", "tilted", "tilted"],
  gz: ["", "rotated", "rotated"],
  "": ["", "bright", "dark"],
};

/** Times a timeline's value passes `test`, as windows (the last one runs to `end`). */
function spans(list: [number, number][] | undefined, test: (v: number) => boolean, end: number): Window[] {
  const out: Window[] = [];
  for (let i = 0; i < (list?.length ?? 0); i++) {
    const [t, v] = list![i]!;
    if (!test(v)) continue;
    const to = list![i + 1]?.[0] ?? end;
    const last = out.at(-1);
    if (last && last.to === t) last.to = to;
    else out.push({ from: t, to });
  }
  return out;
}

/** Units of the chip quantities in the test run. */
const UNITS: Record<string, string> = { temperature: "C", humidity: "%", pressure: "hPa", ax: "g", gz: "degrees/s", "": "lux" };

/** Every "when" word of a circuit with the times the test run makes it true (and, in `values`, what it means). */
function whenWindows(model: ElectricalModel, run: TestRun, build: Build, values: Record<string, string> = {}): Map<string, Window[]> {
  const words = new Map<string, Window[]>();
  const end = run.seconds * S;
  const typeOf = (ref: string) => build.parts.find((p) => p.ref === ref)?.type ?? "";
  const refs = new Set(model.switches.filter((s) => !s.group).map((s) => s.ref));
  for (const ref of refs) words.set(`${ref} ${SWITCH_WORD[typeOf(ref)] ?? "pressed"}`, spans(run.scenario.switches[ref], (v) => v === 1, end));
  for (const d of model.drivers) {
    if (!run.scenario.sensors[d.ref]) continue;
    const word = `${d.ref} ${d.kind === "digital" ? "triggered" : "high"}`;
    words.set(word, spans(run.scenario.sensors[d.ref], (v) => v > 0, end));
    if (d.kind === "analog") values[word] = `${Math.round(Math.max(...run.scenario.sensors[d.ref]!.map(([, v]) => v)) * 100)}% of its range`;
  }
  for (const p of model.pots) {
    const phase = run.phases.find((x) => x.ref === p.ref);
    if (!phase) continue;
    words.set(`${p.ref} turned up`, [{ from: phase.from, to: phase.from + 3 * S, ramp: true }]);
    words.set(`${p.ref} turned down`, [{ from: phase.from + 3 * S, to: phase.from + 6 * S, ramp: true }]);
  }
  for (const r of model.sensorResistors) {
    const list = run.scenario.sensors[r.ref];
    const [lo, hi] = r.kind === "ldr" ? ["dark", "bright"] : ["cold", "warm"];
    const rest = list?.[0]?.[1] ?? 0;
    words.set(`${r.ref} ${lo}`, spans(list, (v) => v < rest, end));
    words.set(`${r.ref} ${hi}`, spans(list, (v) => v > rest, end));
    const unit = r.kind === "ldr" ? "lux" : "C";
    const at = (test: (v: number) => boolean) => [...new Set((list ?? []).filter(([, v]) => test(v)).map(([, v]) => `${v} ${unit}`))].join(", ");
    values[`${r.ref} ${lo}`] = at((v) => v < rest);
    values[`${r.ref} ${hi}`] = at((v) => v > rest);
  }
  for (const chip of [...model.i2c, ...model.oneWire]) {
    for (const [q, rest] of QUANTITIES[chip.type] ?? []) {
      const [name, up, down] = CHIP_WORDS[q] ?? [q, "high", "low"];
      const list = run.scenario.sensors[q ? `${chip.ref}.${q}` : chip.ref];
      const base = `${chip.ref}${name ? ` ${name}` : ""}`;
      const add = (word: string, test: (v: number) => boolean) => {
        words.set(`${base} ${word}`, [...(words.get(`${base} ${word}`) ?? []), ...spans(list, test, end)]);
        values[`${base} ${word}`] = [...new Set((list ?? []).filter(([, v]) => test(v)).map(([, v]) => `${v} ${UNITS[q] ?? ""}`.trim()))].join(", ");
      };
      if (down === up) add(up, (v) => v !== rest);
      else {
        add(up, (v) => v > rest);
        add(down, (v) => v < rest);
      }
    }
  }
  for (const [k, w] of words) if (!w.length) words.delete(k);
  return words;
}

/** Every "then" word of a circuit. */
function thenWords(model: ElectricalModel): Map<string, Then> {
  const words = new Map<string, Then>();
  for (const l of model.leds) for (const word of ["on", "off", "blinks", "brighter", "dimmer"] as const) words.set(`${l.ref} ${word}`, { ref: l.ref, kind: "led", word });
  for (const a of model.actuators) for (const word of ["on", "off"] as const) words.set(`${a.ref} ${word}`, { ref: a.ref, kind: "actuator", word });
  for (const c of model.i2c.filter((x) => x.type.startsWith("oled"))) words.set(`${c.ref} changes`, { ref: c.ref, kind: "frame", word: "changes" });
  return words;
}

/** The words the code AI may use in its claims for this circuit (the prompt lists them). */
export function claimWords(build: Build, model = electricalModel(build), run?: TestRun): ClaimWords {
  const values: Record<string, string> = {};
  const when = [...whenWindows(model, run ?? testRun(model), build, values).keys()];
  return { when, then: [...thenWords(model).keys()], values: Object.fromEntries(Object.entries(values).filter(([k, v]) => v && when.includes(k))) };
}

/** "When BTN1 is pressed." → "btn1 pressed": case, filler words and full stops don't matter. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.!]+$/, "")
    .replace(/^(when|while|if|whenever)\s+/, "")
    .replace(/\b(is|are|gets|goes|turns|stays|the)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A value over time from on-change events (0 before the first). */
function series(events: SimResult["events"], kind: string, ref: string): [number, number][] {
  return events.filter((e) => e.kind === kind && e.a === ref).map((e) => [e.t, kind === "frame" ? 0 : Number(e.b) || 0]);
}
const valueAt = (s: [number, number][], t: number) => {
  let v = 0;
  for (const [at, x] of s) if (at <= t) v = x;
  return v;
};
/** Time within [from, to) that `test(value)` holds. */
function timeWhere(s: [number, number][], from: number, to: number, test: (v: number) => boolean): number {
  let total = 0;
  let t = from;
  let v = valueAt(s, from);
  for (const [at, x] of s) {
    if (at <= from) continue;
    if (at >= to) break;
    if (test(v)) total += at - t;
    t = at;
    v = x;
  }
  if (test(v)) total += to - t;
  return Math.max(0, total);
}
function mean(s: [number, number][], from: number, to: number): number {
  if (to <= from) return valueAt(s, from);
  let sum = 0;
  let t = from;
  let v = valueAt(s, from);
  for (const [at, x] of s) {
    if (at <= from) continue;
    if (at >= to) break;
    sum += v * (at - t);
    t = at;
    v = x;
  }
  return (sum + v * (to - t)) / (to - from);
}
const changes = (s: [number, number][], from: number, to: number) => {
  let n = 0;
  let was = valueAt(s, from) > 0;
  for (const [at, x] of s) {
    if (at <= from || at >= to) continue;
    if (x > 0 !== was) n++;
    was = x > 0;
  }
  return n;
};
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((100 * part) / whole) : 0);
const secs = (us: number) => `${(us / S).toFixed(1)} s`;

/**
 * Checks the claims against a finished run. Not called after a crash, a stuck loop or Wi-Fi (the run
 * then says nothing about them).
 */
export function checkClaims(claims: Claim[], result: SimResult, model: ElectricalModel, run: TestRun, build: Build): { findings: Finding[]; notes: string[]; claims: CheckedClaim[] } {
  const out: Finding[] = [];
  const notes: string[] = [];
  const checked: CheckedClaim[] = [];
  const whens = whenWindows(model, run, build);
  const thens = thenWords(model);
  const findWord = <T>(map: Map<string, T>, text: string) => [...map].find(([k]) => norm(k) === norm(text));
  const lastT = result.virtualMs * MS;
  const settled = run.phases[0]!.to;

  claims.forEach((c, i) => {
    const said = `"when ${c.when.trim()}, ${c.then.trim()}"`;
    if (i >= MAX_CLAIMS) {
      checked.push({ ...c, held: null });
      notes.push(`Claim ${said} wasn't checked: only the first ${MAX_CLAIMS} are.`);
      return;
    }
    const w = findWord(whens, c.when);
    const th = findWord(thens, c.then);
    if (!w || !th) {
      checked.push({ ...c, held: null });
      notes.push(`Claim ${said} can't be checked: "${!w ? c.when : c.then}" isn't one of the words for this circuit.`);
      return;
    }
    const [whenWord, all] = w;
    const then = th[1];
    const windows = all.filter((x) => x.from < lastT).map((x) => ({ ...x, to: Math.min(x.to, lastT) }));
    if (!windows.length) {
      checked.push({ ...c, held: null });
      notes.push(`Claim ${said} can't be checked: the run didn't get to ${whenWord}.`);
      return;
    }
    const during = `while ${whenWord}`;
    let held: boolean;
    let what = "";
    if (then.kind === "frame") {
      const frames = result.events.filter((e) => e.kind === "frame" && e.a === then.ref);
      held = windows.some((x) => {
        const before = frames.filter((f) => f.t < x.from).at(-1)?.b;
        return frames.some((f) => f.t >= x.from && f.t <= x.to + 200 * MS && f.b !== before);
      });
      what = `${then.ref} showed no new picture ${during}`;
    } else {
      const s = series(result.events, then.kind, then.ref);
      const lit = (v: number) => v > 0;
      if (then.word === "on" || then.word === "off") {
        const want = then.word === "on" ? lit : (v: number) => !lit(v);
        held = windows.some((x) => {
          const from = x.ramp ? x.from : Math.min(x.from + 50 * MS, x.to);
          return timeWhere(s, from, x.to, want) >= Math.min(100 * MS, (x.to - from) / 2) && x.to > from;
        });
        const inside = windows.reduce((n, x) => n + timeWhere(s, x.from, x.to, lit), 0);
        const span = windows.reduce((n, x) => n + x.to - x.from, 0);
        const restSpan = Math.max(0, lastT - settled - span);
        const restOn = timeWhere(s, settled, lastT, lit) - inside;
        what = `${then.ref} was on ${pct(inside, span)}% of the time ${during} (${secs(span)} in all) and ${pct(restOn, restSpan)}% of the rest of the run`;
      } else if (then.word === "blinks") {
        const most = Math.max(...windows.map((x) => changes(s, x.from, x.to)));
        held = most >= 3;
        what = `${then.ref} changed at most ${most} time${most === 1 ? "" : "s"} ${during}`;
      } else {
        const compare = windows.map((x) => {
          const len = x.to - x.from;
          const start = x.ramp ? mean(s, x.from, x.from + len / 4) : mean(s, Math.max(0, x.from - 500 * MS), x.from);
          return { start, end: mean(s, x.to - len / 4, x.to) };
        });
        const up = then.word === "brighter";
        const ok = (a: number, b: number) => b > a * 1.1 + 0.05;
        held = compare.some(({ start, end }) => (up ? ok(start, end) : ok(end, start)));
        const first = compare[0]!;
        what = `${then.ref} went from ${first.start.toFixed(1)} mA to ${first.end.toFixed(1)} mA ${during}`;
      }
    }
    checked.push({ ...c, held });
    if (!held) {
      out.push({
        code: "S006",
        severity: "error",
        ref: then.ref,
        message: `The code's answer says ${said}, but in the simulator ${what}. Either the program or this claim is wrong: make them match what the project should do.`,
      });
    }
  });
  return { findings: out, notes, claims: checked };
}
