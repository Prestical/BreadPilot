// M8 8.C3a: a live run (the Code tab's preview) in a Node worker thread: the clock follows real time,
// inputs the caller writes reach the program at once (even inside time.sleep()), and a stop ends it.
// 8.C3b: what the page shows (LEDs, displays, prints) arrives in batches while the program runs.
// Timing tolerances are loose on purpose: test machines are busy.

import { driversFor, layoutProject } from "@breadpilot/circuit-core";
import { describe, expect, it } from "vitest";
import { electricalModel } from "../src/circuit";
import { applyEvents, emptyPreview, framePixels, inputSlots, ledFullMa, liveBytes, runProgram, stopLive, writeInput, type SimEvent } from "../src/index";

/**
 * Tests that depend on real-time timing (a press within 300 ms, a run of about 1.5 s) run on the
 * developer's computer but not on GitHub's shared machines (CI=true), which can be slow enough to fail
 * them while nothing is wrong (26/11/2026). The live runner is the same code the pipeline tests run.
 */
const timed = process.env.CI ? it.skip : it;

const circuit = layoutProject([{ kind: "led", pin: "GP16" }, { kind: "button", pin: "GP17" }, { kind: "pot", pin: "GP26" }]).build;
const slots = inputSlots(electricalModel(circuit));

/** A live run of `code`, with `drive` changing inputs or stopping it while it runs. */
async function live(code: string, seconds: number, drive: (sab: SharedArrayBuffer, index: (key: string) => number) => void, on = circuit, batches: { at: number; events: SimEvent[] }[] = []) {
  const slots = inputSlots(electricalModel(on));
  const sab = new SharedArrayBuffer(liveBytes(slots.length));
  const values = new Float64Array(sab, 16);
  slots.forEach((s, i) => (values[i] = s.value));
  const index = (key: string) => slots.findIndex((s) => s.key === key);
  const started = performance.now();
  const files = Object.fromEntries(driversFor(on.parts.map((p) => p.type)).map((d) => [d.file, d.source]));
  const run = runProgram({ code: `from machine import Pin, ADC, PWM, I2C\nimport time\n${code}`, circuit: on, files, virtualSeconds: seconds, wallMs: seconds * 1000 + 5000, live: { sab, slots }, onEvents: (events) => batches.push({ at: performance.now() - started, events }) });
  drive(sab, index);
  const result = await run;
  return { ...result, took: performance.now() - started };
}

describe("a live run", () => {
  it("has the circuit's inputs, at rest: switches open, knobs in the middle", () => {
    expect(slots.map((s) => [s.group, s.key, s.value])).toEqual([
      ["switches", "BTN1", 0],
      ["pots", "POT1", 0.5],
    ]);
  });

  timed("follows real time: a 1 s blink loop takes about 1.5 s for 1.5 virtual seconds", async () => {
    const r = await live("led = Pin(16, Pin.OUT)\nwhile True:\n    led.toggle()\n    time.sleep(0.25)\n", 1.5, () => {});
    expect(r.ended).toBe("time limit");
    // The worker and MicroPython take a moment to load before the clock starts.
    expect(r.took).toBeGreaterThan(1400);
    expect(r.took).toBeLessThan(4000);
    const lit = r.events.filter((e) => e.kind === "led" && e.a === "LED1").length;
    expect(lit).toBeGreaterThanOrEqual(5);
  });

  timed("a press reaches an interrupt handler at once, while the program sleeps for 5 s", async () => {
    const pressAt = 600;
    const r = await live(
      "def pressed(p):\n    print('pressed', time.ticks_ms())\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nb.irq(pressed, Pin.IRQ_FALLING)\ntime.sleep(5)\n",
      6,
      (sab, index) => {
        setTimeout(() => writeInput(sab, index("BTN1"), 1), pressAt);
        setTimeout(() => stopLive(sab), pressAt + 400);
      },
    );
    expect(r.ended).toBe("stopped");
    const line = r.prints.find((p) => p.startsWith("pressed"));
    expect(line).toBeDefined();
    // The handler ran on the press, long before the 5 s sleep ended.
    expect(Number(line!.split(" ")[1])).toBeLessThan(pressAt + 300);
    expect(r.took).toBeLessThan(pressAt + 2500);
  });

  timed("a polling loop sees the button and the knob as they are set", async () => {
    const r = await live(
      "led = PWM(Pin(16))\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nk = ADC(26)\nwas = None\nwhile True:\n    now = (b.value(), k.read_u16() > 50000)\n    if now != was:\n        print(now)\n        was = now\n    time.sleep(0.02)\n",
      3,
      (sab, index) => {
        setTimeout(() => writeInput(sab, index("BTN1"), 1), 300);
        setTimeout(() => writeInput(sab, index("POT1"), 1), 600);
        setTimeout(() => stopLive(sab), 900);
      },
    );
    expect(r.ended).toBe("stopped");
    expect(r.prints).toEqual(["(1, False)", "(0, False)", "(0, True)"]);
  });

  timed("stop ends a long sleep at once", async () => {
    const r = await live("time.sleep(30)\n", 60, (sab) => setTimeout(() => stopLive(sab), 300));
    expect(r.ended).toBe("stopped");
    expect(r.took).toBeLessThan(2500);
  });
});

describe("what the page shows (8.C3b)", () => {
  /** The preview state from the batches that arrived before `ms` of real time. */
  const stateAt = (batches: { at: number; events: SimEvent[] }[], ms: number) => batches.filter((b) => b.at <= ms).reduce((st, b) => applyEvents(st, b.events), emptyPreview());

  it("each LED's full-on current comes from the circuit", () => {
    expect(ledFullMa(electricalModel(circuit))).toEqual({ LED1: 3.94 });
  });

  timed("a press lights the LED, and the knob sets its brightness", async () => {
    const batches: { at: number; events: SimEvent[] }[] = [];
    const r = await live(
      "led = PWM(Pin(16), freq=1000)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nk = ADC(26)\nwhile True:\n    led.duty_u16(k.read_u16() if b.value() == 0 else 0)\n    time.sleep(0.02)\n",
      4,
      (sab, index) => {
        setTimeout(() => writeInput(sab, index("BTN1"), 1), 400);
        setTimeout(() => writeInput(sab, index("POT1"), 1), 900);
        setTimeout(() => writeInput(sab, index("BTN1"), 0), 1400);
        setTimeout(() => stopLive(sab), 1900);
      },
      circuit,
      batches,
    );
    expect(r.ended).toBe("stopped");
    const full = 3.94;
    expect(stateAt(batches, 380).leds.LED1 ?? 0).toBe(0);
    expect(stateAt(batches, 850).leds.LED1! / full).toBeCloseTo(0.5, 1);
    expect(stateAt(batches, 1350).leds.LED1! / full).toBeCloseTo(1, 1);
    expect(stateAt(batches, 1850).leds.LED1).toBe(0);
  });

  timed("only what the page shows is sent, in batches, and a print arrives while the program sleeps", async () => {
    const batches: { at: number; events: SimEvent[] }[] = [];
    const r = await live("led = Pin(16, Pin.OUT)\nfor i in range(50):\n    led.toggle()\nprint('hello')\ntime.sleep(5)\n", 6, (sab) => setTimeout(() => stopLive(sab), 1200), circuit, batches);
    expect(r.ended).toBe("stopped");
    const kinds = new Set(batches.flatMap((b) => b.events.map((e) => e.kind)));
    expect([...kinds].sort()).toEqual(["end", "led", "print"]);
    const hello = batches.find((b) => b.events.some((e) => e.kind === "print"))!;
    expect(hello.at).toBeLessThan(1100); // before the stop: it didn't wait for the 5 s sleep to end
    expect(batches.length).toBeLessThan(10); // 50 toggles and a print: a few batches, not 50 messages
  });

  timed("the display's newest picture, decoded pixel by pixel", async () => {
    const oled = layoutProject([{ kind: "oled" }]).build;
    const pin = (end: string) => Object.entries(oled.gpioModes).find(([, m]) => m.endsWith(end))![0].slice(2);
    const batches: { at: number; events: SimEvent[] }[] = [];
    const r = await live(
      `from sh1106 import SH1106_I2C\noled = SH1106_I2C(128, 64, I2C(0, sda=Pin(${pin("_sda")}), scl=Pin(${pin("_scl")})))\nfor n in range(1, 4):\n    oled.fill(0)\n    oled.fill_rect(0, 0, n * 2, 4, 1)\n    oled.show()\n    time.sleep(0.1)\ntime.sleep(5)\n`,
      6,
      (sab) => setTimeout(() => stopLive(sab), 1500),
      oled,
      batches,
    );
    expect(r.ended).toBe("stopped");
    for (const b of batches) expect(b.events.filter((e) => e.kind === "frame").length).toBeLessThanOrEqual(1);
    const st = stateAt(batches, 1e9);
    const px = framePixels(st.frames.OLED1!);
    const lit = [...px.keys()].filter((i) => px[i]);
    // The last picture: a 6 × 4 block in the top-left corner.
    expect(lit.length).toBe(24);
    expect(lit.every((i) => i % 128 < 6 && Math.floor(i / 128) < 4)).toBe(true);
  });
});

