// Golden tests for every validator rule. Each known-bad circuit
// must produce its code; each good circuit must produce no issues at all.

import { describe, expect, it } from "vitest";
import { parseConnections } from "../src/dsl";
import { layoutProject } from "../src/layout";
import type { Build } from "../src/types";
import { validateBuild } from "../src/validate";
import { btn, codes, led, mk, motor, pot, res, sonar } from "./helpers";

const issue = (b: Parameters<typeof validateBuild>[0], code: string) => validateBuild(b).issues.find((i) => i.code === code);

describe("good circuits pass cleanly", () => {
  it("LED with resistor on GP16", () => {
    const b = mk(
      [res("R1", "30h", "33h"), led("LED1", "33g", "34g")],
      `#21(GP16) -> #30j(R1.a)
       #34j(LED1.cathode) -> #38(GND)`,
      { GP16: "out" },
    );
    expect(validateBuild(b)).toEqual({ ok: true, errors: 0, warnings: 0, issues: [] });
  });

  it("button to GND with internal pull-up", () => {
    const b = mk([btn("BTN1", 30)], `#21(GP16) -> #30j(BTN1.1b)\n#32j(BTN1.2b) -> #38(GND)`, { GP16: "in_pullup" });
    expect(codes(b)).toEqual([]);
  });

  it("potentiometer on an ADC pin", () => {
    const b = mk(
      [pot("POT1", 30)],
      `#36(3V3) -> #30j(POT1.end1)\n#31(GP26) -> #31j(POT1.wiper)\n#32j(POT1.end2) -> #38(GND)`,
      { GP26: "adc" },
    );
    expect(codes(b)).toEqual([]);
  });

  it("HC-SR04 on 5 V with a 1k/2k divider on ECHO", () => {
    const b = mk(
      [sonar("US1", 30), res("R1", "32h", "36h", 1000), res("R2", "36g", "40g", 2000)],
      `#40(VBUS) -> #30j(US1.vcc)
       #33j(US1.gnd) -> #38(GND)
       #21(GP16) -> #31j(US1.trig)
       #22(GP17) -> #36j(R1.b)
       #40j(R2.b) -> #28(GND)`,
      { GP16: "out", GP17: "in" },
    );
    expect(codes(b)).toEqual([]);
  });

  it("supports rails and auto-picked columns", () => {
    const b = mk(
      [res("R1", "30h", "33h"), led("LED1", "33g", "34g")],
      `#38(GND) -> #RR-(GND)
       #21(GP16) -> #30(R1.a)
       #34(LED1.cathode) -> #RR-(GND)`,
      { GP16: "out" },
    );
    expect(codes(b)).toEqual([]);
  });
});

describe("E001 short circuit", () => {
  it("3V3 straight to GND", () => {
    expect(codes(mk([], "#36(3V3) -> #38(GND)"))).toEqual(["E001"]);
  });

  it("3V3 to GND through a button: a short only while pressed", () => {
    const b = mk([btn("BTN1", 30)], `#36(3V3) -> #30j(BTN1.1b)\n#32j(BTN1.2b) -> #38(GND)`);
    expect(codes(b)).toEqual(["E001"]);
    expect(issue(b, "E001")!.when).toBe("when BTN1 is pressed");
  });

  it("VBUS to GND via the power rails", () => {
    expect(codes(mk([], "#40(VBUS) -> #RL+\n#RL+ -> #RL-\n#RL- -> #3(GND)"))).toContain("E001");
  });
});

describe("E002 / W007 joined supplies", () => {
  it("3V3 to VBUS is an error", () => {
    expect(codes(mk([], "#36(3V3) -> #40(VBUS)"))).toEqual(["E002"]);
  });
  it("VBUS to VSYS is only a warning (allowed on USB power, datasheet §3.5)", () => {
    expect(codes(mk([], "#39(VSYS) -> #40(VBUS)"))).toEqual(["W007"]);
  });
});

describe("E003 GPIO tied directly", () => {
  it("output straight to GND", () => {
    expect(codes(mk([], "#21(GP16) -> #38(GND)", { GP16: "out" }))).toEqual(["E003"]);
  });
  it("input permanently tied to GND", () => {
    expect(codes(mk([], "#21(GP16) -> #38(GND)", { GP16: "in" }))).toEqual(["E003"]);
  });
  it("two outputs joined", () => {
    expect(codes(mk([], "#21(GP16) -> #22(GP17)", { GP16: "out", GP17: "out" }))).toEqual(["E003"]);
  });
  it("output shorted to GND only when a button is pressed", () => {
    const b = mk([btn("BTN1", 30)], `#21(GP16) -> #30j(BTN1.1b)\n#32j(BTN1.2b) -> #38(GND)`, { GP16: "out" });
    expect(codes(b)).toEqual(["E003"]);
    expect(issue(b, "E003")!.when).toBe("when BTN1 is pressed");
  });
});

describe("E004 LED without resistor", () => {
  it("GPIO → LED → GND", () => {
    const b = mk([led("LED1", "30g", "31g")], `#21(GP16) -> #30j(LED1.anode)\n#31j(LED1.cathode) -> #38(GND)`, { GP16: "out" });
    expect(codes(b)).toEqual(["E004"]);
  });
  it("3V3 → LED → LED → GND (still no resistor)", () => {
    const b = mk(
      [led("LED1", "30g", "31g"), led("LED2", "31h", "32h")],
      `#36(3V3) -> #30j(LED1.anode)\n#32j(LED2.cathode) -> #38(GND)`,
    );
    expect(codes(b)).toEqual(["E004", "E004"]);
    expect(validateBuild(b).issues.filter((i) => i.code === "E004").map((i) => i.parts)).toEqual([["LED1"], ["LED2"]]);
  });
});

describe("E005 part shorted by the breadboard", () => {
  it("resistor with both legs in the same strip", () => {
    const b = mk([res("R1", "30g", "30h")], "#21(GP16) -> #30j(R1.a)", { GP16: "out" });
    expect(codes(b)).toEqual(["E005"]);
  });
  it("button rotated so it is always pressed", () => {
    const b = mk([{ ref: "BTN1", type: "button-6mm", legs: { "1a": "30g", "2a": "30h", "1b": "32g", "2b": "32h" } }], "");
    expect(codes(b)).toContain("E005");
    expect(issue(b, "E005")!.message).toMatch(/always pressed/);
  });
});

describe("E006 unknown or mismatched names", () => {
  it("pin name doesn't match pin number", () => {
    const b = mk([], "#33(GP15) -> #38(GND)");
    expect(codes(b)).toEqual(["E006"]);
    expect(issue(b, "E006")!.message).toContain("pin 33 is GND, not GP15");
  });
  it("pin number out of range", () => {
    expect(codes(mk([], "#41(GND) -> #30a"))).toEqual(["E006"]);
  });
  it("label names a part that doesn't exist", () => {
    expect(codes(mk([], "#21(GP16) -> #30j(LED9)", { GP16: "out" }))).toEqual(["E006"]);
  });
  it("label names the wrong leg for that row", () => {
    const b = mk([res("R1", "30h", "33h"), led("LED1", "33g", "34g")], "#21(GP16) -> #34j(LED1.anode)", { GP16: "out" });
    expect(codes(b)).toContain("E006");
  });
  it("row without column that doesn't hold the named part", () => {
    const b = mk([res("R1", "30h", "33h")], "#21(GP16) -> #40(R1)", { GP16: "out" });
    expect(issue(b, "E006")!.message).toMatch(/can't tell which hole/);
  });
  it("unknown component type", () => {
    expect(codes(mk([{ ref: "X1", type: "flux-capacitor", legs: {} }], ""))).toEqual(["E006"]);
  });
  it("GPIO mode on something that isn't a GPIO", () => {
    expect(codes(mk([], "", { GP30: "out" }))).toEqual(["E006"]);
  });
});

describe("E007 more than 3.3 V into a GPIO", () => {
  it("GPIO wired to VBUS", () => {
    expect(codes(mk([], "#21(GP16) -> #40(VBUS)", { GP16: "in" }))).toContain("E007");
  });
  it("HC-SR04 ECHO (5 V) straight into a GPIO", () => {
    const b = mk(
      [sonar("US1", 30)],
      `#40(VBUS) -> #30j(US1.vcc)
       #33j(US1.gnd) -> #38(GND)
       #21(GP16) -> #31j(US1.trig)
       #22(GP17) -> #32j(US1.echo)`,
      { GP16: "out", GP17: "in" },
    );
    expect(codes(b)).toEqual(["E007"]);
    expect(issue(b, "E007")!.message).toMatch(/voltage divider/);
  });
});

describe("E008 analog on a non-ADC pin", () => {
  it("adc mode on GP16", () => {
    expect(codes(mk([], "", { GP16: "adc" }))).toEqual(["E008"]);
  });
  it("potentiometer wiper into a digital-only GPIO", () => {
    const b = mk(
      [pot("POT1", 30)],
      `#36(3V3) -> #30j(POT1.end1)\n#21(GP16) -> #31j(POT1.wiper)\n#32j(POT1.end2) -> #38(GND)`,
      { GP16: "in" },
    );
    expect(codes(b)).toEqual(["E008"]);
  });
  it("potentiometer on an ADC pin but not in adc mode", () => {
    const b = mk(
      [pot("POT1", 30)],
      `#36(3V3) -> #30j(POT1.end1)\n#31(GP26) -> #31j(POT1.wiper)\n#32j(POT1.end2) -> #38(GND)`,
      { GP26: "in" },
    );
    expect(issue(b, "E008")!.message).toMatch(/set GP26 to "adc"/);
  });
});

describe("E009 bus pins", () => {
  it("I2C1 SDA on a pin that only has I2C0 SDA", () => {
    const b = mk([], "", { GP4: "i2c1_sda", GP5: "i2c1_scl" });
    expect(codes(b)).toEqual(["E009", "E009"]);
  });
  it("I2C bus missing SCL", () => {
    expect(codes(mk([], "", { GP4: "i2c0_sda" }))).toEqual(["E009"]);
  });
  it("SPI bus missing SCK", () => {
    expect(codes(mk([], "", { GP19: "spi0_tx" }))).toEqual(["E009"]);
  });
  it("valid I2C0 pair passes", () => {
    expect(codes(mk([], "", { GP4: "i2c0_sda", GP5: "i2c0_scl" }))).toEqual([]);
  });
});

describe("E010 internal-only GPIOs", () => {
  it("wire to GP25", () => {
    expect(codes(mk([], "#25(GP25) -> #30a"))).toEqual(["E010"]);
  });
  it("mode on GP23", () => {
    expect(codes(mk([], "", { GP23: "out" }))).toEqual(["E010"]);
  });
});

describe("E011 input pin used to light an LED", () => {
  it("GPIO set to input drives an LED", () => {
    const b = mk(
      [res("R1", "30h", "33h"), led("LED1", "33g", "34g")],
      `#21(GP16) -> #30j(R1.a)\n#34j(LED1.cathode) -> #38(GND)`,
      { GP16: "in_pullup" },
    );
    expect(codes(b)).toEqual(["E011"]);
  });
});

describe("E012 GPIO without a mode", () => {
  it("wired GPIO with no declared mode", () => {
    expect(codes(mk([], "#21(GP16) -> #30j"))).toEqual(["E012"]);
  });
});

describe("E013 physical hole problems", () => {
  it("two legs in the same hole", () => {
    const b = mk([res("R1", "30g", "33g"), led("LED1", "30g", "31g")], "");
    expect(codes(b)).toContain("E013");
  });
  it("leg under the Pico board", () => {
    expect(codes(mk([res("R1", "5d", "30d")], ""))).toContain("E013");
  });
  it("hole that doesn't exist", () => {
    expect(codes(mk([res("R1", "70a", "30d")], ""))).toContain("E013");
  });
  it("more jumpers on one Pico pin than free holes", () => {
    const b = mk([], "#38(GND) -> #30j\n#38(GND) -> #31j\n#38(GND) -> #32j");
    expect(codes(b)).toEqual(["E013"]);
  });
});

describe("W001 3V3 overload", () => {
  it("three motors on 3V3 (~450 mA > 300 mA)", () => {
    const b = mk(
      [motor("M1", "30g", "31g"), motor("M2", "33g", "34g"), motor("M3", "36g", "37g")],
      `#36(3V3) -> #RR+
       #38(GND) -> #RR-
       #30j(M1.a) -> #RR+
       #31j(M1.b) -> #RR-
       #33j(M2.a) -> #RR+
       #34j(M2.b) -> #RR-
       #36j(M3.a) -> #RR+
       #37j(M3.b) -> #RR-`,
    );
    expect(codes(b)).toEqual(["W001"]);
  });
});

describe("W002 high-current part on a GPIO", () => {
  it("motor driven straight from GP16", () => {
    const b = mk([motor("M1", "30g", "31g")], `#21(GP16) -> #30j(M1.a)\n#31j(M1.b) -> #38(GND)`, { GP16: "out" });
    expect(codes(b)).toEqual(["W002"]);
  });
});

describe("W003 inputs that can't read correctly", () => {
  it("floating input (no pull resistor)", () => {
    const b = mk([btn("BTN1", 30)], `#21(GP16) -> #30j(BTN1.1b)\n#32j(BTN1.2b) -> #38(GND)`, { GP16: "in" });
    expect(codes(b)).toEqual(["W003"]);
  });
  it("pull-up with the button to 3V3 always reads 1", () => {
    const b = mk([btn("BTN1", 30)], `#21(GP16) -> #30j(BTN1.1b)\n#32j(BTN1.2b) -> #36(3V3)`, { GP16: "in_pullup" });
    expect(codes(b)).toEqual(["W003"]);
    expect(issue(b, "W003")!.message).toMatch(/always reads 1/);
  });
  it("pull-down with the button to GND always reads 0", () => {
    const b = mk([btn("BTN1", 30)], `#21(GP16) -> #30j(BTN1.1b)\n#32j(BTN1.2b) -> #38(GND)`, { GP16: "in_pulldown" });
    expect(issue(b, "W003")!.message).toMatch(/always reads 0/);
  });
});

describe("W005 control pins to GND", () => {
  it("RUN to GND holds the Pico in reset", () => {
    expect(codes(mk([], "#30(RUN) -> #38(GND)"))).toEqual(["W005"]);
  });
  it("3V3_EN to GND turns off 3.3 V", () => {
    expect(issue(mk([], "#37(3V3_EN) -> #38(GND)"), "W005")!.message).toMatch(/turns off/);
  });
});

describe("W006 ADC_VREF used", () => {
  it("anything wired to ADC_VREF", () => {
    expect(codes(mk([], "#35(ADC_VREF) -> #30j"))).toEqual(["W006"]);
  });
});

describe("W008 incomplete circuits", () => {
  it("LED that isn't connected", () => {
    expect(codes(mk([led("LED1", "30g", "31g")], ""))).toEqual(["W008"]);
  });
  it("sensor without power", () => {
    const b = mk([sonar("US1", 30)], `#33j(US1.gnd) -> #38(GND)`);
    expect(codes(b)).toEqual(["W008"]);
  });
  it("resistor that isn't connected", () => {
    expect(codes(mk([res("R1", "30g", "33g")], ""))).toEqual(["W008"]);
  });
});

describe("W009 LED backwards", () => {
  it("anode toward GND", () => {
    const b = mk(
      [res("R1", "30h", "33h"), led("LED1", "34g", "33g")],
      `#21(GP16) -> #30j(R1.a)\n#34j(LED1.anode) -> #38(GND)`,
      { GP16: "out" },
    );
    expect(codes(b)).toEqual(["W009"]);
  });
});

describe("W010 supply voltage out of range", () => {
  it("HC-SR04 on 3V3", () => {
    const b = mk(
      [sonar("US1", 30)],
      `#36(3V3) -> #30j(US1.vcc)
       #33j(US1.gnd) -> #38(GND)
       #21(GP16) -> #31j(US1.trig)
       #22(GP17) -> #32j(US1.echo)`,
      { GP16: "out", GP17: "in" },
    );
    expect(codes(b)).toEqual(["W010"]);
  });
});

describe("report shape", () => {
  it("sorts errors before warnings and counts them", () => {
    const r = validateBuild(mk([led("LED1", "40g", "41g")], "#36(3V3) -> #38(GND)"));
    expect(r.ok).toBe(false);
    expect(r.errors).toBe(1);
    expect(r.warnings).toBe(1);
    expect(r.issues.map((i) => i.code)).toEqual(["E001", "W008"]);
  });
  it("rejects unknown boards", () => {
    expect(codes({ boardId: "arduino-uno", parts: [], wires: [], gpioModes: {} })).toEqual(["E006"]);
  });
});

// More than MAX_EXHAUSTIVE_SWITCHES contacts: not every combination is tried, but no short may be
// missed. Buttons sit at rows 24, 28 … 56 (contacts on rows r and r + 2); a slide switch at rows 60-62.
describe("many switches (more than 8 contacts)", () => {
  const rows = [24, 28, 32, 36, 40, 44, 48, 52, 56];
  const buttons = (n: number) => rows.slice(0, n).map((r, i) => btn(`BTN${i + 1}`, r));
  const slide = { ref: "SW1", type: "slide-switch", legs: { end1: "60a", com: "61a", end2: "62a" } };

  it("finds a short that needs two buttons pressed, with a slide switch present", () => {
    // 8 buttons + 2 slide contacts = 10. Before, the slide switch removed the "all pressed" state.
    const b = mk(
      [...buttons(8), slide],
      `#36(3V3) -> #24j(BTN1.1b)
       #26j(BTN1.2b) -> #28j(BTN2.1b)
       #30j(BTN2.2b) -> #38(GND)`,
    );
    expect(issue(b, "E001")?.when).toBe("when BTN1 and BTN2 are pressed");
  });

  it("finds a short that needs three contacts, through the slide switch's second side", () => {
    const b = mk(
      [...buttons(9), slide],
      `#36(3V3) -> #61b(SW1.com)
       #62b(SW1.end2) -> #24j(BTN1.1b)
       #26j(BTN1.2b) -> #28j(BTN2.1b)
       #30j(BTN2.2b) -> #38(GND)`,
    );
    const short = issue(b, "E001");
    expect(short).toBeDefined();
    expect(short!.when).toMatch(/SW1 is slid toward outer leg 3/);
  });

  it("finds an output shorted to GND through three buttons", () => {
    const b = mk(
      [...buttons(9)],
      `#21(GP16) -> #24j(BTN1.1b)
       #26j(BTN1.2b) -> #28j(BTN2.1b)
       #30j(BTN2.2b) -> #32j(BTN3.1b)
       #34j(BTN3.2b) -> #38(GND)`,
      { GP16: "out" },
    );
    expect(codes(b)).toContain("E003");
  });

  it("nine buttons on their own inputs and a slide switch: no false alarms", () => {
    const pins: [number, string][] = [[20, "GP15"], [21, "GP16"], [22, "GP17"], [24, "GP18"], [25, "GP19"], [26, "GP20"], [27, "GP21"], [29, "GP22"], [19, "GP14"]];
    const grounds = [3, 3, 8, 8, 13, 13, 18, 18, 23];
    const lines = rows.map((r, i) => `#${pins[i]![0]}(${pins[i]![1]}) -> #${r}j(BTN${i + 1}.1b)\n#${r + 2}j(BTN${i + 1}.2b) -> #${grounds[i]}(GND)`);
    lines.push(`#17(GP13) -> #61b(SW1.com)`, `#60b(SW1.end1) -> #28(GND)`);
    const modes = Object.fromEntries([...pins.map(([, g]) => g), "GP13"].map((g) => [g, "in_pullup" as const]));
    const b = mk([...buttons(9), slide], lines.join("\n"), modes);
    expect(codes(b)).toEqual([]);
  });
});

// M18 18.3: currents from the RP2350 datasheet (pads start at 4 mA drive; all GPIOs together at most
// 100 mA sourced and 100 mA sunk) and resistor power. LED forward voltages are the pack's typical ones.
describe("GPIO current and resistor power", () => {
  const ledOn = (n: number, pin: [number, string], gnd: number, ohms: number) => {
    const r = 24 + 5 * n;
    return {
      parts: [res(`R${n + 1}`, `${r}h`, `${r + 3}h`, ohms), led(`LED${n + 1}`, `${r + 3}g`, `${r + 4}g`)],
      dsl: `#${pin[0]}(${pin[1]}) -> #${r}j(R${n + 1}.a)\n#${r + 4}j(LED${n + 1}.cathode) -> #${gnd}(GND)`,
    };
  };

  it("a red LED through 330 Ω stays under the pin's 4 mA (no issues)", () => {
    const l = ledOn(0, [21, "GP16"], 38, 330);
    expect(codes(mk(l.parts, l.dsl, { GP16: "out" }))).toEqual([]);
  });

  it("W011: a red LED through 100 Ω wants about 13 mA from one pin", () => {
    const l = ledOn(0, [21, "GP16"], 38, 100);
    const b = mk(l.parts, l.dsl, { GP16: "out" });
    expect(codes(b)).toEqual(["W011"]);
    expect(issue(b, "W011")!.message).toMatch(/GP16 \(pin 21\) would give about 13 mA when HIGH, more than the 4 mA/);
  });

  it("W011: an LED lit when the pin is LOW (from 3V3) counts as current into the pin", () => {
    const b = mk(
      [res("R1", "30h", "33h", 100), led("LED1", "33g", "34g")],
      `#36(3V3) -> #30j(R1.a)\n#34j(LED1.cathode) -> #21(GP16)`,
      { GP16: "out" },
    );
    expect(issue(b, "W011")!.message).toMatch(/take about 13 mA when LOW/);
  });

  it("a pull-down resistor on an output is a tiny current (no issues)", () => {
    const b = mk([res("R1", "30h", "33h", 10000)], `#21(GP16) -> #30j(R1.a)\n#33j(R1.b) -> #38(GND)`, { GP16: "out" });
    expect(codes(b)).toEqual([]);
  });

  it("E016: eight LEDs at about 13 mA each pass the 100 mA limit for all GPIOs together", () => {
    const pins: [number, string][] = [[21, "GP16"], [22, "GP17"], [24, "GP18"], [25, "GP19"], [26, "GP20"], [27, "GP21"], [29, "GP22"], [20, "GP15"]];
    const grounds = [3, 3, 8, 8, 13, 13, 18, 18];
    const ls = pins.map((p, i) => ledOn(i, p, grounds[i]!, 100));
    const b = mk(ls.flatMap((l) => l.parts), ls.map((l) => l.dsl).join("\n"), Object.fromEntries(pins.map(([, g]) => [g, "out" as const])));
    expect(codes(b).filter((c) => c === "E016")).toEqual(["E016"]);
    expect(issue(b, "E016")!.message).toMatch(/all outputs HIGH at once the GPIOs give about 104 mA together .*more than the 100 mA/);
  });

  it("eight red LEDs through 330 Ω stay well under the total (no issues)", () => {
    const pins: [number, string][] = [[21, "GP16"], [22, "GP17"], [24, "GP18"], [25, "GP19"], [26, "GP20"], [27, "GP21"], [29, "GP22"], [20, "GP15"]];
    const grounds = [3, 3, 8, 8, 13, 13, 18, 18];
    const ls = pins.map((p, i) => ledOn(i, p, grounds[i]!, 330));
    expect(codes(mk(ls.flatMap((l) => l.parts), ls.map((l) => l.dsl).join("\n"), Object.fromEntries(pins.map(([, g]) => [g, "out" as const]))))).toEqual([]);
  });

  it("E017: 22 Ω straight from 3V3 to GND burns about 495 mW in a 250 mW resistor", () => {
    const b = mk([res("R1", "30h", "33h", 22)], `#36(3V3) -> #30j(R1.a)\n#33j(R1.b) -> #38(GND)`);
    expect(codes(b)).toEqual(["E017"]);
    expect(issue(b, "E017")!.message).toMatch(/R1 \(22 Ω\) would turn about 495 mW into heat with 150 mA through it, more than the 250 mW/);
  });

  it("W001 counts current through resistors too: 10 Ω from 3V3 to GND is 330 mA", () => {
    const b = mk([res("R1", "30h", "33h", 10)], `#36(3V3) -> #30j(R1.a)\n#33j(R1.b) -> #38(GND)`);
    expect(codes(b)).toEqual(["E017", "W001"]);
    expect(issue(b, "W001")!.message).toMatch(/about 330 mA/);
  });

  it("a button that closes a low-resistance path is checked while pressed", () => {
    const b = mk(
      [btn("BTN1", 30), res("R1", "34h", "37h", 100), led("LED1", "37g", "38g")],
      `#21(GP16) -> #30j(BTN1.1b)\n#32j(BTN1.2b) -> #34j(R1.a)\n#38j(LED1.cathode) -> #38(GND)`,
      { GP16: "out" },
    );
    expect(issue(b, "W011")?.when).toBe("when BTN1 is pressed");
  });
});

// M18 18.4: gaps found by breaking good circuits (test/breaks.test.ts).
describe("found by breaking good circuits", () => {
  const dht = () => layoutProject([{ kind: "dht11" }]).build;
  const legsOf = (b: Build, ref: string) => b.parts.find((p) => p.ref === ref)!.legs;
  const unlabel = (b: Build) => {
    for (const w of b.wires) for (const e of [w.from, w.to]) if (e.kind === "hole") delete e.label;
    return b;
  };

  it("the engine's DHT11 block is clean", () => {
    expect(codes(dht())).toEqual([]);
  });

  it("E018: a module in the wrong way round (supply and GND legs swapped)", () => {
    const b = unlabel(dht());
    const l = legsOf(b, "DHT1");
    [l.vcc, l.gnd] = [l.gnd!, l.vcc!];
    expect(codes(b)).toContain("E018");
    expect(issue(b, "E018")!.message).toMatch(/GND \(leg 4\) is connected to 3V3 \(pin 36\)\. DHT1 is in the wrong way round/);
  });

  it("W008: a powered module whose GND leg goes nowhere", () => {
    const b = dht();
    const gndRow = Number(/^\d+/.exec(legsOf(b, "DHT1").gnd!)![0]);
    b.wires = b.wires.filter((w) => !(w.from.kind === "hole" && w.from.row === gndRow) && !(w.to.kind === "hole" && w.to.row === gndRow));
    expect(codes(b)).toEqual(["W008"]);
    expect(issue(b, "W008")!.message).toBe("DHT1 GND (leg 4) isn't connected to GND, so DHT1 won't work.");
  });

  it("W012: a DHT11 without its pull-up resistor", () => {
    const b = dht();
    b.parts = b.parts.filter((p) => p.type !== "resistor");
    expect(codes(b)).toEqual(["W012"]);
    expect(issue(b, "W012")!.message).toMatch(/^DHT1 DATA \(leg 2\) needs a pull-up resistor .*from DATA to VCC/);
  });

  it("E007: an analog output that follows a 5 V supply (water level sensor on VBUS)", () => {
    const b = unlabel(layoutProject([{ kind: "water-level" }]).build);
    const l = legsOf(b, "WL1");
    const row = Number(/^\d+/.exec(l.vcc!)![0]);
    b.wires = b.wires.filter((w) => !(w.to.kind === "hole" && w.to.row === row) && !(w.from.kind === "hole" && w.from.row === row));
    b.wires.push(...parseConnections(`#40(VBUS) -> #${row}j`).wires);
    expect(codes(b)).toContain("E007");
    expect(issue(b, "E007")!.message).toMatch(/can rise to the module's ~5 V supply/);
  });

  it("W009: a backwards LED is found even when other parts share its GND strip", () => {
    const b = unlabel(layoutProject([{ kind: "led" }, { kind: "pot" }, { kind: "dht11" }]).build);
    const l = legsOf(b, "LED1");
    [l.anode, l.cathode] = [l.cathode!, l.anode!];
    expect(codes(b)).toEqual(["W009"]);
  });

  it("a backwards LED next to a button is W009, not E011 (a pressed button joins the input to GND)", () => {
    const b = unlabel(layoutProject([{ kind: "led" }, { kind: "button" }]).build);
    const l = legsOf(b, "LED1");
    [l.anode, l.cathode] = [l.cathode!, l.anode!];
    expect(codes(b)).toEqual(["W009"]);
  });
});

// M18 18.5: rules and branches no test reached, found by mutation testing (npm run mutation -w
// @breadpilot/circuit-core). Each test fails when its line of validate.ts is changed.
describe("found by mutation testing", () => {
  const redLed = (pin: string, row = 30) => ({
    parts: [res("R1", `${row}h`, `${row + 3}h`), led("LED1", `${row + 3}g`, `${row + 4}g`)],
    dsl: `${pin} -> #${row}j(R1.a)\n#${row + 4}j(LED1.cathode) -> #38(GND)`,
  });

  it("W006: anything wired to ADC_VREF", () => {
    expect(codes(mk([], "#35(ADC_VREF) -> #30j"))).toContain("W006");
  });

  it("E012: a wired GPIO with no mode", () => {
    const l = redLed("#21(GP16)");
    expect(codes(mk(l.parts, l.dsl))).toContain("E012");
  });

  it("E002: 3V3 joined to VSYS (not only VBUS)", () => {
    expect(codes(mk([], "#36(3V3) -> #39(VSYS)"))).toContain("E002");
  });

  it("E008: a knob's wiper on a pin without an ADC, or on an ADC pin not in adc mode", () => {
    const knob = (pin: string) => mk([pot("POT1", 30)], `#36(3V3) -> #30j(POT1.end1)\n${pin} -> #31j(POT1.wiper)\n#32j(POT1.end2) -> #38(GND)`, { GP16: "in", GP26: "in" });
    expect(issue(knob("#21(GP16)"), "E008")!.message).toMatch(/GP16 \(pin 21\) can't read analog values; use GP26, GP27 or GP28/);
    expect(issue(knob("#31(GP26)"), "E008")!.message).toMatch(/set GP26 to "adc" mode/);
  });

  it("E004: a button that bypasses the LED's resistor while pressed", () => {
    const l = redLed("#21(GP16)");
    const b = mk([...l.parts, btn("BTN1", 40)], `${l.dsl}\n#30i -> #40j(BTN1.1b)\n#42j(BTN1.2b) -> #33i`, { GP16: "out" });
    expect(codes(b)).toContain("E004");
  });

  it("an LED in series with a button is a complete circuit (it lights while pressed)", () => {
    const b = mk(
      [btn("BTN1", 40), res("R1", "30h", "33h"), led("LED1", "33g", "34g")],
      `#21(GP16) -> #40j(BTN1.1b)\n#42j(BTN1.2b) -> #30j(R1.a)\n#34j(LED1.cathode) -> #38(GND)`,
      { GP16: "out" },
    );
    expect(codes(b)).toEqual([]);
  });

  it("a slide switch between 3V3 and GND isn't a short: its two sides are never closed together", () => {
    const sw = { ref: "SW1", type: "slide-switch", legs: { end1: "30a", com: "31a", end2: "32a" } };
    const b = mk([sw], `#36(3V3) -> #30b(SW1.end1)\n#31b(SW1.com) -> #21(GP16)\n#32b(SW1.end2) -> #38(GND)`, { GP16: "in" });
    expect(codes(b)).not.toContain("E001");
  });

  it("E016: eight LEDs lit while their pins are LOW take more than 100 mA together", () => {
    const pins: [number, string][] = [[21, "GP16"], [22, "GP17"], [24, "GP18"], [25, "GP19"], [26, "GP20"], [27, "GP21"], [29, "GP22"], [20, "GP15"]];
    const parts = pins.flatMap((_, i) => [res(`R${i + 1}`, `${24 + 5 * i}h`, `${27 + 5 * i}h`, 100), led(`LED${i + 1}`, `${27 + 5 * i}g`, `${28 + 5 * i}g`)]);
    const dsl = ["#36(3V3) -> #RR+(3V3)", ...pins.flatMap(([phys, name], i) => [`#RR+(3V3) -> #${24 + 5 * i}j(R${i + 1}.a)`, `#${28 + 5 * i}j(LED${i + 1}.cathode) -> #${phys}(${name})`])].join("\n");
    const b = mk(parts, dsl, Object.fromEntries(pins.map(([, g]) => [g, "out" as const])));
    expect(issue(b, "E016")!.message).toMatch(/all outputs LOW at once the GPIOs take about 104 mA together/);
  });

  it("E017 through a GPIO: 10 Ω from GP16 to GND", () => {
    const b = mk([res("R1", "30h", "33h", 10)], "#21(GP16) -> #30j(R1.a)\n#33j(R1.b) -> #38(GND)", { GP16: "out" });
    expect(codes(b)).toEqual(expect.arrayContaining(["E017", "W011", "E016"]));
  });

  it("E017 into a GPIO: 10 Ω from 3V3 to GP16 while it's LOW", () => {
    const b = mk([res("R1", "30h", "33h", 10)], "#36(3V3) -> #30j(R1.a)\n#33j(R1.b) -> #21(GP16)", { GP16: "out" });
    expect(issue(b, "E017")!.message).toMatch(/R1 \(10 Ω\) would turn about 1089 mW into heat with 330 mA/);
  });

  it("current from VBUS doesn't count toward the 3V3 pin's load (W001)", () => {
    const b = mk([res("R1", "30h", "33h", 10)], "#40(VBUS) -> #30j(R1.a)\n#33j(R1.b) -> #38(GND)");
    expect(codes(b)).toEqual(["E017"]);
  });

  it("W001 counts known part loads between 3V3 and GND (three 150 mA motors on the rails)", () => {
    const rows = [30, 40, 50];
    const dsl = ["#36(3V3) -> #RR+(3V3)", "#38(GND) -> #RR-(GND)", ...rows.flatMap((r, i) => [`#RR+(3V3) -> #${r}j(M${i + 1}.a)`, `#${r + 1}j(M${i + 1}.b) -> #RR-(GND)`])].join("\n");
    const b = mk(rows.map((r, i) => motor(`M${i + 1}`, `${r}g`, `${r + 1}g`)), dsl);
    expect(issue(b, "W001")!.message).toMatch(/about 450 mA, more than the 300 mA/);
  });

  it("an unpowered module gets one W008 (no power), not a second one for its GND", () => {
    const b = layoutProject([{ kind: "dht11" }]).build;
    const vcc = Number(/^\d+/.exec(b.parts.find((p) => p.ref === "DHT1")!.legs.vcc!)![0]);
    b.wires = b.wires.filter((w) => !(w.from.kind === "hole" && w.from.row === vcc) && !(w.to.kind === "hole" && w.to.row === vcc));
    expect(codes(b).filter((c) => c === "W008")).toHaveLength(1);
  });

  it("messages: W005 for 3V3_EN, E005 for a shorted-out LED, E007 for an I2C module on 5 V", () => {
    expect(issue(mk([], "#37(3V3_EN) -> #38(GND)"), "W005")!.message).toMatch(/turns off the Pico's 3.3 V supply/);
    const shorted = mk([res("R1", "30h", "33h"), led("LED1", "33g", "33f")], "#21(GP16) -> #30j(R1.a)", { GP16: "out" });
    expect(issue(shorted, "E005")!.message).toMatch(/LED1 is shorted out: its .* are in the same connected strip/);
    const oled = layoutProject([{ kind: "oled" }]).build;
    oled.wires = oled.wires.map((w) => (w.from.kind === "pico" && w.from.phys === 36 ? { ...w, from: { kind: "pico", phys: 40, label: "VBUS" } } : w));
    expect(validateBuild(oled).issues.find((i) => i.code === "E007")?.message).toMatch(/can be pulled up to the module's ~5 V supply/);
  });
});
