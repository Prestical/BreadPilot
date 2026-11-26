// BreadPilot behaviour simulator: a live run (M8 8.C3a, the screen preview in the Code tab).
// The pipeline's runs fast-forward a virtual clock through a scenario. A live run ties the clock to
// real time and reads its inputs from a SharedArrayBuffer the page writes while the program runs:
//
//   Int32 [0]  input version: the page adds 1 after changing values (and calls Atomics.notify)
//   Int32 [1]  stop: 1 = end the run at the next time query
//   Float64 from byte 16: one value per input slot, in the order of `slots` (inputSlots())
//
// While the program sleeps, the worker waits on the version with Atomics.wait, so a press reaches the
// program at once, even inside time.sleep(). Works the same in a Node worker thread (tests) and a
// browser Web Worker (the page must be cross-origin isolated for SharedArrayBuffer).

/** Bytes a live buffer needs for this many input slots. */
export const liveBytes = (slots) => 16 + 8 * slots;

/** How far behind real time a run may fall before its clock moves on instead of catching up (ms). */
const CATCH_UP_MS = 250;

/**
 * slots: [{ group: "switches" | "pots" | "sensors", key }] in buffer order.
 * speed: virtual seconds per real second (1 = real time).
 */
export function createLive({ sab, slots, speed = 1 }) {
  const ctl = new Int32Array(sab, 0, 4);
  const values = new Float64Array(sab, 16, slots.length);
  let t0 = null; // real ms at virtual 0
  let seen = -1;
  let state = { switches: {}, pots: {}, sensors: {} };
  let behindMs = 0;
  const now = () => performance.now();
  const start = () => {
    if (t0 === null) t0 = now();
  };
  return {
    version: () => Atomics.load(ctl, 0),
    stopped: () => Atomics.load(ctl, 1) !== 0,
    /** The parts' state as the page set it (rebuilt only when the version changes). */
    state() {
      const v = Atomics.load(ctl, 0);
      if (v !== seen) {
        seen = v;
        state = { switches: {}, pots: {}, sensors: {} };
        slots.forEach((s, i) => {
          state[s.group][s.key] = values[i];
        });
      }
      return state;
    },
    /** Virtual time (µs) that real time has reached. */
    virtualNow() {
      start();
      return Math.max(0, Math.round((now() - t0) * 1000 * speed));
    },
    /**
     * Waits until virtual time t (µs) is due in real time. Returns "due", "stop", or (with
     * wakeOnInput) "input" when the page changed an input first. A run that has fallen more than
     * CATCH_UP_MS behind moves its clock on instead of rushing to catch up (the Pico wouldn't).
     */
    pace(t, wakeOnInput = false) {
      start();
      const from = Atomics.load(ctl, 0);
      for (;;) {
        if (Atomics.load(ctl, 1)) return "stop";
        const v = Atomics.load(ctl, 0);
        if (wakeOnInput && v !== from) return "input";
        const left = t0 + t / 1000 / speed - now();
        if (left <= 0) {
          if (-left > CATCH_UP_MS) {
            t0 += -left;
            behindMs += -left;
          }
          return "due";
        }
        Atomics.wait(ctl, 0, v, left);
      }
    },
    /** Real milliseconds the run has fallen behind so far (0 = it keeps up). */
    behind: () => Math.round(behindMs),
  };
}

/** For the page: set one slot, or ask the run to stop. */
export function writeInput(sab, index, value) {
  const ctl = new Int32Array(sab, 0, 4);
  new Float64Array(sab, 16)[index] = value;
  Atomics.add(ctl, 0, 1);
  Atomics.notify(ctl, 0);
}
export function stopLive(sab) {
  const ctl = new Int32Array(sab, 0, 4);
  Atomics.store(ctl, 1, 1);
  Atomics.add(ctl, 0, 1);
  Atomics.notify(ctl, 0);
}
