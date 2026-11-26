// BreadPilot behaviour simulator: one run in a worker thread (M18 18.7b, circuit link 18.7c).
// Loads MicroPython's WebAssembly build, writes the simulator's Python modules and the program into
// its file system, and answers the program's input reads from the circuit (solver.mjs on the
// ElectricalModel of the build, with the parts' state from the scenario). It also records what a person
// would see: each LED's current and each actuator module (buzzer, motor) as the program changes pins.
// The trace goes to the parent event by event, so a program that never gives time back still leaves
// its trace before the parent ends this thread.

import { parentPort, workerData } from "node:worker_threads";
import { loadMicroPython } from "@micropython/micropython-webassembly-pyscript";
import { DS18B20, OneWireBus, base64, dhtBytes, makeI2CChip } from "./chips.mjs";
import { devices, readAdc, readPin, scenarioTimes, solveCircuit, stateAt } from "./solver.mjs";

const { wasm, files, limitUs, inputs, model, scenario, seed } = workerData;
let now = 0;

const push = (e) => parentPort.postMessage({ type: "events", events: [e] });

/** A raw schedule's value at time t (tests and checks of single pins). */
const at = (schedule, t, fallback) => {
  let v = fallback;
  for (const [when, value] of schedule ?? []) if (when <= t) v = value;
  return v;
};

// ---- The Pico's pins as the program set them (from its own events) ----
const pins = {};
const MODES = { 0: "in", 1: "out", 2: "od", 3: "alt" };
/** The pins as the solver needs them: open-drain drives only LOW. */
const solverPins = () => {
  const out = {};
  for (const [g, p] of Object.entries(pins)) {
    if (p.mode === "od") out[g] = p.level ? { mode: "in", pull: p.pull } : { mode: "out", level: 0 };
    else out[g] = p;
  }
  return out;
};

const times = scenario ? scenarioTimes(scenario) : [];
// The circuit only changes when a scenario change passes or the program changes a pin: solutions are
// cached until then (a busy loop reading a pin would otherwise solve the circuit every few µs).
let pinsVersion = 0;
const cache = new Map();
const stateIndex = (t) => {
  let i = 0;
  while (i < times.length && times[i] <= t) i++;
  return i;
};
const solveAt = (t) => {
  const key = `${stateIndex(t)}|${pinsVersion}`;
  let s = cache.get(key);
  if (!s) {
    if (cache.size > 500) cache.clear();
    s = solveCircuit(model, stateAt(scenario, t), solverPins());
    cache.set(key, s);
  }
  return s;
};

// ---- What the program read, in 100 ms buckets (for "an input is never read"), sent with progress ----
const fresh = new Map();
const read = (key, t) => {
  const b = Math.floor(t / 100_000);
  let set = fresh.get(key);
  if (!set) fresh.set(key, (set = new Set()));
  set.add(b);
};
let lastProgress = -1;
const progress = (t, force = false) => {
  if (!force && t - lastProgress < 100_000) return;
  lastProgress = t;
  const reads = Object.fromEntries([...fresh].map(([k, set]) => [k, [...set]]));
  fresh.clear();
  parentPort.postMessage({ type: "progress", t, reads });
};

// ---- What a person would see, recorded when it changes ----
let shown = {};
let shownAt = -1;
const look = (t) => {
  if (!model) return;
  const d = devices(model, solveAt(t), solverPins());
  for (const [ref, ma] of Object.entries(d.leds)) {
    const key = `led:${ref}`;
    if (shown[key] !== ma) {
      shown[key] = ma;
      push([t, "led", ref, ma, 0]);
    }
  }
  for (const [ref, a] of Object.entries(d.actuators)) {
    const key = `act:${ref}`;
    const v = `${a.on}/${a.freq}`;
    if (shown[key] !== v) {
      shown[key] = v;
      push([t, "actuator", ref, a.on, a.freq]);
    }
  }
};
/** Scenario changes (a button pressed by the scenario) between the last look and t are looked at in order. */
const catchUp = (t) => {
  if (!model) return;
  for (const when of times) if (when > shownAt && when <= t) look(when);
  shownAt = Math.max(shownAt, t);
};

const floating = new Set();

// ---- Chips that talk (18.7d) ----
const gpioNode = (g) => model?.gpios.find((x) => x.gpio === g)?.node;
const senseAt = (t) => {
  const sensors = stateAt(scenario, t).sensors;
  return (key, fallback) => sensors[key] ?? fallback;
};
const powered = (solved, node) => (solved.volts(node) ?? 0) >= 2.0;
/** The I2C chips whose SDA and SCL legs share nets with these Pico pins, and are powered. */
const onBus = (sda, scl, t) => {
  const a = gpioNode(sda);
  const b = gpioNode(scl);
  if (!model || a === undefined || b === undefined) return [];
  const s = solveAt(t);
  return model.i2c.filter((d) => s.group(d.sda) === s.group(a) && s.group(d.scl) === s.group(b) && powered(s, d.supply));
};
const chips = new Map();
const chipOf = (dev) => {
  if (!chips.has(dev.ref)) chips.set(dev.ref, makeI2CChip(dev.type, dev.ref));
  return chips.get(dev.ref);
};
const lastFrame = new Map();
let frames = 0;
const FRAME_CAP = 3000;
const recordFrame = (t, ref, picture) => {
  const b64 = base64(picture);
  if (lastFrame.get(ref) === b64) return;
  lastFrame.set(ref, b64);
  if (++frames <= FRAME_CAP) push([t, "frame", ref, b64, 0]);
  else if (frames === FRAME_CAP + 1) push([t, "unsimulated", `more than ${FRAME_CAP} display frames (the rest not recorded)`, 0, 0]);
};
/**
 * One-wire sensors on this GPIO's line: powered, and pulled up for real (the line reads HIGH with
 * the Pico's pin released: a missing pull-up resistor means no answer, as on the board).
 */
const lineDevices = (gpio, t, types) => {
  const node = gpioNode(gpio);
  if (!model || node === undefined) return [];
  const released = { ...solverPins(), [gpio]: { mode: "in", pull: 0 } };
  const s = solveCircuit(model, stateAt(scenario, t), released);
  if ((s.volts(node) ?? 0) < model.inputHighMinV) return [];
  return model.oneWire.filter((d) => types.includes(d.type) && s.group(d.data) === s.group(node) && powered(s, d.supply));
};
const ds18 = new Map();
const buses = new Map();
const busOf = (gpio, t) => {
  const devs = lineDevices(gpio, t, ["ds18b20"]).map((d) => {
    if (!ds18.has(d.ref)) ds18.set(d.ref, new DS18B20(d.ref));
    return ds18.get(d.ref);
  });
  const key = `${gpio}:${devs.map((d) => d.ref).join(",")}`;
  if (!buses.has(key)) buses.set(key, new OneWireBus(devs));
  return buses.get(key);
};
const hexBytes = (hex) => {
  const out = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
};

const host = {
  emit: (t, kind, a, b, c) => {
    catchUp(t);
    now = t;
    push([t, kind, a, b, c]);
    if (kind === "mode" && a >= 0) pins[a] = { ...pins[a], mode: MODES[b] ?? "in", pull: c ?? 0, level: pins[a]?.level ?? 0 };
    if (kind === "out" && a >= 0) pins[a] = { ...pins[a], mode: pins[a]?.mode === "od" ? "od" : "out", level: b };
    if (kind === "pwm" && a >= 0) pins[a] = c >= 0 ? { mode: "pwm", duty: c, freq: b } : { mode: "in", pull: 0 };
    if (["mode", "out", "pwm"].includes(kind)) {
      pinsVersion++;
      look(t);
    }
    if (kind === "irq" && a >= 0) read(`irq:${a}`, t); // an interrupt handler watches the pin from now on
    progress(t);
    return 0;
  },
  time: (t) => {
    catchUp(t);
    now = t;
    progress(t);
    return 0;
  },
  /** A pin's level: a raw schedule if the run has one, else the circuit, else the pull. */
  pin_in: (gpio, t, pull) => {
    read(`pin:${gpio}`, t);
    progress(t);
    if (inputs?.pins?.[gpio]) return at(inputs.pins[gpio], t, pull === 1 ? 1 : 0);
    if (!model) return pull === 1 ? 1 : 0;
    const r = readPin(model, solveAt(t), gpio, pull);
    if (r.floating && !floating.has(gpio)) {
      floating.add(gpio);
      push([t, "floating", gpio, 0, 0]);
    }
    return r.level;
  },
  /** The next time an input can change (a scheduled pin or anything in the scenario) in (from, to]. */
  next_edge: (from, to) => {
    let best = -1;
    const consider = (when) => {
      if (when > from && when <= to && (best < 0 || when < best)) best = when;
    };
    for (const schedule of Object.values(inputs?.pins ?? {})) for (const [when] of schedule) consider(when);
    for (const when of times) consider(when);
    return best;
  },
  /** Volts on an ADC channel (0-3 = GP26-GP29, 4 = the chip's temperature sensor at 25 °C). */
  adc: (ch, t) => {
    read(`adc:${ch}`, t);
    progress(t);
    if (ch === 4) return at(inputs?.adc?.[4], t, 0.706 - (25 - 27) * 0.001721);
    if (inputs?.adc?.[ch]) return at(inputs.adc[ch], t, 0);
    if (!model) return 0;
    return readAdc(model, solveAt(t), ch).volts;
  },
  i2c_scan: (sda, scl, t) => [...new Set(onBus(sda, scl, t).map((d) => d.address))].sort((x, y) => x - y),
  /** One I2C transfer: write these bytes (hex), then read nread; -1 when nothing answers at addr. */
  i2c: (sda, scl, addr, hex, nread, t) => {
    const dev = onBus(sda, scl, t).find((d) => d.address === addr);
    const chip = dev ? chipOf(dev) : null;
    if (!chip) return -1;
    if (nread > 0) read(`i2c:${dev.ref}`, t);
    progress(t);
    const out = chip.transfer(hexBytes(hex), nread, t, senseAt(t));
    if (chip.takeFrame) {
      const picture = chip.takeFrame();
      if (picture) recordFrame(t, dev.ref, picture);
    }
    return out;
  },
  /** A DHT11/22 on this pin: its 5 bytes, or -1 (no sensor, unpowered, no pull-up, or still starting up). */
  dht: (gpio, t) => {
    read(`line:${gpio}`, t);
    const dev = lineDevices(gpio, t, ["dht11", "dht22"])[0];
    if (!dev) return -1;
    return dhtBytes(dev.type, dev.ref, t, senseAt(t)) ?? -1;
  },
  ow_reset: (gpio, t) => busOf(gpio, t).reset(t, senseAt(t)),
  ow_readbit: (gpio, t) => busOf(gpio, t).readBit(t, senseAt(t)),
  ow_readbyte: (gpio, t) => (read(`line:${gpio}`, t), busOf(gpio, t).readByte(t, senseAt(t))),
  ow_writebit: (gpio, v, t) => (busOf(gpio, t).writeBit(v), 0),
  ow_writebyte: (gpio, v, t) => (busOf(gpio, t).writeByte(v, t, senseAt(t)), 0),
};

const mp = await loadMicroPython({
  url: wasm,
  stdout: (text) => push([now, "print", text]),
  stderr: (text) => push([now, "print", text]),
  linebuffer: true,
});
mp.registerJsModule("_bphost", host);
for (const [name, text] of Object.entries(files)) mp.FS.writeFile(`/${name}`, text);

mp.runPython(`
import sys, io
sys.path.insert(0, "/")
import _bpsim, _bptime
_bpsim.limit_us = ${Number(limitUs)}
sys.modules["time"] = _bptime
sys.modules["utime"] = _bptime
# A fixed seed: the same program gives the same run (a program's own random.seed() still wins).
try:
    import random as _random
    _random.seed(${Number(seed ?? 1)})
except ImportError:
    pass
_src = open("/main.py").read()
try:
    exec(compile(_src, "main.py", "exec"), {"__name__": "__main__"})
    _bpsim.emit("end", "finished")
except _bpsim.SimEnd as _e:
    _bpsim.emit("end", str(_e))
except BaseException as _e:
    _buf = io.StringIO()
    sys.print_exception(_e, _buf)
    _bpsim.emit("error", type(_e).__name__, str(_e), _buf.getvalue())
`);
progress(now, true);
parentPort.postMessage({ type: "done" });
