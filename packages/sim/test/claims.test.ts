// M18 18.7g: behaviour claims, checked by the simulator (S006). Golden programs: the inverted button
// (valid code, right pins, wrong behaviour) must fail its claim; programs that do what they claim,
// including ones a strict reading could flag (a toggle, an LED that blinks), must pass.

import { driversFor, layoutProject, type BlockRequest } from "@breadpilot/circuit-core";
import { describe, expect, it } from "vitest";
import { electricalModel } from "../src/circuit";
import { checkBehaviour, claimWords, inputSlots, testRun, type Claim } from "../src/index";

const run = (kinds: BlockRequest[], code: string, claims: Claim[]) => {
  const circuit = layoutProject(kinds).build;
  const files = Object.fromEntries(driversFor(circuit.parts.map((p) => p.type)).map((d) => [d.file, d.source]));
  return checkBehaviour({ code: `from machine import Pin, PWM, ADC, I2C\nimport time\n${code}`, circuit, files, claims });
};
const LED_BTN: BlockRequest[] = [{ kind: "led", pin: "GP16" }, { kind: "button", pin: "GP17" }];
const LED_POT: BlockRequest[] = [{ kind: "led", pin: "GP16" }, { kind: "pot", pin: "GP26" }];
const PRESS_ON: Claim = { when: "BTN1 pressed", then: "LED1 on" };
const s006 = (c: Awaited<ReturnType<typeof run>>) => c.findings.filter((f) => f.code === "S006");

describe("the words for a circuit", () => {
  it("come from its parts only", () => {
    const build = layoutProject([{ kind: "led" }, { kind: "button" }, { kind: "pot" }, { kind: "dht11" }, { kind: "oled" }]).build;
    const w = claimWords(build);
    expect(w.when).toEqual(expect.arrayContaining(["BTN1 pressed", "POT1 turned up", "POT1 turned down", "DHT1 temperature high", "DHT1 temperature low", "DHT1 humidity high"]));
    expect(w.then).toEqual(expect.arrayContaining(["LED1 on", "LED1 off", "LED1 blinks", "LED1 brighter", "LED1 dimmer", "OLED1 changes"]));
    expect(w.then.some((x) => x.startsWith("BTN1"))).toBe(false);
    // What sensor phrases mean in the test run, so a claim can fit the program's thresholds.
    expect(w.values).toMatchObject({ "DHT1 temperature high": "30 C", "DHT1 temperature low": "15 C", "DHT1 humidity high": "80 %" });
    expect(w.values["BTN1 pressed"]).toBeUndefined();
  });
});

describe("claims that hold", () => {
  it("LED on while the button is held", async () => {
    const c = await run(LED_BTN, "led = Pin(16, Pin.OUT)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nwhile True:\n    led.value(1 if b.value() == 0 else 0)\n    time.sleep(0.02)\n", [PRESS_ON]);
    expect(c.findings).toEqual([]);
    expect(c.claims).toEqual([{ ...PRESS_ON, held: true }]);
  });

  it("a toggle on each press: 'LED1 on' holds (on during some presses, off during others)", async () => {
    const c = await run(LED_BTN, "led = Pin(16, Pin.OUT)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nwas = 1\nwhile True:\n    v = b.value()\n    if v == 0 and was == 1:\n        led.toggle()\n    was = v\n    time.sleep(0.02)\n", [PRESS_ON]);
    expect(s006(c)).toEqual([]);
    expect(c.claims[0]!.held).toBe(true);
  });

  it("an LED that is on and goes off while the button is held: 'LED1 off' holds", async () => {
    const c = await run(LED_BTN, "led = Pin(16, Pin.OUT)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nwhile True:\n    led.value(b.value())\n    time.sleep(0.02)\n", [{ when: "when BTN1 is pressed.", then: "LED1 turns off" }]);
    expect(c.claims[0]!.held).toBe(true);
  });

  it("the LED blinks while the button is held", async () => {
    const c = await run(LED_BTN, "led = Pin(16, Pin.OUT)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nwhile True:\n    if b.value() == 0:\n        led.toggle()\n    else:\n        led.off()\n    time.sleep(0.1)\n", [{ when: "BTN1 pressed", then: "LED1 blinks" }]);
    expect(c.claims[0]!.held).toBe(true);
  });

  it("a knob turned up makes the LED brighter, turned down dimmer", async () => {
    const c = await run(LED_POT, "led = PWM(Pin(16), freq=1000)\nk = ADC(26)\nwhile True:\n    led.duty_u16(k.read_u16())\n    time.sleep(0.05)\n", [{ when: "POT1 turned up", then: "LED1 brighter" }, { when: "POT1 turned down", then: "LED1 dimmer" }]);
    expect(c.findings).toEqual([]);
    expect(c.claims.map((x) => x.held)).toEqual([true, true]);
  });
});

describe("S006: claims that don't hold", () => {
  it("the inverted button: valid code, right pins, the LED is lit when the button is NOT pressed", async () => {
    const c = await run(LED_BTN, "led = Pin(16, Pin.OUT)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nwhile True:\n    led.value(b.value())\n    time.sleep(0.02)\n", [PRESS_ON]);
    expect(c.findings.map((f) => f.code)).toEqual(["S006"]);
    expect(c.findings[0]).toMatchObject({ severity: "error", ref: "LED1" });
    expect(c.findings[0]!.message).toMatch(/says "when BTN1 pressed, LED1 on", but in the simulator LED1 was on [0-9]% of the time while BTN1 pressed .* and (9\d|100)% of the rest of the run/);
    expect(c.claims[0]!.held).toBe(false);
  });

  it("a knob that dims the LED when the claim says brighter", async () => {
    const c = await run(LED_POT, "led = PWM(Pin(16), freq=1000)\nk = ADC(26)\nwhile True:\n    led.duty_u16(65535 - k.read_u16())\n    time.sleep(0.05)\n", [{ when: "POT1 turned up", then: "LED1 brighter" }]);
    expect(s006(c).map((f) => f.message)).toEqual([expect.stringMatching(/LED1 went from \d+\.\d mA to 0\.\d mA while POT1 turned up/)]);
  });

  it("'blinks' for an LED that just stays on while pressed", async () => {
    const c = await run(LED_BTN, "led = Pin(16, Pin.OUT)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nwhile True:\n    led.value(not b.value())\n    time.sleep(0.02)\n", [{ when: "BTN1 pressed", then: "LED1 blinks" }]);
    expect(s006(c).map((f) => f.message)).toEqual([expect.stringMatching(/LED1 changed at most 1 time while BTN1 pressed/)]);
  });

  it("a display that never changes when the button is pressed", async () => {
    const kinds: BlockRequest[] = [{ kind: "oled" }, { kind: "button" }];
    const circuit = layoutProject(kinds).build;
    const pin = (end: string) => Object.entries(circuit.gpioModes).find(([, m]) => m.endsWith(end))![0].slice(2);
    const btn = Object.entries(circuit.gpioModes).find(([, m]) => m === "in_pullup")![0].slice(2);
    const setup = `from sh1106 import SH1106_I2C\noled = SH1106_I2C(128, 64, I2C(0, sda=Pin(${pin("_sda")}), scl=Pin(${pin("_scl")})))\nb = Pin(${btn}, Pin.IN, Pin.PULL_UP)\n`;
    const claim = [{ when: "BTN1 pressed", then: "OLED1 changes" }];
    const counter = await run(kinds, `${setup}n = 0\nwas = 1\nwhile True:\n    v = b.value()\n    if v == 0 and was == 1:\n        n += 1\n    was = v\n    oled.fill(0)\n    oled.text(str(n), 0, 0)\n    oled.show()\n    time.sleep(0.05)\n`, claim);
    expect(counter.claims[0]!.held).toBe(true);
    const still = await run(kinds, `${setup}oled.text("Hello", 0, 0)\noled.show()\nwhile True:\n    b.value()\n    time.sleep(0.05)\n`, claim);
    expect(s006(still).map((f) => f.message)).toEqual([expect.stringMatching(/OLED1 showed no new picture while BTN1 pressed/)]);
  });
});

describe("claims that can't be checked are said so, never passed or failed", () => {
  it("words that aren't this circuit's", async () => {
    const c = await run(LED_BTN, "led = Pin(16, Pin.OUT)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nwhile True:\n    led.value(not b.value())\n    time.sleep(0.02)\n", [{ when: "the user claps", then: "LED1 on" }, { when: "BTN1 pressed", then: "LED2 on" }]);
    expect(c.findings).toEqual([]);
    expect(c.claims.map((x) => x.held)).toEqual([null, null]);
    expect(c.notes).toEqual([`Claim "when the user claps, LED1 on" can't be checked: "the user claps" isn't one of the words for this circuit.`, `Claim "when BTN1 pressed, LED2 on" can't be checked: "LED2 on" isn't one of the words for this circuit.`]);
  });

  it("after a crash only the crash is reported", async () => {
    const c = await run(LED_BTN, "led = PWM(Pin(16))\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nwhile True:\n    if b.value() == 0:\n        led.duty(30000)\n    time.sleep(0.05)\n", [PRESS_ON]);
    expect(c.findings.map((f) => f.code)).toEqual(["S001"]);
    expect(c.claims).toEqual([{ ...PRESS_ON, held: null }]);
    expect(c.notes).toContain("The code's claims weren't checked: the program didn't run through.");
  });
});

describe("programs that use random (18.7h: found on the OpenAI eval's dice)", () => {
  const DICE = "import random\nled = Pin(16, Pin.OUT)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nwas = 1\nwhile True:\n    v = b.value()\n    if v == 0 and was == 1:\n        led.value(1 if random.randint(1, 6) > 1 else 0)\n    was = v\n    time.sleep(0.01)\n";

  it("the same program gives the same run (random is seeded)", async () => {
    const a = await run(LED_BTN, DICE, []);
    const b = await run(LED_BTN, DICE, []);
    expect(a.result.events.filter((e) => e.kind === "led")).toEqual(b.result.events.filter((e) => e.kind === "led"));
  });

  it("a claim that happens only on some rolls holds if it happens with any of the seeds tried", async () => {
    // LED1 is off after a press only when the roll is 1: by chance on 4 presses with some seeds, not others.
    const c = await run(LED_BTN, DICE, [{ when: "BTN1 pressed", then: "LED1 off" }, PRESS_ON]);
    expect(c.claims.map((x) => x.held)).toEqual([true, true]);
    expect(s006(c)).toEqual([]);
  });

  it("a claim that fails with every seed is still reported", async () => {
    const c = await run(LED_BTN, DICE, [{ when: "BTN1 pressed", then: "LED1 blinks" }]);
    expect(s006(c)).toHaveLength(1);
    expect(c.notes.some((n) => n.startsWith("The program uses random"))).toBe(true);
  });
});

describe("a switch closed at rest: the ball tilt switch (closed while upright, part.json restsClosed)", () => {
  const TILT: BlockRequest[] = [{ kind: "led", pin: "GP16" }, { kind: "tilt", pin: "GP17" }];
  // With the pull-up, the pin reads 0 while upright (closed) and 1 when tilted (open).
  const BEEP_WHEN_TILTED = "led = Pin(16, Pin.OUT)\nt = Pin(17, Pin.IN, Pin.PULL_UP)\nwhile True:\n    led.value(t.value())\n    time.sleep(0.02)\n";

  it("the test run starts it upright and tilts it; the preview starts it upright", () => {
    const model = electricalModel(layoutProject(TILT).build);
    const run = testRun(model);
    expect(run.scenario.switches.TILT1![0]).toEqual([0, 1]);
    expect(run.phases.filter((p) => p.ref === "TILT1").map((p) => p.label)).toEqual(["TILT1 tilted briefly", "TILT1 kept tilted", "TILT1 tilted twice"]);
    expect(inputSlots(model)).toEqual([{ group: "switches", key: "TILT1", ref: "TILT1", value: 1 }]);
  });

  it("'when TILT1 tilted, LED1 on' holds for code that lights the LED when tilted, and fails for the opposite", async () => {
    const right = await run(TILT, BEEP_WHEN_TILTED, [{ when: "TILT1 tilted", then: "LED1 on" }]);
    expect(right.claims.map((c) => c.held)).toEqual([true]);
    expect(right.findings).toEqual([]);
    const wrong = await run(TILT, BEEP_WHEN_TILTED.replace("led.value(t.value())", "led.value(not t.value())"), [{ when: "TILT1 tilted", then: "LED1 on" }]);
    expect(s006(wrong)).toHaveLength(1);
  });
});

describe("a state a switch toggles is tried both ways (25/11/2026: the night light example)", () => {
  // A button toggles the light; the knob sets its brightness only while it is on. The test presses
  // the button 4 times (off again), so without a second round the knob was turned with the light off:
  // a false S006 for "brighter" and a false S004 "POT1 never read".
  const NIGHT_LIGHT = "led = PWM(Pin(16))\nled.freq(1000)\nbutton = Pin(18, Pin.IN, Pin.PULL_UP)\nknob = ADC(26)\nled_on = False\nlast_button = 1\nled.duty_u16(0)\nwhile True:\n    button_state = button.value()\n    if button_state == 0 and last_button == 1:\n        led_on = not led_on\n        time.sleep(0.03)\n    last_button = button_state\n    if led_on:\n        led.duty_u16(knob.read_u16())\n    else:\n        led.duty_u16(0)\n    time.sleep(0.03)\n";
  const KINDS: BlockRequest[] = [{ kind: "led", pin: "GP16" }, { kind: "button", pin: "GP18" }, { kind: "pot", pin: "GP26" }];

  it("the test run presses the button once more, then turns the knob again", () => {
    const run = testRun(electricalModel(layoutProject(KINDS).build));
    expect(run.phases.map((p) => p.label)).toEqual(["starting up", "BTN1 pressed briefly", "BTN1 held", "BTN1 pressed twice", "POT1 turned from low to high and back", "BTN1 pressed once more", "POT1 turned from low to high and back (again)", "quiet"]);
  });

  it("the night light: its knob claims hold, and no finding", async () => {
    const c = await run(KINDS, NIGHT_LIGHT, [{ when: "BTN1 pressed", then: "LED1 on" }, { when: "POT1 turned up", then: "LED1 brighter" }, { when: "POT1 turned down", then: "LED1 dimmer" }]);
    expect(c.findings).toEqual([]);
    expect(c.claims.map((x) => x.held)).toEqual([true, true, true]);
  });
});

