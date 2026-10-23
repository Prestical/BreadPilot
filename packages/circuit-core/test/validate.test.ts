// Golden tests for every validator rule. Each known-bad circuit
// must produce its code; each good circuit must produce no issues at all.

import { describe, expect, it } from "vitest";
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
