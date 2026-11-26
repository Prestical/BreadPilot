/// <reference types="vite/client" />
// BreadPilot behaviour simulator in the page (M8 8.C3a): starts a live run of a program on its
// circuit in a Web Worker, for the Code tab's preview. Same core, Python modules, circuit link and
// chips as the pipeline's checks (core.mjs); only the transport and the clock differ: the clock follows
// real time and the page changes the inputs while the program runs (live.mjs).
//
// The page must be cross-origin isolated (SharedArrayBuffer): the app's server and the Vite dev server
// send Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy. Imported only from the preview, so
// MicroPython's WebAssembly (about 2.3 MB) loads when the preview is opened, not with the page.

import type { Build } from "@breadpilot/circuit-core";
import wasmUrl from "@micropython/micropython-webassembly-pyscript/micropython.wasm?url";
import { electricalModel } from "./circuit";
import { liveBytes, stopLive, writeInput } from "./live.mjs";
import { inputSlots, ledFullMa, type InputSlot } from "./preview";
import { endOf, type SimError, type SimEvent } from "./trace";

export { electricalModel, type ElectricalModel } from "./circuit";
export { applyEvents, emptyPreview, framePixels, inputSlots, ledFullMa, type InputSlot, type PreviewState } from "./preview";
export type { SimError, SimEvent } from "./trace";

/** The simulator's Python modules and the firmware's frozen ones, by file name (as the Node runner loads them). */
const PYTHON: Record<string, string> = Object.fromEntries(
  Object.entries(import.meta.glob("./py/**/*.py", { query: "?raw", import: "default", eager: true }) as Record<string, string>).map(([path, text]) => [path.split("/").at(-1)!, text]),
);

/** A live run lasts at most this long (virtual = real time). */
const LIMIT_US = 6 * 3600 * 1_000_000;
/** After Stop, a program that never asks the time (a loop without sleep) is ended this much later. */
const STOP_GRACE_MS = 500;

export interface PreviewOptions {
  code: string;
  circuit: Build;
  /** The drivers the build needs ({ "sh1106.py": "..." }). */
  files?: Record<string, string>;
  /** What changed, about 30 times a second: led, actuator, frame (the newest per display), print, … (applyEvents). */
  onEvents?: (events: SimEvent[]) => void;
  /** How the run ended: finished, stopped, error (with its main.py line), time limit. */
  onEnd?: (end: { ended: string; error?: SimError }) => void;
}

export interface Preview {
  /** What a person can change while it runs (switches, knobs, sensors), with their start values. */
  slots: InputSlot[];
  /** Each LED's current when fully on (mA): brightness = its current / this. */
  ledFull: Record<string, number>;
  /** Sets slot i (a switch: 1 = closed; a knob: 0-1; a sensor: its quantity). */
  set(index: number, value: number): void;
  /** Ends the run at its next time query (or a moment later for a loop that never asks). */
  stop(): void;
}

/** Whether this page can run the preview (cross-origin isolated, so SharedArrayBuffer exists). */
export const previewAvailable = () => typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated === true;

export function startPreview(opts: PreviewOptions): Preview {
  if (!previewAvailable()) throw new Error("The preview needs a cross-origin isolated page (SharedArrayBuffer).");
  const model = electricalModel(opts.circuit);
  const slots = inputSlots(model);
  const sab = new SharedArrayBuffer(liveBytes(slots.length));
  const values = new Float64Array(sab, 16);
  slots.forEach((s, i) => (values[i] = s.value));

  const worker = new Worker(new URL("./browser-worker.mjs", import.meta.url), { type: "module" });
  const events: SimEvent[] = [];
  let over = false;
  const finish = (end: { ended: string; error?: SimError }) => {
    if (over) return;
    over = true;
    worker.terminate();
    opts.onEnd?.(end);
  };
  worker.onmessage = (msg: MessageEvent<{ type: string; events?: [number, string, unknown, unknown, unknown][] }>) => {
    if (msg.data.type === "events") {
      const batch = msg.data.events!.map(([t, kind, a, b, c]) => ({ t, kind, a, b, c }));
      for (const e of batch) if (e.kind === "end" || e.kind === "error") events.push(e);
      opts.onEvents?.(batch);
    } else if (msg.data.type === "done") finish(endOf(events));
  };
  worker.onerror = (err) => finish({ ended: "error", error: { type: "SimulatorError", message: err.message, traceback: String(err.message) } });
  worker.postMessage({
    wasm: wasmUrl,
    files: { ...PYTHON, ...opts.files, "main.py": opts.code },
    limitUs: LIMIT_US,
    inputs: {},
    model,
    scenario: {},
    // The Pico seeds random from its hardware: each run differs, like on the board.
    seed: Math.floor(Math.random() * 2 ** 30),
    live: { sab, slots: slots.map(({ group, key }) => ({ group, key })), speed: 1 },
  });

  return {
    slots,
    ledFull: ledFullMa(model),
    set: (index, value) => writeInput(sab, index, value),
    stop() {
      stopLive(sab);
      setTimeout(() => finish({ ended: "stopped" }), STOP_GRACE_MS);
    },
  };
}
