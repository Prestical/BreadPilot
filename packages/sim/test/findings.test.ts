// M18 18.7e: the automatic test run and its findings. One known-bad program per finding, and
// known-good programs (including the false alarms found on the user's saved projects) with none.

import { driversFor, layoutProject, type BlockRequest } from "@breadpilot/circuit-core";
import { describe, expect, it } from "vitest";
import { electricalModel } from "../src/circuit";
import { checkBehaviour, testRun } from "../src/index";

const check = (kinds: BlockRequest[], code: string, wallMs?: number) => {
  const circuit = layoutProject(kinds).build;
  const files = Object.fromEntries(driversFor(circuit.parts.map((p) => p.type)).map((d) => [d.file, d.source]));
  return checkBehaviour({ code: `from machine import Pin, PWM, ADC, I2C\nimport time\n${code}`, circuit, files, ...(wallMs ? { wallMs } : {}) });
};
const codes = async (kinds: BlockRequest[], code: string, wallMs?: number) => (await check(kinds, code, wallMs)).findings.map((f) => f.code);
const LED_BTN: BlockRequest[] = [{ kind: "led", pin: "GP16" }, { kind: "button", pin: "GP17" }];
const OLED = [{ kind: "oled" }] as BlockRequest[];
const oledSetup = () => {
  const c = layoutProject(OLED).build;
  const sda = Object.entries(c.gpioModes).find(([, m]) => m.endsWith("_sda"))![0].slice(2);
  const scl = Object.entries(c.gpioModes).find(([, m]) => m.endsWith("_scl"))![0].slice(2);
  return `from sh1106 import SH1106_I2C\noled = SH1106_I2C(128, 64, I2C(0, sda=Pin(${sda}), scl=Pin(${scl})))\n`;
};

describe("the automatic test run (from the circuit only)", () => {
  it("settles, presses each button briefly, holds it, presses it twice, sweeps each knob, then is quiet", () => {
    const run = testRun(electricalModel(layoutProject([{ kind: "button" }, { kind: "pot" }]).build));
    expect(run.phases.map((p) => p.label)).toEqual(["starting up", "BTN1 pressed briefly", "BTN1 held", "BTN1 pressed twice", "POT1 turned from low to high and back", "quiet"]);
    expect(run.scenario.switches.BTN1![0]).toEqual([2_000_000, 1]);
    expect(run.scenario.pots.POT1!.at(-1)![1]).toBe(0);
  });

  it("changes what each sensor senses, one quantity at a time", () => {
    const run = testRun(electricalModel(layoutProject([{ kind: "dht11" }, { kind: "ldr" }]).build));
    expect(run.phases.map((p) => p.label)).toEqual(["starting up", "LDR1 dark", "LDR1 bright", "DHT1 temperature 30", "DHT1 temperature 15", "DHT1 humidity 80", "DHT1 humidity 25", "quiet"]);
  });
});

describe("findings: one known-bad program each", () => {
  it("S001: a crash, with its line, time and what was happening", async () => {
    const c = await check(LED_BTN, "led = PWM(Pin(16))\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nwhile True:\n    if b.value() == 0:\n        led.duty(30000)\n    time.sleep(0.05)\n");
    expect(c.findings.map((f) => f.code)).toEqual(["S001"]);
    expect(c.findings[0]).toMatchObject({ severity: "error", line: 7 });
    expect(c.findings[0]!.message).toMatch(/AttributeError.*on line 7 \(led\.duty\(30000\)\) after 2\.\d s, while BTN1 pressed briefly/);
  });

  it("S002: a loop that never sleeps and reads nothing", async () => {
    const c = await check(LED_BTN, "led = Pin(16, Pin.OUT)\nled.on()\nwhile True:\n    pass\n", 3000);
    expect(c.findings.map((f) => f.code)).toEqual(["S002"]);
    expect(c.findings[0]!.severity).toBe("warning");
  });

  it("S003 and S004: a button the program never reads, and nothing reacting to it", async () => {
    const c = await check(LED_BTN, "led = Pin(16, Pin.OUT)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nled.on()\nwhile True:\n    time.sleep(0.1)\n");
    expect(c.findings.map((f) => f.code).sort()).toEqual(["S003", "S004"]);
    expect(c.findings.find((f) => f.code === "S003")!.message).toMatch(/^LED1 stays on the whole run, while the test used BTN1/);
    expect(c.findings.find((f) => f.code === "S004")!.message).toMatch(/^BTN1 is never read while the test uses it \(BTN1 pressed briefly, BTN1 held, BTN1 pressed twice/);
  });

  it("S004 alone: the button is read once at the start only (the LED blinks, so something reacts)", async () => {
    const c = await check(LED_BTN, "led = Pin(16, Pin.OUT)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nfast = b.value() == 0\nwhile True:\n    led.toggle()\n    time.sleep(0.1 if fast else 0.5)\n");
    expect(c.findings.map((f) => f.code)).toEqual(["S004"]);
  });

  it("S004 for a knob read only before the sweep", async () => {
    expect(await codes([{ kind: "led", pin: "GP16" }, { kind: "pot", pin: "GP26" }], "led = PWM(Pin(16))\nlevel = ADC(26).read_u16()\nwhile True:\n    led.duty_u16(level)\n    led.duty_u16(0)\n    time.sleep(0.2)\n    led.duty_u16(level)\n    time.sleep(0.2)\n")).toEqual(["S004"]);
  });

  it("S005: a display that is drawn on but never shown", async () => {
    const c = await check(OLED, `${oledSetup()}oled.text("Hello", 0, 0)\nwhile True:\n    time.sleep(1)\n`);
    expect(c.findings.map((f) => f.code)).toEqual(["S005"]);
    expect(c.findings[0]!.message).toMatch(/stays blank the whole run/);
  });
});

describe("S003 wording (18.7i)", () => {
  it("a passive buzzer held on with no tone is said to be silent, not 'on' (the local model's tilt game)", async () => {
    const kinds: BlockRequest[] = [{ kind: "buzzer" }, { kind: "tilt" }];
    const circuit = layoutProject(kinds).build;
    const pin = (mode: string) => Object.entries(circuit.gpioModes).find(([, m]) => m === mode)![0].slice(2);
    const c = await check(kinds, `t = Pin(${pin("in_pullup")}, Pin.IN, Pin.PULL_UP)\nbz = PWM(Pin(${pin("pwm")}))\nwhile True:\n    t.value()\n    time.sleep(0.05)\n`);
    expect(c.findings.find((f) => f.code === "S003")?.message).toMatch(/^BZ1 stays held on with no tone \(silent, while current flows through it\) the whole run/);
  });
});

describe("no findings for programs that work", () => {
  it("button lights the LED, read in a loop with a sleep", async () => {
    expect(await codes(LED_BTN, "led = Pin(16, Pin.OUT)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nwhile True:\n    led.value(1 if b.value() == 0 else 0)\n    time.sleep(0.02)\n")).toEqual([]);
  });

  it("a busy loop without sleep that reads the button (valid MicroPython): runs to the end, LED lit while held", async () => {
    const c = await check(LED_BTN, "led = Pin(16, Pin.OUT)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nwhile True:\n    led.value(not b.value())\n");
    expect(c.findings).toEqual([]);
    expect(c.result.ended).toBe("time limit");
    const held = c.run.phases.find((p) => p.label === "BTN1 held")!;
    const lit = c.result.events.filter((e) => e.kind === "led" && Number(e.b) > 0).map((e) => e.t);
    expect(lit.some((t) => t >= held.from && t < held.from + 50_000)).toBe(true);
  });

  it("a knob sets an LED's brightness", async () => {
    expect(await codes([{ kind: "led", pin: "GP16" }, { kind: "pot", pin: "GP26" }], "led = PWM(Pin(16), freq=1000)\nk = ADC(26)\nwhile True:\n    led.duty_u16(k.read_u16())\n    time.sleep(0.05)\n")).toEqual([]);
  });

  it("a display that shows a counter of button presses", async () => {
    const kinds: BlockRequest[] = [...OLED, { kind: "button" }];
    const circuit = layoutProject(kinds).build;
    const btn = Object.entries(circuit.gpioModes).find(([, m]) => m === "in_pullup")![0].slice(2);
    expect(await codes(kinds, `${oledSetup()}b = Pin(${btn}, Pin.IN, Pin.PULL_UP)\nn = 0\nwas = 1\nwhile True:\n    v = b.value()\n    if v == 0 and was == 1:\n        n += 1\n    was = v\n    oled.fill(0)\n    oled.text(str(n), 0, 0)\n    oled.show()\n    time.sleep(0.05)\n`)).toEqual([]);
  });

  it("an LED that lights only for one sequence while another output reacts (a lock): no S003", async () => {
    const kinds: BlockRequest[] = [{ kind: "led", pin: "GP16" }, { kind: "led", pin: "GP18" }, { kind: "button", pin: "GP17" }];
    expect(await codes(kinds, "ok = Pin(16, Pin.OUT)\nbad = Pin(18, Pin.OUT)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\npresses = 0\nwas = 1\nwhile True:\n    v = b.value()\n    if v == 0 and was == 1:\n        presses += 1\n        bad.toggle()\n    if presses == 7:\n        ok.on()\n    was = v\n    time.sleep(0.02)\n")).toEqual([]);
  });

  it("a Wi-Fi program waiting for a connection: no findings, and a note says why", async () => {
    const c = await check(LED_BTN, "import network\nled = Pin(16, Pin.OUT)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nw = network.WLAN(network.STA_IF)\nw.active(True)\nw.connect('home', 'pw')\nwhile not w.isconnected():\n    time.sleep(1)\nwhile True:\n    led.value(not b.value())\n    time.sleep(0.05)\n");
    expect(c.findings).toEqual([]);
    expect(c.notes).toContain("The program uses Wi-Fi, which isn't simulated, so its inputs and outputs aren't checked.");
  });
});
