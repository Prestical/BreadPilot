// BreadPilot behaviour simulator: running a program (M18 18.7b).
// Each run gets a fresh worker thread with its own MicroPython. The program runs on a virtual clock
// (sleep takes no real time) until it ends, crashes, reaches the virtual time limit, or uses up the
// wall-clock limit without giving time back (a loop that never sleeps): then the thread is ended.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { Build } from "@breadpilot/circuit-core";
import { electricalModel } from "./circuit";
import { ENGINE } from "./index";
import { endOf, PY_FILES, type Scenario, type SimError, type SimEvent, type SimInputs } from "./trace";

export { parseTraceback, type Scenario, type SimError, type SimEvent, type SimInputs } from "./trace";



export interface RunOptions {
  /** The program (main.py). */
  code: string;
  /** Other files next to it, e.g. a display driver: { "sh1106.py": "..." }. */
  files?: Record<string, string>;
  /** Virtual time the program may run (default 30 s). */
  virtualSeconds?: number;
  /** Real time before a run that never gives time back is stopped (default 4000 ms). */
  wallMs?: number;
  /** Raw pin/ADC schedules (single-pin checks; they win over the circuit for their pins). */
  inputs?: SimInputs;
  /** The circuit the program runs on: inputs are read from it and its LEDs and modules are recorded. */
  circuit?: Build;
  scenario?: Scenario;
  /** Seed for the random module (default 1): the same program gives the same run (18.7h). */
  seed?: number;
  /**
   * A live run (8.C3): the clock follows real time and the inputs come from this buffer, which the
   * caller changes while the program runs (live.mjs writeInput/stopLive). The scenario is then unused.
   */
  live?: { sab: SharedArrayBuffer; slots: { group: "switches" | "pots" | "sensors"; key: string }[]; speed?: number };
  /** Each batch of events as it arrives (a live run's batches; tests watch the timing). */
  onEvents?: (events: SimEvent[]) => void;
}



export interface SimResult {
  /** finished, time limit, reset, soft reset, bootloader, deep sleep, error, or wall limit (never gave time back). */
  ended: string;
  error?: SimError;
  events: SimEvent[];
  /** Lines the program printed. */
  prints: string[];
  /** Virtual time reached. */
  virtualMs: number;
  wallMs: number;
  /**
   * What the program read: "pin:<gpio>", "adc:<ch>", "i2c:<ref>", "line:<gpio>" (DHT/one-wire),
   * "irq:<gpio>" (an interrupt handler set up) -> the 100 ms buckets it happened in.
   */
  reads: Record<string, number[]>;
  /** For a wall-limit end: true when virtual time stopped moving (a loop that reads nothing and never sleeps). */
  stuck: boolean;
}

/**
 * Where the worker and the Python files are: next to this file in the source tree, or in a "sim"
 * folder next to the API bundle (apps/api/build.mjs copies them there; the app ships them in engine/sim).
 */
const here = (() => {
  const dir = dirname(fileURLToPath(import.meta.url));
  return existsSync(join(dir, "worker.mjs")) ? dir : join(dir, "sim");
})();
let python: Record<string, string> | undefined;
/**
 * The simulator's modules, and the modules frozen into the Pico 2 W firmware (py/frozen: the real
 * dht.py, and stand-ins for the networking modules, which act as a Pico without a Wi-Fi connection).
 */
const pythonFiles = () =>
  (python ??= Object.fromEntries([
    ...PY_FILES.map((f) => [f, readFileSync(join(here, "py", f), "utf8")]),
    ...readdirSync(join(here, "py", "frozen")).filter((f) => f.endsWith(".py")).map((f) => [f, readFileSync(join(here, "py", "frozen", f), "utf8")]),
  ]));
const wasmPath = () => join(dirname(createRequire(import.meta.url).resolve(ENGINE.package)), ENGINE.wasm);



export function runProgram(opts: RunOptions): Promise<SimResult> {
  const started = performance.now();
  const limitUs = Math.round((opts.virtualSeconds ?? 30) * 1_000_000);
  const events: SimEvent[] = [];
  const reads = new Map<string, Set<number>>();
  let progressT = 0;
  let progressWall = performance.now();
  const worker = new Worker(join(here, "worker.mjs"), {
    workerData: {
      wasm: wasmPath(),
      files: { ...pythonFiles(), ...opts.files, "main.py": opts.code },
      limitUs,
      inputs: opts.inputs ?? {},
      model: opts.circuit ? electricalModel(opts.circuit) : undefined,
      scenario: opts.scenario ?? {},
      seed: opts.seed ?? 1,
      ...(opts.live ? { live: { sab: opts.live.sab, slots: opts.live.slots.map(({ group, key }) => ({ group, key })), speed: opts.live.speed ?? 1 } } : {}),
    },
  });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ended: string, error?: SimError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      const last = Math.max(events.at(-1)?.t ?? 0, progressT);
      resolve({
        ended,
        ...(error ? { error } : {}),
        events,
        prints: events.filter((e) => e.kind === "print").map((e) => String(e.a)),
        virtualMs: Math.round(last / 1000),
        wallMs: Math.round(performance.now() - started),
        reads: Object.fromEntries([...reads].map(([k, set]) => [k, [...set].sort((a, b) => a - b)])),
        stuck: ended === "wall limit" && performance.now() - progressWall > 1000,
      });
    };
    const timer = setTimeout(() => finish("wall limit"), opts.wallMs ?? 4000);
    worker.on("message", (msg: { type: string; t?: number; reads?: Record<string, number[]>; events?: [number, string, unknown, unknown, unknown][] }) => {
      if (msg.type === "progress") {
        if (msg.t! > progressT) {
          progressT = msg.t!;
          progressWall = performance.now();
        }
        for (const [k, list] of Object.entries(msg.reads ?? {})) {
          const set = reads.get(k) ?? new Set<number>();
          for (const b of list) set.add(b);
          reads.set(k, set);
        }
        return;
      }
      if (msg.type === "events") {
        const batch = msg.events!.map(([t, kind, a, b, c]) => ({ t, kind, a, b, c }));
        events.push(...batch);
        opts.onEvents?.(batch);
        return;
      }
      if (msg.type !== "done") return;
      const end = endOf(events);
      finish(end.ended, end.error);
    });
    worker.on("error", (err) => finish("error", { type: "SimulatorError", message: err.message, traceback: String(err.stack ?? err) }));
  });
}
