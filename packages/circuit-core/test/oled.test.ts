// Milestone 6: the 1.3" I2C OLED display (SH1106). Facts: the user's product page (pin order
// VCC-GND-SCL-SDA, 3.3-5 V) and docs/hardware/components/SH1106.pdf (I2C, 0x3C/0x3D).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PICO_2_W } from "../src/board";
import { getComponent } from "../src/catalog";
import { checkMicroPython } from "../src/codecheck";
import { formatWire, parseConnections } from "../src/dsl";
import { i2cPairs, layoutProject, LayoutError } from "../src/layout";
import { buildSteps } from "../src/steps";
import type { Build } from "../src/types";
import { validateBuild } from "../src/validate";

const codes = (b: Build) => validateBuild(b).issues.map((i) => i.code);
const oledBuild = () => layoutProject([{ kind: "oled" }]).build;
/** Replaces the wire that ends on the given OLED leg. */
const rewire = (b: Build, leg: string, dsl: string): Build => {
  const { wires, errors } = parseConnections(dsl);
  if (errors.length) throw new Error(errors[0]!.message);
  return { ...b, wires: [...b.wires.filter((w) => !(w.to.kind === "hole" && w.to.label === `OLED1.${leg}`) && !(w.from.kind === "hole" && w.from.label === `OLED1.${leg}`)), ...wires] };
};

describe("OLED part data", () => {
  it("has the module's header order and the datasheet's I2C facts", () => {
    const def = getComponent("oled-sh1106-i2c")!;
    expect(def.legs.map((l) => l.label)).toEqual(["VCC", "GND", "SCL", "SDA"]);
    expect(def.legs[0]).toMatchObject({ kind: "power_in", voltageRange: [3.3, 5], maxSafeVoltage: 3.3 });
    expect(def.specs).toMatchObject({ controller: "SH1106", i2cAddresses: [0x3c, 0x3d], i2cMaxHz: 400_000, resolution: [128, 64] });
  });
});

describe("OLED layout", () => {
  it("I2C pairs come from the board data: SDA on GPn, SCL on GPn+1, same bus, right side first", () => {
    const pairs = i2cPairs().map((p) => `${p.sda.name}/${p.scl.name}@${p.bus}`);
    expect(pairs.slice(0, 3)).toEqual(["GP16/GP17@0", "GP18/GP19@1", "GP20/GP21@0"]);
    expect(pairs).toContain("GP4/GP5@0");
    expect(pairs.at(-1)).toBe("GP26/GP27@1"); // ADC pins last
  });

  it("wires VCC to 3V3, GND, SCL and SDA in the module's pin order (rails)", () => {
    const { build, blocks } = layoutProject([{ kind: "oled" }]);
    expect(build.wires.map(formatWire)).toEqual([
      "#23(GND) -> #RR-(GND)",
      "#36(3V3) -> #RR+(3V3)",
      "#29j(OLED1.vcc) -> #RR+(3V3)",
      "#30j(OLED1.gnd) -> #RR-(GND)",
      "#22(GP17) -> #31j(OLED1.scl)",
      "#21(GP16) -> #32j(OLED1.sda)",
    ]);
    expect(build.gpioModes).toEqual({ GP16: "i2c0_sda", GP17: "i2c0_scl" });
    expect(blocks[0]).toMatchObject({ kind: "oled", gpio: "GP16", scl: "GP17", bus: 0 });
    expect(validateBuild(build).issues).toEqual([]);
  });

  it("direct power: VCC straight to 3V3 (pin 36), GND straight to a GND pin", () => {
    const wires = layoutProject([{ kind: "oled" }], undefined, { power: "direct" }).build.wires.map(formatWire);
    expect(wires).toContain("#36(3V3) -> #29j(OLED1.vcc)");
    expect(wires).toContain("#23(GND) -> #30j(OLED1.gnd)");
  });

  it("two displays get separate buses (same address); a third is refused", () => {
    const { build } = layoutProject([{ kind: "oled" }, { kind: "oled" }]);
    expect(build.gpioModes).toEqual({ GP16: "i2c0_sda", GP17: "i2c0_scl", GP18: "i2c1_sda", GP19: "i2c1_scl" });
    expect(validateBuild(build).issues).toEqual([]);
    expect(() => layoutProject([{ kind: "oled" }, { kind: "oled" }, { kind: "oled" }])).toThrow(/same I2C address.*at most 2 displays/);
  });

  it("a requested pin is the SDA pin of its pair; a pin that can't be SDA is refused", () => {
    expect(layoutProject([{ kind: "oled", pin: "GP4" }]).build.gpioModes).toEqual({ GP4: "i2c0_sda", GP5: "i2c0_scl" });
    expect(() => layoutProject([{ kind: "oled", pin: "GP5" }])).toThrow(LayoutError);
  });

  it("LEDs and buttons don't take the display's pair", () => {
    const { build } = layoutProject([{ kind: "led" }, { kind: "button" }, { kind: "oled" }]);
    expect(build.gpioModes).toEqual({ GP16: "i2c0_sda", GP17: "i2c0_scl", GP18: "out", GP19: "in_pullup" });
    expect(validateBuild(build).issues).toEqual([]);
  });
});

describe("OLED safety rules", () => {
  it("E014 + E007: VCC on 5 V (VBUS) is refused, and the data lines are flagged", () => {
    const b = rewire(oledBuild(), "vcc", "#40(VBUS) -> #29i(OLED1.vcc)");
    const c = codes(b);
    expect(c).toContain("E014");
    expect(c).toContain("E007");
    expect(validateBuild(b).issues.find((i) => i.code === "E014")!.message).toMatch(/Power OLED1 from 3V3 \(pin 36\)/);
  });

  it("E015: SDA and SCL swapped", () => {
    const b = { ...oledBuild(), gpioModes: { GP16: "i2c0_scl", GP17: "i2c0_sda" } } as Build;
    const issues = validateBuild(b).issues.filter((i) => i.code === "E015");
    expect(issues.map((i) => i.message)).toEqual([expect.stringMatching(/swapped/), expect.stringMatching(/swapped/)]);
  });

  it("E015: a data line on a pin set up as a plain output", () => {
    const b = { ...oledBuild(), gpioModes: { GP16: "out", GP17: "i2c0_scl" } } as Build;
    expect(validateBuild(b).issues.find((i) => i.code === "E015")!.message).toMatch(/OLED1 SDA goes to GP16 \(pin 21\), which isn't set up as I2C SDA/);
  });

  it("E015: SDA and SCL on different buses", () => {
    const b = rewire({ ...oledBuild(), gpioModes: { GP16: "i2c0_sda", GP19: "i2c1_scl" } }, "scl", "#25(GP19) -> #31i(OLED1.scl)");
    expect(validateBuild(b).issues.map((i) => i.message)).toContain("OLED1's SDA and SCL are on different I2C buses (I2C0 and I2C1). Use an SDA and SCL pair from the same bus.");
  });

  it("E015: an unconnected data line", () => {
    const b = { ...oledBuild(), wires: oledBuild().wires.filter((w) => !(w.to.kind === "hole" && w.to.label === "OLED1.sda")), gpioModes: { GP17: "i2c0_scl" } } as Build;
    expect(validateBuild(b).issues.map((i) => i.message)).toContain("OLED1 SDA isn't wired to a Pico pin. Connect it to an I2C SDA pin (e.g. GP16 (pin 21)).");
  });
});

describe("OLED steps", () => {
  it("explain the header order and the I2C lines in plain English", () => {
    const steps = buildSteps(oledBuild());
    const place = steps.find((s) => s.partRef === "OLED1")!;
    expect(place.text).toMatch(/VCC into hole 29f, GND into 30f, SCL into 31f and SDA into 32f/);
    expect(place.why).toMatch(/I2C/);
    const why = steps.filter((s) => s.kind === "wire").map((s) => s.why);
    expect(why).toContain("GP16 is the I2C0 data line (SDA): the Pico sends the pixels to OLED1 on this wire.");
    expect(why).toContain("GP17 is the I2C0 clock line (SCL): it sets the pace for the data on SDA.");
  });
});


describe("OLED code checks", () => {
  const build = () => layoutProject([{ kind: "oled" }, { kind: "button" }]).build; // GP16/17 I2C0, GP18 button
  const prog = (i2c = "i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)", extra = "", oled = "oled = SH1106_I2C(128, 64, i2c)") =>
    `from machine import Pin, I2C\nfrom sh1106 import SH1106_I2C\nimport time\n\n${i2c}\n${oled}\nbutton = Pin(18, Pin.IN, Pin.PULL_UP)\n${extra}\nwhile True:\n    oled.fill(0)\n    oled.text("Pressed" if button.value() == 0 else "Released", 0, 0)\n    oled.show()\n    time.sleep(0.1)\n`;
  const check = (code: string, b = build()) => checkMicroPython(code, b, PICO_2_W);
  const msgs = (code: string, b = build()) => check(code, b).issues.map((i) => `${i.code} ${i.message}`);

  it("accepts a correct program (hardware I2C or SoftI2C, constants)", () => {
    expect(check(prog()).issues).toEqual([]);
    expect(check(prog("i2c = SoftI2C(sda=Pin(16), scl=Pin(17))").replace("I2C\n", "SoftI2C\n")).issues).toEqual([]);
    expect(check(prog("SDA = 16\nSCL = 17\ni2c = I2C(0, scl=Pin(SCL), sda=Pin(SDA), freq=400_000)")).issues).toEqual([]);
    expect(check(prog()).used).toMatchObject({ GP16: "i2c0_sda", GP17: "i2c0_scl" });
  });

  it("C005: wrong bus, swapped pins, or no pins given", () => {
    expect(msgs(prog("i2c = I2C(1, sda=Pin(16), scl=Pin(17))"))).toContainEqual(expect.stringMatching(/uses I2C1, but GP16 is wired on I2C0\. Write I2C\(0, sda=Pin\(16\), scl=Pin\(17\), freq=400000\)/));
    expect(msgs(prog("i2c = I2C(0, sda=Pin(17), scl=Pin(16))"))).toContainEqual(expect.stringMatching(/SDA and SCL are swapped/));
    expect(msgs(prog("i2c = I2C(0)"))).toContainEqual(expect.stringMatching(/without both sda= and scl= pins/));
  });

  it("C005: an I2C pin used as a plain output", () => {
    expect(msgs(prog(undefined, "led = Pin(16, Pin.OUT)"))).toContainEqual(expect.stringMatching(/GP16 is wired as the I2C0 data line \(SDA\), but line \d+ sets it up as an output/));
  });

  it("C010: the SSD1306 driver is the wrong chip; sh1106 only with the display", () => {
    expect(msgs(prog().replace("from sh1106 import SH1106_I2C", "from ssd1306 import SSD1306_I2C"))).toContainEqual(expect.stringMatching(/C010 .*ssd1306.*uses the SH1106 chip/));
    const blink = layoutProject([{ kind: "led" }]).build;
    expect(msgs("from sh1106 import SH1106_I2C\nfrom machine import Pin\nimport time\nled = Pin(16, Pin.OUT)\nwhile True:\n    led.toggle()\n    time.sleep(1)\n", blink)).toContainEqual(expect.stringMatching(/C010 .*only available in projects with the OLED display/));
  });

  it("C012: the display must be created with SH1106_I2C(128, 64, i2c) and shown", () => {
    expect(msgs(prog(undefined, "", "oled = None"))).toContainEqual(expect.stringMatching(/C012 The build has the OLED display, but the code never sets it up/));
    expect(msgs(prog(undefined, "", "oled = SH1106_I2C(128, 32, i2c)"))).toContainEqual(expect.stringMatching(/C012 .*size 128 x 32/));
    expect(msgs(prog().replace("    oled.show()\n", ""))).toContainEqual(expect.stringMatching(/C012 .*never calls oled.show\(\)/));
  });

  it("C006: wired I2C pins the code never uses get the exact setup line", () => {
    const code = "from machine import Pin\nimport time\nbutton = Pin(18, Pin.IN, Pin.PULL_UP)\nwhile True:\n    time.sleep(1)\n";
    expect(msgs(code)).toContainEqual(expect.stringMatching(/C006 The build wires GP16 as the I2C0 data line \(SDA\).*I2C\(0, sda=Pin\(16\), scl=Pin\(17\), freq=400000\)/));
  });
});

describe("C013: text on the OLED (user's Wi-Fi scanner, 20/10/2026)", () => {
  const scanner = layoutProject([{ kind: "oled" }, { kind: "button" }], undefined, { power: "direct" }).build;
  const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
  const issues = (code: string) => checkMicroPython(code, scanner, PICO_2_W).issues.filter((i) => i.code === "C013");
  const draw = (line: string) => `from machine import Pin, I2C\nfrom sh1106 import SH1106_I2C\nimport time\ni2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)\noled = SH1106_I2C(128, 64, i2c)\nbutton = Pin(18, Pin.IN, Pin.PULL_UP)\nwhile True:\n    oled.fill(0)\n${line}\n    oled.show()\n    time.sleep(1)\n`;

  it("the model's real code: the █ bar (via a variable) is an error, the 10 + i*10 rows a warning", () => {
    const found = issues(fixture("wifi-scanner-llm.py"));
    expect(found.filter((i) => i.severity === "error").map((i) => i.message)).toEqual([expect.stringMatching(/draws bar on the display, and line \d+ builds it with "█"/)]);
    expect(found.filter((i) => i.severity === "warning").map((i) => i.message)).toContainEqual(expect.stringMatching(/y = 10 \+ i\*10.*only 5 rows fit/));
    expect(checkMicroPython(fixture("wifi-scanner-llm.py"), scanner, PICO_2_W).ok).toBe(false); // now sent back for repair
  });

  it("the model's second real code: rows that overlap and a 5th item off the screen are errors", () => {
    const found = issues(fixture("wifi-scanner-llm-2.py"));
    expect(found.map((i) => `${i.severity} line ${i.line}`)).toEqual(["error line 46", "error line 46"]);
    expect(found[0]!.message).toMatch(/text rows overlap\. Each item draws text from y = 8 \+ 10\*i to 24 \+ 10\*i \(24 pixels\), but each item moves down only 10 pixels/);
    expect(found[1]!.message).toMatch(/with 5 items the last one is drawn at y = 64, below the screen.*Only 4 fit/);
  });

  it("row layouts: brackets, a y variable plus an offset, range() and constant counts", () => {
    const loop = (header: string, body: string) => draw(`    ${header}\n${body}`);
    expect(issues(loop("for i in range(8):", '        oled.text("x", 0, (i * 8))'))).toEqual([]);
    expect(issues(loop("for i in range(9):", '        oled.text("x", 0, i * 8)'))[0]!.message).toMatch(/with 9 items the last one is drawn at y = 64/);
    expect(issues(draw('    ROWS = 3\n    for i, n in enumerate(names[:ROWS]):\n        y = 8 + i * 16\n        oled.text("a", 0, y)\n        oled.text("b", 0, y + 8)').replace("names", "[1, 2, 3]"))).toEqual([]);
    expect(issues(loop("for i in range(4):", '        oled.text("x", 0, 2 + 6 * i)'))[0]!.message).toMatch(/text rows overlap\. Letters are 8 pixels tall, but each item moves down only 6 pixels/);
  });

  it("the corrected program is clean", () => {
    expect(checkMicroPython(fixture("wifi-scanner-fixed.py"), scanner, PICO_2_W).issues).toEqual([]);
  });

  it("non-ASCII directly in the text, a fixed y below the screen, a too-long literal", () => {
    expect(issues(draw('    oled.text("25°C ✓", 0, 0)'))[0]!.message).toMatch(/draws "° ✓".*plain ASCII/);
    expect(issues(draw('    oled.text("Hi", 0, 60)'))[0]).toMatchObject({ severity: "error", message: expect.stringMatching(/y = 60, below the screen.*last row is y = 56/) });
    expect(issues(draw('    oled.text("Temperature is high", 0, 0)'))[0]).toMatchObject({ severity: "warning", message: expect.stringMatching(/19 characters, but only 16 fit from x = 0/) });
    expect(issues(draw('    oled.text("Hello", 96, 0)'))[0]!.message).toMatch(/only 4 fit from x = 96/);
  });

  it("rows at y = 8 * row are fine; text without a display isn't checked", () => {
    expect(issues(draw('    for i in range(8):\n        oled.text("Row " + str(i), 0, i * 8)'))).toEqual([]);
    expect(issues(draw('    oled.text("Hi", 0, 8 + i * 8)'))).toEqual([]);
    const blink = layoutProject([{ kind: "led" }]).build;
    expect(checkMicroPython('from machine import Pin\nimport time\nled = Pin(16, Pin.OUT)\nwhile True:\n    print("°")\n    led.toggle()\n    time.sleep(1)\n', blink, PICO_2_W).issues).toEqual([]);
  });
});
