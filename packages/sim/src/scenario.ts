// BreadPilot behaviour simulator: the automatic test run (M18 18.7e).
// Built from the circuit only, never from the idea: every project with the same parts gets the same
// run. After a settling time each input part is used in turn (switches pressed briefly, held and
// pressed twice; knobs swept; sensors changed one quantity at a time), then a quiet time. Each phase
// is labelled, so a finding can say what was happening.

import type { ElectricalModel } from "./circuit";
import type { Scenario } from "./run";

export interface Phase {
  /** The part the phase uses ("BTN1"), or "" for settling and the quiet end. */
  ref: string;
  /** Plain words: "BTN1 held", "POT1 turned from low to high and back". */
  label: string;
  /** Virtual time span in µs. */
  from: number;
  to: number;
}

export interface TestRun {
  scenario: Required<Scenario>;
  phases: Phase[];
  /** Total virtual seconds. */
  seconds: number;
}

const S = 1_000_000;
const SETTLE = 2 * S; // drivers start up, a DHT needs 1 s, displays initialise
const GAP = 1 * S;
const QUIET = 3 * S;

/** What each chip senses and how the run changes it: [quantity, rest value, [values in turn]]. */
export const QUANTITIES: Record<string, [string, number, number[]][]> = {
  bme280: [["temperature", 22, [30, 15]], ["humidity", 45, [80, 20]], ["pressure", 1013.25, [990]]],
  mpu6050: [["ax", 0, [0.7, -0.7]], ["gz", 0, [120]]],
  "light-sensor-bh1750": [["", 300, [5, 2000]]],
  dht11: [["temperature", 22, [30, 15]], ["humidity", 45, [80, 25]]],
  dht22: [["temperature", 22, [30, -5]], ["humidity", 45, [80, 25]]],
  ds18b20: [["temperature", 22, [30, 10]]],
};
const WORDS: Record<string, string> = { temperature: "temperature", humidity: "humidity", pressure: "pressure", ax: "tilt", gz: "turning", "": "light" };

export function testRun(model: ElectricalModel): TestRun {
  const scenario: Required<Scenario> = { switches: {}, pots: {}, sensors: {} };
  const phases: Phase[] = [{ ref: "", label: "starting up", from: 0, to: SETTLE }];
  let t = SETTLE;
  const set = (map: Record<string, [number, number][]>, key: string, at: number, v: number) => (map[key] ??= []).push([at, v]);
  const phase = (ref: string, label: string, length: number) => {
    phases.push({ ref, label, from: t, to: t + length });
    t += length;
  };

  // Switches: one per part, or each contact of a slide switch in turn.
  const byRef = new Map<string, { id: string; group?: string }[]>();
  for (const s of model.switches) byRef.set(s.ref, [...(byRef.get(s.ref) ?? []), { id: s.id, ...(s.group ? { group: s.group } : {}) }]);
  for (const [ref, contacts] of byRef) {
    if (contacts.length > 1 && contacts.every((c) => c.group)) {
      // A slide switch: one side, then the other.
      for (const c of contacts) {
        set(scenario.switches, c.id, t, 1);
        set(scenario.switches, c.id, t + 1.5 * S, 0);
        phase(ref, `${ref} slid to one side (${c.id})`, 1.5 * S + GAP);
      }
      continue;
    }
    const key = ref;
    set(scenario.switches, key, t, 1);
    set(scenario.switches, key, t + 0.2 * S, 0);
    phase(ref, `${ref} pressed briefly`, 0.2 * S + GAP);
    set(scenario.switches, key, t, 1);
    set(scenario.switches, key, t + 1.5 * S, 0);
    phase(ref, `${ref} held`, 1.5 * S + GAP);
    set(scenario.switches, key, t, 1);
    set(scenario.switches, key, t + 0.2 * S, 0);
    set(scenario.switches, key, t + 0.4 * S, 1);
    set(scenario.switches, key, t + 0.6 * S, 0);
    phase(ref, `${ref} pressed twice`, 0.6 * S + GAP);
  }

  // Knobs: low → high → low in steps.
  for (const p of model.pots) {
    const steps = 10;
    for (let i = 0; i <= steps; i++) set(scenario.pots, p.ref, t + (i * 3 * S) / steps, i / steps);
    for (let i = 1; i <= steps; i++) set(scenario.pots, p.ref, t + 3 * S + (i * 3 * S) / steps, 1 - i / steps);
    phase(p.ref, `${p.ref} turned from low to high and back`, 6 * S + GAP);
  }

  // Light- and temperature-dependent resistors.
  for (const r of model.sensorResistors) {
    const [rest, values, words] = r.kind === "ldr" ? [300, [5, 2000], ["dark", "bright"]] : [25, [40, 10], ["warm", "cold"]];
    set(scenario.sensors, r.ref, 0, rest);
    values.forEach((v, i) => {
      set(scenario.sensors, r.ref, t, v);
      phase(r.ref, `${r.ref} ${words[i]}`, 2 * S);
    });
    set(scenario.sensors, r.ref, t, rest);
    t += GAP;
  }

  // Modules with an output: triggered, then back (digital); a high reading, then back (analog).
  for (const d of model.drivers) {
    if (scenario.sensors[d.ref]) continue;
    set(scenario.sensors, d.ref, 0, 0);
    set(scenario.sensors, d.ref, t, d.kind === "digital" ? 1 : 0.8);
    set(scenario.sensors, d.ref, t + 2 * S, 0);
    phase(d.ref, d.kind === "digital" ? `${d.ref} triggered` : `${d.ref} reading high`, 2 * S + GAP);
  }

  // Chips that measure: each quantity changed in turn (held 2.5 s, longer than a DHT's 2 s between reads).
  for (const chip of [...model.i2c, ...model.oneWire]) {
    for (const [q, rest, values] of QUANTITIES[chip.type] ?? []) {
      const key = q ? `${chip.ref}.${q}` : chip.ref;
      set(scenario.sensors, key, 0, rest);
      for (const v of values) {
        set(scenario.sensors, key, t, v);
        phase(chip.ref, `${chip.ref} ${WORDS[q] ?? q} ${v}`, 2.5 * S);
      }
      set(scenario.sensors, key, t, rest);
      t += GAP;
    }
  }

  phase("", "quiet", QUIET);
  for (const map of [scenario.switches, scenario.pots, scenario.sensors]) for (const list of Object.values(map)) list.sort((a, b) => a[0] - b[0]);
  return { scenario, phases, seconds: Math.min(90, t / S) };
}
