// BreadPilot behaviour simulator: findings from a test run (M18 18.7e).
// General rules over the trace, the reads and the circuit (never about one project):
//   S001 error    the program crashed (the error, its main.py line, when and during what)
//   S002 warning  it stopped giving time back: a loop that never sleeps and reads nothing
//   S003 warning  nothing reacts to the inputs: no LED, module or display changes while they are used
//   S004 warning  an input part is never read while the run uses it
//   S005 warning  a display never shows anything
//   S006 error    a claim in the code's answer didn't happen (claims.ts, 18.7g)
// After S001 or S002 nothing else is reported (the rest would follow from it). Findings never come
// from how a float prints (the Pico uses single-precision floats, the simulator double: PLAN 18.7).

import type { ElectricalModel } from "./circuit";
import type { SimResult } from "./run";
import type { Phase, TestRun } from "./scenario";
import { solveCircuit } from "./solver.mjs";

export interface Finding {
  code: "S001" | "S002" | "S003" | "S004" | "S005" | "S006";
  severity: "error" | "warning";
  message: string;
  /** main.py line, for S001. */
  line?: number;
  /** The part it is about. */
  ref?: string;
}

const BUCKET = 100_000;
const secs = (us: number) => `${(us / 1_000_000).toFixed(1)} s`;

/** The phase running at time t (for "while BTN1 was held"). */
const phaseAt = (run: TestRun, t: number): Phase | undefined => run.phases.find((p) => p.from <= t && t < p.to);

export function findings(result: SimResult, model: ElectricalModel, run: TestRun, code: string): { findings: Finding[]; notes: string[] } {
  const out: Finding[] = [];
  const notes: string[] = [];
  const lastT = result.virtualMs * 1000;

  // S001: a crash.
  if (result.ended === "error" && result.error) {
    const e = result.error;
    const t = result.events.filter((x) => x.kind === "error").at(-1)?.t ?? lastT;
    const during = phaseAt(run, t);
    const src = e.line ? code.split("\n")[e.line - 1]?.trim() : undefined;
    out.push({
      code: "S001",
      severity: "error",
      message:
        `The program stops with ${e.type}: ${e.message}` +
        (e.line ? ` on line ${e.line}${src ? ` (${src})` : ""}` : "") +
        (e.at ? `, inside ${e.at.file} line ${e.at.line}` : "") +
        ` after ${secs(t)}${during && during.ref ? `, while ${during.label}` : ""}. On the Pico it stops there the same way.`,
      ...(e.line ? { line: e.line } : {}),
    });
    return { findings: out, notes };
  }
  // S002: no time given back.
  if (result.ended === "wall limit") {
    if (result.stuck) {
      out.push({
        code: "S002",
        severity: "warning",
        message: `From about ${secs(lastT)} the program never gives time back: a loop runs without time.sleep() and without reading any pin, so nothing else happens (inputs and the display freeze). If it waits for an interrupt, add time.sleep_ms(10) inside that loop.`,
      });
      return { findings: out, notes };
    }
    notes.push(`The run was only simulated up to ${secs(lastT)} of ${run.seconds} s (the program is slow to simulate); later inputs weren't tried.`);
  }
  if (result.ended === "finished" && lastT < run.phases.at(-1)!.from) notes.push(`The program ended by itself after ${secs(lastT)}, before the test run was over.`);
  for (const n of new Set(result.events.filter((e) => e.kind === "unsimulated").map((e) => String(e.a)))) notes.push(`Not simulated: ${n}.`);
  // A program that uses Wi-Fi may wait for a connection the simulator never gives: what it would do
  // after it isn't known, so findings about inputs and outputs aren't reported.
  if (result.events.some((e) => e.kind === "unsimulated" && String(e.a).startsWith("network"))) {
    notes.push("The program uses Wi-Fi, which isn't simulated, so its inputs and outputs aren't checked.");
    return { findings: out, notes };
  }

  // Which Pico pins belong to which part: the nets with every switch open.
  const rest = solveCircuit(model, { switches: {}, pots: {}, sensors: {} }, {});
  const pinsAt = (...nodes: number[]) => model.gpios.filter((g) => nodes.some((n) => rest.group(n) === rest.group(g.node))).map((g) => g.gpio);
  const viaResistor = (node: number) => {
    const g = rest.group(node);
    const others = model.resistors.flatMap((r) => (rest.group(r.a) === g ? [r.b] : rest.group(r.b) === g ? [r.a] : []));
    return pinsAt(node, ...others);
  };
  const setUp = (gpio: number) => result.events.some((e) => (e.kind === "mode" || e.kind === "pwm" || e.kind === "out") && e.a === gpio);

  // The keys each input part is read through.
  const inputs: { ref: string; keys: string[] }[] = [];
  const adcKeys = (gpios: number[]) => gpios.filter((g) => g >= 26 && g <= 29).map((g) => `adc:${g - 26}`);
  const switchRefs = new Set(model.switches.map((s) => s.ref));
  for (const ref of switchRefs) {
    const nodes = model.switches.filter((s) => s.ref === ref).flatMap((s) => [s.a, s.b]);
    const gpios = pinsAt(...nodes);
    inputs.push({ ref, keys: gpios.flatMap((g) => [`pin:${g}`, `irq:${g}`]) });
  }
  for (const p of model.pots) inputs.push({ ref: p.ref, keys: adcKeys(pinsAt(p.wiper)) });
  for (const r of model.sensorResistors) inputs.push({ ref: r.ref, keys: adcKeys(pinsAt(r.a, r.b)) });
  for (const d of model.drivers) inputs.push({ ref: d.ref, keys: pinsAt(d.node).flatMap((g) => [`pin:${g}`, `irq:${g}`, ...adcKeys([g])]) });
  for (const c of model.i2c) if (!c.type.startsWith("oled")) inputs.push({ ref: c.ref, keys: [`i2c:${c.ref}`] });
  for (const w of model.oneWire) inputs.push({ ref: w.ref, keys: pinsAt(w.data).map((g) => `line:${g}`) });

  // S004: an input part not read while the run uses it (a part wired to no Pico pin is the checks' job).
  for (const input of inputs) {
    const windows = run.phases.filter((p) => p.ref === input.ref && p.from < lastT);
    if (!windows.length || !input.keys.length) continue;
    const watched = input.keys.some((k) => {
      const buckets = result.reads[k] ?? [];
      if (k.startsWith("irq:")) return buckets.some((b) => b * BUCKET <= windows.at(-1)!.to);
      return windows.some((w) => buckets.some((b) => b >= Math.floor(w.from / BUCKET) && b <= Math.floor(w.to / BUCKET)));
    });
    if (!watched) {
      const span = `${secs(windows[0]!.from)}-${secs(windows.at(-1)!.to)}`;
      out.push({ code: "S004", severity: "warning", ref: input.ref, message: `${input.ref} is never read while the test uses it (${windows.map((w) => w.label).join(", ")}; ${span}): the program doesn't look at it then, so using it does nothing.` });
    }
  }

  // S003: nothing reacts to the inputs. Only when no LED, module or display changes while any input is
  // used: an output that reacts only to one sequence (a lock's "open" LED) is beyond a general test
  // run, so single quiet outputs are not reported while something else reacts.
  const used = [...new Set(run.phases.filter((p) => p.ref).map((p) => p.ref))];
  const inputTime = (t: number) => run.phases.some((p) => p.ref && p.from <= t && t < p.to + 1_000_000);
  const reacted = result.events.some((e) => (e.kind === "led" || e.kind === "actuator" || e.kind === "frame") && inputTime(e.t));
  if (used.length && !reacted) {
    const after = run.phases[0]!.to;
    const series = (kind: string, ref: string) => result.events.filter((e) => e.kind === kind && e.a === ref);
    const stays = (list: { t: number; b?: unknown }[]) => {
      const before = list.filter((e) => e.t <= after).at(-1);
      const values = [...(before ? [before] : []), ...list.filter((e) => e.t > after)].map((e) => Number(e.b) > 0);
      return values.length && values.every((v) => v === values[0]) ? (values[0] ? "on" : "off") : null;
    };
    for (const led of model.leds) {
      if (!viaResistor(led.anode).concat(viaResistor(led.cathode)).some(setUp)) continue;
      const s = stays(series("led", led.ref));
      if (s) out.push({ code: "S003", severity: "warning", ref: led.ref, message: `${led.ref} stays ${s} the whole run, while the test used ${used.join(", ")}: nothing the program reads changes it.` });
    }
    for (const a of model.actuators) {
      if (!pinsAt(a.node).some(setUp)) continue;
      const list = series("actuator", a.ref);
      const s = stays(list);
      // A passive buzzer makes a sound only with a tone (PWM); held on without one it is silent while
      // current flows through it (18.7i: "stays on" read as beeping).
      const toneless = a.name === "passive-buzzer" && s === "on" && list.every((e) => !Number(e.c));
      const state = toneless ? "held on with no tone (silent, while current flows through it)" : s === "on" ? "on" : "silent/off";
      if (s) out.push({ code: "S003", severity: "warning", ref: a.ref, message: `${a.ref} stays ${state} the whole run, while the test used ${used.join(", ")}: nothing the program reads changes it.` });
    }
  }

  // S005: a display that never shows anything.
  for (const c of model.i2c.filter((x) => x.type.startsWith("oled"))) {
    const frames = result.events.filter((e) => e.kind === "frame" && e.a === c.ref);
    const shown = frames.some((f) => /[^A]/.test(String(f.b).replace(/=+$/, "")));
    if (!shown) {
      out.push({
        code: "S005",
        severity: "warning",
        ref: c.ref,
        message: frames.length
          ? `${c.ref} stays blank the whole run: the program sets it up but never shows anything on it (draw, then call show()).`
          : `${c.ref} never gets a picture: the program doesn't send anything to it.`,
      });
    }
  }
  return { findings: out, notes };
}
