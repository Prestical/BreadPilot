// Repair messages the model can act on (Milestone 8, step 8.2): its own line, the corrected line, the
// exact import line, and which mistakes repeat. Sentences here are general, not from the eval sets.
import { checkMicroPython, layoutProject, PICO_2_W } from "@breadpilot/circuit-core";
import { describe, expect, it } from "vitest";
import { problemKey, repairProblems } from "../src/agent/repair";
import { codeMessages, importBlock, ONBOARD_LED_LINE, pinTable } from "../src/agent/prompts";

const knobAndLed = layoutProject([{ kind: "pot" }, { kind: "led" }]).build;
const knobPin = Object.entries(checkMicroPython("from machine import ADC\nimport time\nk = ADC(26)\n", knobAndLed, PICO_2_W).used).find(([, m]) => m === "adc")?.[0];
const program = (setup: string, imports = "from machine import Pin, PWM") =>
  `${imports}\nimport time\n\n${setup}\nled = PWM(Pin(16))\n\nwhile True:\n    led.duty_u16(knob.read_u16())\n    time.sleep(0.05)\n`;

describe("the checker attaches the corrected line (the code itself is never changed)", () => {
  it("a knob pin set up as a digital Pin → the same line with ADC", () => {
    expect(knobPin).toBe("GP26");
    const issue = checkMicroPython(program("knob = Pin(26, Pin.IN)  # the knob"), knobAndLed, PICO_2_W).issues.find((i) => i.code === "C005")!;
    expect(issue.fix).toEqual({ line: 4, write: "knob = ADC(26)  # the knob" });
  });

  it("an output used as an input keeps the code's own choice of Pin or PWM", () => {
    const b = layoutProject([{ kind: "led" }]).build;
    const pin = checkMicroPython("from machine import Pin\nimport time\nled = Pin(16, Pin.IN)\nwhile True:\n    led.toggle()\n    time.sleep(1)\n", b, PICO_2_W).issues.find((i) => i.code === "C005")!;
    expect(pin.fix?.write).toBe("led = Pin(16, Pin.OUT)");
  });

  it("no fix where one line can't say it", () => {
    const multi = checkMicroPython(program("knob = Pin(\n    26)"), knobAndLed, PICO_2_W).issues.find((i) => i.code === "C005");
    expect(multi?.fix).toBeUndefined();
  });
});

describe("repairProblems", () => {
  const problems = (code: string, previous: string[] = []) => {
    const check = (c: string) => checkMicroPython(c, knobAndLed, PICO_2_W).issues;
    const prev = previous.flatMap(check);
    return repairProblems(code, check(code), prev);
  };

  it("quotes the model's line, gives the corrected line and the full import line", () => {
    const out = problems(program("knob = Pin(26)"));
    const c005 = out.find((p) => p.includes("C005") || p.includes("analog input"))!;
    expect(c005).toContain("Your line 4: `knob = Pin(26)`");
    expect(c005).toContain("Write line 4 as: `knob = ADC(26)`");
    expect(out).toContainEqual("The corrected lines need another import. Write line 1 as: `from machine import Pin, PWM, ADC`.");
  });

  it("a missing machine name gets the whole new import line; a missing module its own line", () => {
    const code = "from machine import Pin\n\nknob = ADC(26)\nled = PWM(Pin(16))\nwhile True:\n    led.duty_u16(knob.read_u16())\n    time.sleep(0.05)\n";
    const out = problems(code);
    expect(out.filter((p) => p.includes("Write line 1 as: `from machine import Pin, ADC, PWM`."))).toHaveLength(2);
    expect(out).toContainEqual(expect.stringContaining("Add this line at the top: `import time`"));
    // Said once in each missing-name problem; no extra import note.
    expect(out.some((p) => p.startsWith("The corrected lines need another import"))).toBe(false);
  });

  it("without any machine import line, says to add one", () => {
    const out = problems("import time\nknob = ADC(26)\nled = PWM(Pin(16))\nwhile True:\n    led.duty_u16(knob.read_u16())\n    time.sleep(0.05)\n");
    expect(out).toContainEqual(expect.stringContaining("Add this line at the top: `from machine import Pin, ADC, PWM`."));
  });

  it("says when a mistake comes back, even on another line", () => {
    const first = program("knob = Pin(26)");
    const again = program("\n# knob\nknob = Pin(26)");
    const out = problems(again, [first]);
    expect(out.find((p) => p.includes("analog input"))).toMatch(/^Same mistake as in your last try, fix it this time: /);
    // A new mistake isn't called a repeat.
    expect(problems(program("knob = Pin(26)"), [program("knob = ADC(26)")]).some((p) => p.startsWith("Same mistake"))).toBe(false);
  });

  it("problemKey ignores line numbers", () => {
    expect(problemKey({ code: "C002", severity: "error", message: "Line 4 uses PWM but it isn't imported." })).toBe(problemKey({ code: "C002", severity: "error", message: "Line 9 uses PWM but it isn't imported." }));
  });

  it("warnings aren't sent back; a clean program has no problems", () => {
    expect(problems(program("knob = ADC(26)", "from machine import Pin, PWM, ADC"))).toEqual([]);
  });
});

describe("pin table and imports", () => {
  it("always names the on-board LED as not a wired pin; the knob line says ADC, not Pin", () => {
    const table = pinTable(layoutProject([{ kind: "pot" }, { kind: "button" }, { kind: "led" }]).blocks, {});
    expect(table.split("\n").at(-1)).toBe(ONBOARD_LED_LINE);
    expect(ONBOARD_LED_LINE).toContain('Pin("LED", Pin.OUT)');
    expect(table).toContain("ADC(26). read_u16() gives 0..65535 as the knob turns. Not Pin(26): a Pin has no read_u16().");
    // Imports live in one block, not in the pin lines (models copied the pin lines' imports and dropped "import time").
    expect(table).not.toMatch(/from \w+ import/);
  });

  it("one import block from every part's pack, with Pin and time always", () => {
    const blocks = (kinds: string[]) => layoutProject(kinds.map((kind) => ({ kind })) as never).blocks;
    expect(importBlock(blocks(["pot", "led", "oled", "button"]))).toEqual(["from machine import Pin, ADC, PWM, I2C", "from sh1106 import SH1106_I2C", "import time"]);
    expect(importBlock(blocks(["oled"]))).toEqual(["from machine import Pin, I2C", "from sh1106 import SH1106_I2C", "import time"]);
    expect(importBlock([])).toEqual(["from machine import Pin", "import time"]);
    expect(importBlock(blocks(["led"]), true)).toEqual(["from machine import Pin, PWM", "import network", "import time"]);
  });

  it("the code prompt carries the block, and allows other imports the code needs", () => {
    const plan = { title: "t", goal: "g", behavior: ["b"], questions: [], parts: [] };
    const user = codeMessages(plan, "- pins", "", undefined, false, ["from machine import Pin, I2C", "import time"])[1]!.content;
    expect(user).toContain("Imports: start the program with these lines. Below them, add an import line for any other module you use (for example \"import random\").\nfrom machine import Pin, I2C\nimport time");
  });
});
