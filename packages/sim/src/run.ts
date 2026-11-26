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

/** What inputs read over virtual time: [[t_us, value], ...] per GPIO (0/1) and per ADC channel (volts). */
export interface SimInputs {
  pins?: Record<number, [number, number][]>;
  adc?: Record<number, [number, number][]>;
}

/**
 * What the parts do over virtual time, in the circuit's own terms: [[t_us, value], ...] per switch
 * ("BTN1", or one contact "SW1#1"; 1 = closed), per knob (position 0-1 from end2 to end1), and per
 * sensor (an LDR's lux, an NTC's °C, a module's 1 = triggered / 0, or an analog module's 0-1).
 */
export interface Scenario {
  switches?: Record<string, [number, number][]>;
  pots?: Record<string, [number, number][]>;
  sensors?: Record<string, [number, number][]>;
}

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
}

/** One trace entry: virtual time in µs, what happened, and up to three values. */
export interface SimEvent {
  t: number;
  kind: string;
  a?: unknown;
  b?: unknown;
  c?: unknown;
}

export interface SimError {
  type: string;
  message: string;
  /** The line in main.py where it happened (the innermost main.py line of the traceback). */
  line?: number;
  /** The innermost file and line, when it happened inside a driver. */
  at?: { file: string; line: number };
  traceback: string;
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
const PY_FILES = ["_bpsim.py", "_bptime.py", "machine.py", "_onewire.py"];
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

/**
 * The simulator's own files stand for C code in the firmware (machine, time) or for modules it only
 * imitates (the networking stand-ins), so an error is never reported as happening inside them; the
 * firmware's real Python modules (dht.py) and the project's drivers are reported.
 */
const SIMULATOR_FILES = new Set([...PY_FILES, "network.py", "socket.py", "ssl.py", "ntptime.py", "requests.py", "urequests.py", "mip.py", "webrepl.py", "<stdin>"]);

/** The error's main.py line and innermost file/line, from MicroPython's traceback text. */
export function parseTraceback(type: string, message: string, traceback: string): SimError {
  const frames = [...traceback.matchAll(/File "([^"]+)", line (\d+)/g)]
    .map((m) => ({ file: m[1]!.replace(/^\/+/, ""), line: Number(m[2]) }))
    .filter((f) => !SIMULATOR_FILES.has(f.file));
  const main = frames.filter((f) => f.file === "main.py").at(-1);
  const inner = frames.at(-1);
  return { type, message, traceback, ...(main ? { line: main.line } : {}), ...(inner && inner.file !== "main.py" ? { at: inner } : {}) };
}

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
        for (const [t, kind, a, b, c] of msg.events!) events.push({ t, kind, a, b, c });
        return;
      }
      if (msg.type !== "done") return;
      const end = [...events].reverse().find((e) => e.kind === "end" || e.kind === "error");
      if (end?.kind === "error") finish("error", parseTraceback(String(end.a), String(end.b), String(end.c)));
      else finish(String(end?.a ?? "finished"));
    });
    worker.on("error", (err) => finish("error", { type: "SimulatorError", message: err.message, traceback: String(err.stack ?? err) }));
  });
}
