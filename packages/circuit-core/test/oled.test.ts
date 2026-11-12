// Milestone 6: the 1.3" I2C OLED display (SH1106). Facts: the user's product page (pin order
// VCC-GND-SCL-SDA, 3.3-5 V) and docs/hardware/components/SH1106.pdf (I2C, 0x3C/0x3D).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PICO_2_W } from "../src/board";
import { getComponent } from "../src/catalog";
import { checkMicroPython, FRAMEBUF_METHODS } from "../src/codecheck";
import { formatWire, parseConnections } from "../src/dsl";
import { i2cPairs, layoutProject, LayoutError } from "../src/layout";
import { driverLists, PACKS } from "../src/packs";
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
      "#38(GND) -> #RR-(GND)",
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
    // Pin 28, not 23: GND 23's row is next to the display's SCL wire on GP17.
    expect(wires).toContain("#28(GND) -> #30j(OLED1.gnd)");
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
    // GP19 is passed over for GP20 so the button's wire isn't next to the LED's on GP18.
    expect(build.gpioModes).toEqual({ GP16: "i2c0_sda", GP17: "i2c0_scl", GP18: "out", GP20: "in_pullup" });
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

  it("C012 reads constants: a correct size through names is accepted (false alarm found in the model test, 07/11/2026)", () => {
    const consts = (lines: string) => prog(undefined, "", `${lines}\noled = SH1106_I2C(DISPLAY_WIDTH, DISPLAY_HEIGHT, i2c)`);
    expect(check(consts("DISPLAY_WIDTH = 128\nDISPLAY_HEIGHT = 64")).issues).toEqual([]);
    expect(check(consts("DISPLAY_WIDTH = 64 * 2\nDISPLAY_HEIGHT = DISPLAY_WIDTH - 64")).issues).toEqual([]);
  });

  it("C012 through constants still catches a wrong size, and says what the name stands for", () => {
    const consts = (lines: string) => msgs(prog(undefined, "", `${lines}\noled = SH1106_I2C(DISPLAY_WIDTH, DISPLAY_HEIGHT, i2c)`));
    expect(consts("DISPLAY_WIDTH = 128\nDISPLAY_HEIGHT = 32")).toContainEqual(expect.stringMatching(/C012 .*size DISPLAY_WIDTH \(= 128\) x DISPLAY_HEIGHT \(= 32\); this screen is 128 x 64/));
    // A name that changes isn't a constant: its value can't be known, so it isn't trusted.
    expect(consts("DISPLAY_WIDTH = 128\nDISPLAY_HEIGHT = 64\nDISPLAY_HEIGHT += 1")).toContainEqual(expect.stringMatching(/C012 .*size DISPLAY_WIDTH \(= 128\) x DISPLAY_HEIGHT;/));
    expect(consts("DISPLAY_WIDTH = 128\ndef f():\n    global DISPLAY_HEIGHT\n    DISPLAY_HEIGHT = 64")).toContainEqual(expect.stringMatching(/C012 /));
    expect(consts("DISPLAY_WIDTH, DISPLAY_HEIGHT = 128, 64")).toContainEqual(expect.stringMatching(/C012 /));
    expect(consts("DISPLAY_WIDTH = 128")).toContainEqual(expect.stringMatching(/C012 .*x DISPLAY_HEIGHT;/));
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

  it("positions and text through constants are checked like numbers and literals", () => {
    const withConsts = (consts: string, line: string) => issues(draw(line).replace("while True:", `${consts}\nwhile True:`));
    expect(withConsts("ROW = 56", '    oled.text("ok", 0, ROW)')).toEqual([]);
    expect(withConsts("ROW = 60", '    oled.text("ok", 0, ROW)').map((i) => i.message)).toContainEqual(expect.stringMatching(/y = ROW \(= 60\), below the screen/));
    expect(withConsts('TITLE = "A very long title text"', "    oled.text(TITLE, 0, 0)").map((i) => i.message)).toContainEqual(expect.stringMatching(/"A very long title text" is 22 characters, but only 16 fit from x = 0/));
    expect(withConsts('X = 64\nTITLE = "Hello there"', "    oled.text(TITLE, X, 0)").map((i) => i.message)).toContainEqual(expect.stringMatching(/only 8 fit from x = 64/));
    expect(withConsts('TITLE = "Short"', "    oled.text(TITLE, 0, 0)")).toEqual([]);
  });

  it("the model's real code: the █ bar (via a variable) and a 17-character line are errors, the 10 + i*10 rows a warning", () => {
    const found = issues(fixture("wifi-scanner-llm.py"));
    expect(found.filter((i) => i.severity === "error").map((i) => i.message)).toEqual([
      expect.stringMatching(/draws bar on the display, and line \d+ builds it with "█"/),
      expect.stringMatching(/"No networks found" is 17 characters, but only 16 fit from x = 0/), // cut off: an error since M8 8.5
    ]);
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
    expect(issues(draw('    oled.text("Temperature is high", 0, 0)'))[0]).toMatchObject({ severity: "error", message: expect.stringMatching(/19 characters, but only 16 fit from x = 0/) });
    expect(issues(draw('    oled.text("Hello", 96, 0)'))[0]!.message).toMatch(/only 4 fit from x = 96/);
  });

  it("rows at y = 8 * row are fine; text without a display isn't checked", () => {
    expect(issues(draw('    for i in range(8):\n        oled.text("Row " + str(i), 0, i * 8)'))).toEqual([]);
    expect(issues(draw('    oled.text("Hi", 0, 8 + i * 8)'))).toEqual([]);
    const blink = layoutProject([{ kind: "led" }]).build;
    expect(checkMicroPython('from machine import Pin\nimport time\nled = Pin(16, Pin.OUT)\nwhile True:\n    print("°")\n    led.toggle()\n    time.sleep(1)\n', blink, PICO_2_W).issues).toEqual([]);
  });
});

describe("C013: the driver's drawing helpers (M8 8.6)", () => {
  const build = layoutProject([{ kind: "oled" }], undefined, { power: "direct" }).build;
  const draw = (line: string) => `from machine import Pin, I2C\nfrom sh1106 import SH1106_I2C\nimport time\ni2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)\noled = SH1106_I2C(128, 64, i2c)\nwhile True:\n    oled.fill(0)\n${line}\n    oled.show()\n    time.sleep(1)\n`;
  const issues = (line: string) => checkMicroPython(draw(line), build, PICO_2_W).issues.filter((i) => i.code === "C013");
  const messages = (line: string) => issues(line).map((i) => `${i.severity}: ${i.message}`);

  it("icons and styles come from the driver's own tables, and the prompt lists exactly those", () => {
    const pack = PACKS.find((p) => p.meta.id === "oled-sh1106-i2c")!;
    const { ICONS, TEXT_STYLES, BAR_STYLES } = pack.driver!.lists;
    expect(ICONS).toHaveLength(20);
    expect(ICONS).toContain("heart");
    expect(TEXT_STYLES).toEqual(["block", "dots", "seg"]);
    expect(BAR_STYLES).toEqual(["solid", "blocks", "rounded", "slider"]);
    const line = pack.agent!.code.pinLine;
    expect(line).not.toMatch(/\{[A-Z_]+\}/); // every placeholder filled
    expect(line).toContain(`icons: ${ICONS!.join(", ")}.`);
    expect(line).toContain(`Text styles: block, dots, seg (`);
    expect(line).toContain(`bar styles: solid, blocks, rounded, slider.`);
  });

  it("driverLists reads tuples and dict keys at the top level only; a new entry needs no other change", () => {
    const src = 'X = 1\nSTYLES = ("a", "b")\nTABLE = {\n    "one": (".#",), "two": ("#.",),\n    "three": ("##",),\n}\nclass K:\n    INNER = ("no",)\n';
    expect(driverLists(src)).toEqual({ STYLES: ["a", "b"], TABLE: ["one", "two", "three"] });
  });

  it("an icon the driver doesn't have is an error that lists the real ones; real icons and comments pass", () => {
    expect(messages('    oled.icon("rocket", 0, 0, scale=2)')).toEqual([expect.stringMatching(/^error: Line 8 uses the icon "rocket", but sh1106\.py has no icon with that name.*Icons: heart, check.*oled\.sprite/)]);
    expect(issues("    oled.icon('heart', 0, 0)\n    oled.icon(\"thermometer\", 20, 0, 2)")).toEqual([]);
    expect(issues('    oled.text("ok", 0, 0)  # oled.icon("rocket", 0, 0)')).toEqual([]);
    expect(issues("    oled.icon(name, 0, 0)")).toEqual([]); // a variable: not known before the program runs
  });

  it("a text or bar style the driver doesn't have is an error with the real styles; real ones pass", () => {
    expect(messages('    oled.big_text("12", 0, 0, scale=3, style="digital")')).toEqual([expect.stringMatching(/^error: Line 8 uses the text style "digital", but sh1106\.py has no text style with that name.*Text styles: block, dots, seg\./)]);
    expect(messages('    oled.bar(0, 50, 128, 10, 30, 100, style="round")')).toEqual([expect.stringMatching(/bar style "round".*Bar styles: solid, blocks, rounded, slider\./)]);
    expect(issues('    oled.center_text("4:59", 20, scale=3, style="seg")\n    oled.bar(0, 54, 128, 10, 3, 10, style=\'blocks\')\n    oled.big_text("7", 0, 0, 3, 1, "dots")')).toEqual([]);
  });

  it("big text that can't fit across the screen is an error with the real limit", () => {
    expect(messages('    oled.center_text("123456", 20, scale=3)')).toEqual([expect.stringMatching(/^error: Line 8: "123456" is 6 characters, but at scale 3 each letter is 24 pixels wide, so only 5 fit\./)]);
    expect(messages('    oled.big_text("12345", 50, 20)')).toEqual([expect.stringMatching(/"12345" is 5 characters, but at scale 2 each letter is 16 pixels wide, so only 4 fit from x = 50/)]);
    expect(messages('    oled.big_text("12345", 40, 20)')).toEqual([]); // 40 + 5 x 16 = 120: fits
    expect(messages('    oled.big_text("Hello", 0, 0, 3)')).toEqual([]); // 5 x 24 = 120 pixels
    expect(messages('    oled.center_text("Ready to go", 30)')).toEqual([]); // scale 1: 16 fit
    expect(messages('    oled.title("A very long title text")')).toEqual([expect.stringMatching(/only 16 fit/)]);
    expect(messages("    oled.center_text(str(level) + \"%\", 20, scale=3)")).toEqual([]); // not a plain literal: unknown length
  });

  it("characters the font doesn't have are errors in the helpers too", () => {
    expect(messages('    oled.big_text("23°C", 0, 20)')).toEqual([expect.stringMatching(/^error: Line 8 draws "°" on the display/)]);
    expect(messages('    oled.center_text("→ go", 20)')).toEqual([expect.stringMatching(/^error: Line 8 draws "→"/)]);
  });

  it("helper positions don't trigger text() row checks (big text isn't on the 8-pixel rows)", () => {
    expect(issues('    oled.big_text("42", 0, 40)\n    oled.center_text("x", 50, scale=1)\n    oled.center_text("ok", 31, scale=3, style="seg")')).toEqual([]);
  });

  it("big text whose bottom is below the screen is an error with the lowest y that fits (heights from the driver)", () => {
    // The model's #11 (08/11/2026): seg digits at scale 3 are 33 pixels tall, so y = 32 ends at 65.
    expect(messages("    oled.center_text(f'{pot_value}', 32, scale=3, style='seg')")).toEqual([expect.stringMatching(/^error: Line 8: text at y = 32 with scale 3 \(style "seg"\) is 33 pixels tall, so it ends at y = 65, below the 64-pixel screen.*The lowest y that fits is 31\./)]);
    expect(messages('    oled.big_text("42", 0, 60)')).toEqual([expect.stringMatching(/y = 60 with scale 2 is 16 pixels tall.*lowest y that fits is 48/)]);
    expect(messages('    oled.big_text("42", 0, y=50, scale=2, style="dots")')).toEqual([expect.stringMatching(/style "dots"\) is 16 pixels tall/)]);
    expect(messages("    oled.center_text(label, row, scale=3)")).toEqual([]); // y unknown before the program runs
    const pack = PACKS.find((p) => p.meta.id === "oled-sh1106-i2c")!;
    expect(pack.driver!.numbers.TEXT_HEIGHT).toEqual({ block: 8, dots: 8, seg: 11 });
  });

  it("a method the display doesn't have is an error with what to write instead (the model's oled.clear(), 08/11/2026)", () => {
    expect(messages("    oled.clear()")).toEqual([expect.stringMatching(/^error: Line 8 calls oled\.clear\(\), but the display has no clear\(\) method, so the program stops with an error\. Write oled\.fill\(0\) instead\. Its methods: fill, fill_rect, .*show.*big_text/)]);
    expect(messages('    oled.draw_rect(0, 0, 10, 10)')).toEqual([expect.stringMatching(/Write oled\.rect\(x, y, w, h, 1\) instead/)]);
    expect(messages('    oled.sparkle(3)')).toEqual([expect.stringMatching(/no sparkle\(\) method, so the program stops with an error\. Its methods:/)]);
    // framebuf's own methods, the driver's methods and helpers, other objects and comments pass
    expect(issues('    oled.fill_rect(0, 0, 4, 4, 1)\n    oled.ellipse(64, 32, 10, 10, 1, True)\n    oled.scroll(1, 0)\n    oled.contrast(100)\n    oled.graph([1, 2], 0, 12, 128, 52)\n    i2c.scan()\n    # oled.clear()')).toEqual([]);
  });

  it("framebuf's method list is exactly the v1.29.0 firmware's method table", () => {
    const c = readFileSync(new URL("../../../docs/software/micropython-v1.29.0/extmod__modframebuf.c", import.meta.url), "utf8");
    const table = /framebuf_locals_dict_table\[\] = \{([\s\S]*?)\n\};/.exec(c)![1]!;
    expect([...table.matchAll(/MP_QSTR_(\w+)/g)].map((m) => m[1])).toEqual(FRAMEBUF_METHODS);
  });
});
