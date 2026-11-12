import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PICO_2_W } from "../src/board";
import { checkMicroPython, evalInts, MACHINE_MODULE_NAMES, moduleConstants, stripStringsAndComments } from "../src/codecheck";
import { layoutProject } from "../src/layout";

// LED on GP16 (out), button on GP17 (in_pullup), pot on GP26 (adc)
// The pins the sample code below uses (requested, so the checker tests don't depend on pin choice).
const { build } = layoutProject([{ kind: "led", pin: "GP16" }, { kind: "button", pin: "GP17" }, { kind: "pot", pin: "GP26" }]);
const check = (src: string) => checkMicroPython(src, build, PICO_2_W);
const codes = (src: string) => check(src).issues.map((i) => i.code);

const GOOD = `
from machine import Pin, ADC, PWM
import time

LED_PIN = 16
led = PWM(Pin(LED_PIN))          # brightness from the knob
button = Pin(17, Pin.IN, Pin.PULL_UP)
knob = ADC(26)

while True:
    if button.value() == 0:      # pressed: the pull-up reads 0
        led.duty_u16(knob.read_u16())
    else:
        led.duty_u16(0)
    time.sleep(0.02)
`;

describe("checkMicroPython", () => {
  it("accepts code that matches the build", () => {
    const r = check(GOOD);
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.used).toEqual({ GP16: "pwm", GP17: "in_pullup", GP26: "adc" });
  });

  it("C003: internal or non-existent GPIOs", () => {
    expect(codes(GOOD + "x = Pin(25, Pin.OUT)\n")).toContain("C003");
    expect(check(GOOD + "x = Pin(25, Pin.OUT)\n").issues.find((i) => i.code === "C003")!.message).toMatch(/inside the Pico 2 W/);
    expect(codes(GOOD + "x = Pin(40, Pin.OUT)\n")).toContain("C003");
  });

  it("C004: a GPIO that isn't wired", () => {
    expect(codes(GOOD + "x = Pin(5, Pin.OUT)\n")).toEqual(["C004"]);
  });

  it("C005: wrong direction or pull", () => {
    expect(codes(GOOD.replace("Pin(17, Pin.IN, Pin.PULL_UP)", "Pin(17, Pin.OUT)"))).toEqual(["C005"]);
    expect(codes(GOOD.replace("Pin.PULL_UP", "Pin.PULL_DOWN"))).toEqual(["C005"]);
    expect(codes(GOOD.replace("Pin(17, Pin.IN, Pin.PULL_UP)", "Pin(17, mode=Pin.IN, pull=Pin.PULL_UP)"))).toEqual([]);
    expect(codes(GOOD.replace("ADC(26)", "ADC(17)"))).toContain("C005");
  });

  it("maps ADC channel numbers to pins and allows the temperature sensor", () => {
    expect(codes(GOOD.replace("ADC(26)", "ADC(0)"))).toEqual([]);
    expect(codes(GOOD.replace("ADC(26)", "ADC(Pin(26))"))).toEqual([]);
    expect(codes(GOOD + "temp = ADC(4)\n")).toEqual([]);
  });

  it("C006: a wired GPIO the code never uses", () => {
    expect(codes(GOOD.replace("knob = ADC(26)", "knob = None"))).toEqual(["C006"]);
  });

  it("C002: every machine class and module used must be imported", () => {
    expect(codes(GOOD.replace("from machine import Pin, ADC, PWM", ""))).toEqual(["C002", "C002", "C002"]);
    expect(codes(GOOD.replace("from machine import Pin, ADC, PWM", "from machine import Pin, ADC"))).toEqual(["C002"]);
    expect(codes(GOOD.replace("import time\n", ""))).toEqual(["C002"]);
    // "import machine" only allows machine.Pin(...); a bare Pin(...) is a NameError on the Pico.
    expect(codes(GOOD.replace("from machine import Pin, ADC, PWM", "import machine"))).toEqual(["C002", "C002", "C002"]);
    const qualified = GOOD.replace("from machine import Pin, ADC, PWM", "import machine").replace(/\b(Pin|ADC|PWM)\(/g, "machine.$1(").replace(/Pin\.(IN|PULL_UP)/g, "machine.Pin.$1");
    expect(codes(qualified)).toEqual([]);
    expect(codes(GOOD.replace("from machine import Pin, ADC, PWM", "from machine import Pin as P, ADC, PWM").replace(/\bPin\(/g, "P(").replace(/\bPin\./g, "P."))).toContain("C006");
  });

  it("C001: block headers need ':' and an indented body", () => {
    expect(codes(GOOD.replace("while True:", "while True"))).toContain("C001");
    expect(check(GOOD.replace("while True:", "while True")).issues[0]!.message).toBe('Line 10 starts a "while" block but doesn\'t end with ":".');
    expect(codes(GOOD + "def f():\nreturn 1\n")).toContain("C001");
    expect(codes(GOOD + "if True: print(1)\nd = {'a': 1}\n")).toEqual([]);
  });

  it("accepts block headers that continue on the next lines", () => {
    const head = "from machine import Pin\nimport time\nled = Pin(16, Pin.OUT)\nbtn = Pin(17, Pin.IN, Pin.PULL_UP)\nk = None\n";
    const lb = layoutProject([{ kind: "led", pin: "GP16" }, { kind: "button", pin: "GP17" }]).build;
    const ok = (body: string) => checkMicroPython(head + body, lb, PICO_2_W).issues.filter((i) => i.severity === "error");
    expect(ok("x = 1\nif (btn.value() == 0 and\n        x == 1):\n    led.on()\n")).toEqual([]);
    expect(ok("def blink(times,\n          delay):\n    for _ in range(times):\n        led.toggle()\n        time.sleep(delay)\nprint(btn.value())\n")).toEqual([]);
    expect(ok("if btn.value() == 0 and \\\n   True:\n    led.on()\n")).toEqual([]);
    expect(ok("if (btn.value() == 0 and\n        True)\n    led.on()\n").map((i) => i.code)).toEqual(["C001"]);
  });

  it("resolves pins set up through lists and loops", () => {
    const three = layoutProject([{ kind: "led", pin: "GP16" }, { kind: "led", pin: "GP17" }, { kind: "led", pin: "GP18" }]).build;
    const ok = (src: string) => checkMicroPython(src, three, PICO_2_W).issues.map((i) => i.code);
    expect(ok("from machine import Pin\nleds = [Pin(p, Pin.OUT) for p in (16, 17, 18)]\n")).toEqual([]);
    expect(ok("from machine import Pin\nPINS = [16, 17, 18]\nleds = [Pin(p, Pin.OUT) for p in PINS]\n")).toEqual([]);
    expect(ok("from machine import Pin\nPINS = (16, 17, 18)\nfor i, p in enumerate(PINS):\n    Pin(p, Pin.OUT)\n")).toEqual([]);
    expect(ok("from machine import Pin\nPINS = [16, 17, 18]\na = Pin(PINS[0], Pin.OUT)\nb = Pin(PINS[1], Pin.OUT)\n")).toEqual(["C006"]);
    expect(ok("from machine import Pin\nleds = [Pin(p, Pin.IN) for p in (16, 17, 18)]\n")).toEqual(["C005", "C005", "C005"]);
  });

  it("C001: unbalanced brackets, unterminated strings, mixed indentation", () => {
    expect(codes(GOOD.replace("time.sleep(0.02)", "time.sleep(0.02"))).toContain("C001");
    expect(codes(GOOD + 'print("hello)\n')).toContain("C001");
    expect(codes(GOOD + "if True:\n\tpass\n")).toContain("C001");
  });

  it("ignores pins mentioned in comments and strings, and allows Pin('LED')", () => {
    expect(codes(GOOD + '# Pin(5, Pin.OUT) is not used\nprint("Pin(5) is free")\nonboard = Pin("LED", Pin.OUT)\n')).toEqual([]);
  });

  it("C007: warns when the GPIO can't be determined", () => {
    const r = check(GOOD + "def pick_pin():\n    return 16\nx = Pin(pick_pin(), Pin.OUT)\n");
    expect(r.ok).toBe(true);
    expect(r.issues.map((i) => i.code)).toEqual(["C007"]);
  });
});

describe("safety and habits", () => {
  it("C008 blocks calls that can trap the board", () => {
    for (const bad of ["machine.reset()", "import machine\nmachine.bootloader()", "machine.deepsleep(1000)", "import os\nos.remove('main.py')", "exec(cmd)", "machine.freq(250000000)"]) {
      expect(codes(GOOD + `${bad}\n`), bad).toContain("C008");
    }
  });
  it("C008 ignores the words in comments and strings", () => {
    expect(codes(GOOD + '# never call machine.reset() here\nprint("reset()")\n')).toEqual([]);
  });
  it("C009 warns about a loop without sleep, but not with irq/Timer", () => {
    const busy = "from machine import Pin\nled = Pin(16, Pin.OUT)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nk = None\nwhile True:\n    led.value(not b.value())\n";
    const r = checkMicroPython(busy, layoutProject([{ kind: "led", pin: "GP16" }, { kind: "button", pin: "GP17" }]).build, PICO_2_W);
    expect(r.ok).toBe(true);
    expect(r.issues.map((i) => i.code)).toEqual(["C009"]);
  });
  it("from machine import * imports everything", () => {
    expect(codes(GOOD.replace("from machine import Pin, ADC, PWM", "from machine import *"))).toEqual([]);
  });
});

describe("pins computed in code (no false positives)", () => {
  const four = layoutProject(["GP16", "GP17", "GP18", "GP19"].map((pin) => ({ kind: "led", pin }))).build;
  const run = (src: string) => checkMicroPython(src, four, PICO_2_W).issues.map((i) => i.code);
  it.each([
    "leds = []\nfor i in range(4):\n    leds.append(Pin(16 + i, Pin.OUT))",
    "leds = [Pin(p, Pin.OUT) for p in range(16, 20)]",
    "BASE = 16\nleds = [Pin(BASE + i, Pin.OUT) for i in range(4)]",
    'PINS = {"a": 16, "b": 17, "c": 18, "d": 19}\nleds = [Pin(p, Pin.OUT) for p in PINS.values()]',
    'PINS = {"a": 16, "b": 17, "c": 18, "d": 19}\nfor name, p in PINS.items():\n    Pin(p, Pin.OUT)',
    "PINS = (16, 17, 18, 19)\nleds = [Pin(PINS[i], Pin.OUT) for i in range(len(PINS))]",
    "leds = [Pin(19 - i, Pin.OUT) for i in range(4)]",
    "leds = [Pin(16 + 1 * i, Pin.OUT) for i in (0, 1, 2, 3)]",
  ])("%s", (body) => {
    expect(run(`from machine import Pin\n${body}\n`)).toEqual([]);
  });
  it("still catches a computed pin that isn't wired", () => {
    expect(run("from machine import Pin\nleds = [Pin(16 + i, Pin.OUT) for i in range(5)]\n")).toEqual(["C004"]);
  });
});

describe("C010: only modules that exist on the Pico", () => {
  it.each(["import uping", "import numpy as np", "from RPi import GPIO", "import requests_html"])("%s", (line) => {
    expect(codes(GOOD + `${line}\n`)).toContain("C010");
  });
  it("explains that ping doesn't exist", () => {
    expect(check(GOOD + "import uping\n").issues.find((i) => i.code === "C010")!.message).toMatch(/no ping.*TCP connection/);
  });
  it.each(["import network", "import socket", "import urequests", "from ntptime import settime", "import utime as time", "import machine, time, random"])("allows %s", (line) => {
    expect(codes(`${line}\n${GOOD}`)).not.toContain("C010");
  });
});

describe("C011: names used but never defined", () => {
  it("catches typos that crash with NameError, with a hint", () => {
    const r = check(GOOD.replace("time.sleep(0.02)", "time.sleep(BLINK-DELAY)"));
    expect(r.issues.map((i) => i.code)).toEqual(["C011", "C011"]);
    expect(r.issues[0]!.message).toMatch(/uses "BLINK", which is never defined/);
  });
  it("suggests the closest name", () => {
    expect(check(GOOD.replace("led.duty_u16(knob.read_u16())", "led.duty_u16(knb.read_u16())")).issues.find((i) => i.code === "C011")!.message).toMatch(/Did you mean "knob"\?/);
  });
  it.each([
    ["keyword arguments", "def cb(p):\n    pass\nbutton.irq(trigger=Pin.IRQ_FALLING, handler=cb)\n"],
    ["tuple unpacking", "a, (b, c) = 1, (2, 3)\nprint(a + b + c)\n"],
    ["augmented assignment", "count = 0\ncount += 1\n"],
    ["comprehension and loop variables", "vals = [x * 2 for x in range(3)]\nfor i, v in enumerate(vals):\n    print(i, v)\n"],
    ["function parameters with defaults", "def blink(times=3, *args, delay: float = 0.1, **kw):\n    for _ in range(times):\n        print(delay, args, kw)\nblink()\n"],
    ["lambda", "f = lambda a, b=2: a + b\nprint(f(1))\n"],
    ["except/with as", "try:\n    x = 1\nexcept Exception as e:\n    print(e)\n"],
    ["global", "def f():\n    global total\n    total = 1\nf()\nprint(total)\n"],
    ["f-strings and string prefixes", 'n = 1\nprint(f"n = {n}", b"x", r"y")\n'],
    ["chained assignment", "a = b = 0\nprint(a, b)\n"],
    ["numbers like 1e3 and 0x1F", "x = 1e3 + 0x1F + 0b101\n"],
  ])("no false positive: %s", (_, extra) => {
    expect(check(GOOD + extra).issues.filter((i) => i.code === "C011")).toEqual([]);
  });
  it("is skipped after from machine import *", () => {
    expect(codes(GOOD.replace("from machine import Pin, ADC, PWM", "from machine import *") + "x = Timer\n")).toEqual([]);
  });
  it("doesn't double-report a missing import", () => {
    expect(codes(GOOD.replace("import time\n", ""))).toEqual(["C002"]);
  });
});

describe("repair messages say how to fix it", () => {
  it("C005 for an ADC pin set up as Pin gives the ADC recipe", () => {
    const msg = check(GOOD.replace("knob = ADC(26)", "knob = Pin(26, Pin.IN)")).issues.find((i) => i.code === "C005")!.message;
    expect(msg).toContain("Use ADC(26) and read it with .read_u16() (0-65535); a Pin object has no read_u16()");
  });
  it("C004 lists the wired pins and the on-board LED", () => {
    const msg = check(GOOD + "x = Pin(2, Pin.OUT)\n").issues.find((i) => i.code === "C004")!.message;
    expect(msg).toContain("Only these pins are wired: GP16 (an output), GP17 (an input with pull-up), GP26 (an analog input (ADC)).");
  });
  it("C004 on a build with no wiring points to Pin(\"LED\")", () => {
    const empty = { boardId: "pico-2-w", parts: [], wires: [], gpioModes: {} };
    const msg = checkMicroPython("from machine import Pin\nled = Pin(2, Pin.OUT)\n", empty, PICO_2_W).issues[0]!.message;
    expect(msg).toContain('The Pico 2 W\'s on-board LED is Pin("LED", Pin.OUT); it is not GP25, GP16 or GP2.');
  });
});

describe("stripStringsAndComments", () => {
  it("blanks strings and drops comments but keeps line numbers", () => {
    expect(stripStringsAndComments('a = "x(y" # c)\nb = 1')).toBe('a = "   "     \nb = 1');
    const src = 'p = Pin("LED") # x\ns = "a\\"b"';
    expect(stripStringsAndComments(src)).toHaveLength(src.length);
    expect(stripStringsAndComments('"""doc\n(still)"""\nc').split("\n")).toHaveLength(3);
  });
});

describe("evalInts", () => {
  const names = new Map([["BASE", [16]], ["PINS", [16, 17]]]);
  it.each([
    ["16", [16]], ["BASE + 2", [18]], ["(BASE + 1) * 1", [17]], ["[1, 2, 3]", [1, 2, 3]], ["range(3)", [0, 1, 2]],
    ["range(20, 16, -1)", [20, 19, 18, 17]], ["PINS[1]", [17]], ["PINS[i]", [16, 17]], ["{ 'x': 5, 'y': 6 }", [5, 6]], ["BASE - 1", [15]], ["-3", [-3]], ["10 - -2", [12]],
  ])("%s", (expr, want) => {
    expect(evalInts(expr, names)).toEqual(want);
  });
  it("an empty range has no values", () => {
    expect(evalInts("range(0)", names)).toEqual([]);
  });
  it.each(["foo()", "len(PINS)", "x.y", "range(1000000)", "range(1, 5, 0)"])("returns null for %s", (expr) => {
    expect(evalInts(expr, names)).toBeNull();
  });
});

describe("ADC-wired pins set up as a bare digital Pin (live UI finding, 20/10/2026)", () => {
  const knob = layoutProject([{ kind: "pot" }, { kind: "led" }]).build;
  const prog = (setup: string) => `from machine import Pin, PWM, ADC\nimport time\n\nled = PWM(Pin(16))\n${setup}\n\nwhile True:\n    led.duty_u16(pot.read_u16())\n    time.sleep(0.01)\n`;

  it("Pin(26) with no mode on the knob's pin is an error with the ADC fix", () => {
    const r = checkMicroPython(prog("pot = Pin(26)"), knob, PICO_2_W);
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual([expect.objectContaining({ code: "C005", line: 5, message: expect.stringContaining("Use ADC(26) and read it with .read_u16()") })]);
  });

  it("also through a constant or machine.Pin", () => {
    expect(checkMicroPython(prog("POT_PIN = 26\npot = Pin(POT_PIN)"), knob, PICO_2_W).issues.map((i) => i.code)).toEqual(["C005"]);
    expect(checkMicroPython(prog("import machine\npot = machine.Pin(26)"), knob, PICO_2_W).issues.map((i) => i.code)).toContain("C005");
  });

  it("valid ways to read the knob stay clean", () => {
    for (const setup of ["pot = ADC(26)", "pot = ADC(0)", "pot = ADC(Pin(26))", "pot_pin = Pin(26)\npot = ADC(pot_pin)"]) {
      const r = checkMicroPython(prog(setup), knob, PICO_2_W);
      expect(r.ok, setup).toBe(true);
      expect(r.issues.filter((i) => i.severity === "error"), setup).toEqual([]);
    }
  });

  it("a mode-less Pin() on a digital pin is still allowed (mode can be set later)", () => {
    const blink = layoutProject([{ kind: "led" }]).build;
    const code = "from machine import Pin\nimport time\n\nled = Pin(16)\nled.init(Pin.OUT)\n\nwhile True:\n    led.toggle()\n    time.sleep(0.5)\n";
    expect(checkMicroPython(code, blink, PICO_2_W).issues.filter((i) => i.severity === "error")).toEqual([]);
  });
});

describe("C011 knows MicroPython's built-in exceptions (false positive found 20/10/2026)", () => {
  it.each(["UnicodeError", "LookupError", "ArithmeticError", "IndentationError"])("except %s", (name) => {
    const blink = layoutProject([{ kind: "led" }]).build;
    const code = `from machine import Pin\nimport time\nled = Pin(16, Pin.OUT)\ntry:\n    x = b"a".decode()\nexcept ${name}:\n    x = "?"\nwhile True:\n    led.toggle()\n    time.sleep(1)\n`;
    expect(checkMicroPython(code, blink, PICO_2_W).issues).toEqual([]);
  });
});

describe("moduleConstants: names assigned once at the top level", () => {
  const consts = (src: string) => moduleConstants(src, stripStringsAndComments(src));
  it("reads numbers (also from other constants) and plain text", () => {
    const c = consts('W = 128\nH = W - 64\nTITLE = "Hello"\nNAME = r\'x\'\nAREA = W * H\n');
    expect(Object.fromEntries(c.ints)).toEqual({ W: 128, H: 64, AREA: 8192 });
    expect(Object.fromEntries(c.strings)).toEqual({ TITLE: "Hello", NAME: "x" });
  });
  it("leaves out anything whose value can change or isn't simple", () => {
    const c = consts(
      [
        "A = 1", "A = 2", // assigned twice
        "B = 5", "B += 1", // changed
        "C = 3", "def f():", "    global C", "    C = 4", // changed in a function
        "for D in range(3):", "    pass", "D = 1", // loop variable
        "E, F = 1, 2", // tuple assignment
        "    G = 7", // indented: not top level
        "H = some_call()", "I = [1, 2]", 'J = "a" + "b"', "K = 'it''s'",
        "L = 10", // the only real constant
      ].join("\n"),
    );
    expect(Object.fromEntries(c.ints)).toEqual({ L: 10 });
    expect([...c.strings.keys()]).toEqual([]);
  });
});

describe("C015: names the machine module doesn't have (MicroPython v1.29.0, rp2)", () => {
  const build = layoutProject([{ kind: "led" }], undefined, { power: "direct" }).build;
  const c015 = (code: string) => checkMicroPython(code, build, PICO_2_W).issues.filter((i) => i.code === "C015").map((i) => i.message);
  const led = 'led = Pin(16, Pin.OUT)\nled.on()\n';

  it("the model's real mistakes (08/11/2026): from machine import machine, machine.temperature()", () => {
    const found = c015(`from machine import Pin, I2C, machine\nimport time\n${led}t = machine.temperature() / 1000\n`);
    expect(found).toEqual([
      expect.stringMatching(/^Line 1 imports machine from machine, but MicroPython's machine module on the Pico has no machine, so the program stops with an error there\. The machine module has: .*ADC.*Pin.*Timer/),
      expect.stringMatching(/^Line 5 uses machine\.temperature, but .* has no temperature/),
    ]);
    expect(c015(`import machine\nfrom machine import Pin\n${led}t = machine.temperature()\n`)).toEqual([expect.stringMatching(/^Line 5 uses machine\.temperature/)]);
    expect(c015(`import machine as m\nfrom machine import Pin\n${led}m.reboot()\n`)).toEqual([expect.stringMatching(/uses m\.reboot.*has no reboot/)]);
  });

  it("real names pass: classes, functions, the rp2 extras, aliases, star imports, other modules", () => {
    expect(c015(`from machine import Pin, ADC, PWM, I2C, SoftI2C, Timer, RTC, WDT, UART, SPI\nimport machine\n${led}machine.freq()\nmachine.unique_id()\nmachine.reset_cause() == machine.PWRON_RESET\nx = machine.Pin(2)\n`)).toEqual([]);
    expect(c015(`from machine import Pin as P, ADC\nfrom machine import *\n${led}`)).toEqual([]);
    expect(c015(`from machine import Pin\nimport time\n${led}time.temperature = 3\n# machine.temperature()\n`)).toEqual([]);
  });

  it("the list is exactly the names in the v1.29.0 module tables (extmod + the rp2 port's extras)", () => {
    const dir = new URL("../../../docs/software/micropython-v1.29.0/", import.meta.url);
    const common = readFileSync(new URL("extmod__modmachine.c", dir), "utf8");
    const rp2 = readFileSync(new URL("ports__rp2__modmachine.c", dir), "utf8");
    const table = /machine_module_globals_table\[\] = \{([\s\S]*?)\n\};/.exec(common)![1]!;
    const extras = /#define MICROPY_PY_MACHINE_EXTRA_GLOBALS \\\n([\s\S]*?)\n\n/.exec(rp2)![1]!;
    // Each entry is { key, value }: only the key is a name (the __name__ entry's value is "machine").
    const names = [...`${table}\n${extras}`.matchAll(/\{\s*MP_ROM_QSTR\(MP_QSTR_(\w+)\)/g)].map((m) => m[1]!).filter((n) => n !== "__name__");
    expect([...names].sort()).toEqual([...MACHINE_MODULE_NAMES].sort());
  });
});
