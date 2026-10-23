// Security review 23/10/2026: ways code could drive a wired input (the button on GP18) as an output.
// With the button pressed, that output is shorted to ground. Every probe must be blocked, and the
// normal ways of writing the same project must still pass.
import { describe, expect, it } from "vitest";
import { PICO_2_W } from "../src/board";
import { checkMicroPython, wantedMode } from "../src/codecheck";
import { layoutProject } from "../src/layout";

const build = layoutProject([{ kind: "oled" }, { kind: "button" }], undefined, { power: "direct" }).build;
const head =
  "from machine import Pin, I2C\nimport machine\nimport time\nfrom sh1106 import SH1106_I2C\n" +
  "i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)\noled = SH1106_I2C(128, 64, i2c)\noled.show()\nbtn = Pin(18, Pin.IN, Pin.PULL_UP)\n";
const loop = "while True:\n    time.sleep(1)\n";
const check = (code: string) => checkMicroPython(head + code + loop, build, PICO_2_W);
const errorCodes = (code: string) => check(code).issues.filter((i) => i.severity === "error").map((i) => i.code);

describe("the pin check can't be talked around", () => {
  const probes: Record<string, [string, string]> = {
    "numeric mode Pin(18, 1)": ["x = Pin(18, 1)\nx.value(1)\n", "C005"],
    "btn.init(Pin.OUT)": ["btn.init(Pin.OUT)\nbtn.value(1)\n", "C005"],
    "btn.init(mode=Pin.OUT, value=1)": ["btn.init(mode=Pin.OUT, value=1)\n", "C005"],
    "btn.init(1) by number": ["btn.init(1)\n", "C005"],
    "Pin(18).init(Pin.OUT) chained": ["Pin(18).init(Pin.OUT)\n", "C005"],
    "pins[0].init(Pin.OUT) via a list": ["pins = [btn]\npins[0].init(Pin.OUT)\n", "C005"],
    "Pin(18, Pin.OPEN_DRAIN)": ["x = Pin(18, Pin.OPEN_DRAIN)\n", "C005"],
    "mode from a variable": ["M = 1\nx = Pin(18, M)\n", "C005"],
    'pin by name Pin("GP18", Pin.OUT)': ['x = Pin("GP18", Pin.OUT)\nx.value(1)\n', "C003"],
    "alias: from machine import Pin as P": ["from machine import Pin as P\nx = P(18, P.OUT)\nx.value(1)\n", "C014"],
    "alias: import machine as m": ["import machine as m\nx = m.Pin(18, m.Pin.OUT)\n", "C005"],
    "alias: P = Pin": ["P = Pin\nx = P(18, Pin.OUT)\n", "C014"],
    "getattr(machine, 'Pin')": ["x = getattr(machine, 'Pin')(18, 1)\nx.value(1)\n", "C008"],
    "raw register write mem32": ["machine.mem32[0xd0000038] = 1 << 18\n", "C008"],
    "PIO state machine": ["import rp2\nsm = rp2.StateMachine(0, None, set_base=Pin(18))\n", "C008"],
    "exec() string": ["exec('Pin(18, Pin.OUT).value(1)')\n", "C008"],
  };
  for (const [name, [code, expected]] of Object.entries(probes)) {
    it(`blocks ${name}`, () => {
      expect(check(code).ok).toBe(false);
      expect(errorCodes(code)).toContain(expected);
    });
  }
});

describe("normal code still passes", () => {
  it.each([
    ["re-stating the same mode", "btn.init(Pin.IN, Pin.PULL_UP)\n"],
    ["the same mode by number", "x = Pin(18, 0, 1)\n"],
    ["keyword arguments", "x = Pin(18, mode=Pin.IN, pull=Pin.PULL_UP)\n"],
    ["machine.Pin constants", "x = machine.Pin(18, machine.Pin.IN, machine.Pin.PULL_UP)\n"],
    ["a Timer's init(mode=...)", "from machine import Timer\nt = Timer()\nt.init(mode=Timer.PERIODIC, period=1000, callback=lambda t: None)\n"],
    ["the on-board LED by name", 'led = Pin("LED", Pin.OUT)\nled.toggle()\n'],
  ])("%s", (_name, code) => {
    expect(check(code).issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("wantedMode", () => {
  it("reads constants, rp2 numbers, keywords and pulls", () => {
    expect(wantedMode(["18", "Pin.OUT"], 1)).toBe("out");
    expect(wantedMode(["18", "1"], 1)).toBe("out");
    expect(wantedMode(["18", "Pin.IN", "Pin.PULL_UP"], 1)).toBe("in_pullup");
    expect(wantedMode(["18", "mode=Pin.IN", "pull=Pin.PULL_DOWN"], 1)).toBe("in_pulldown");
    expect(wantedMode(["Pin.IN", "None"], 0)).toBe("in");
    expect(wantedMode(["18"], 1)).toBe("none");
    expect(wantedMode(["18", "MODE"], 1)).toBe("unclear");
    expect(wantedMode(["18", "Pin.ALT_I2C"], 1)).toBe("other");
  });
});
