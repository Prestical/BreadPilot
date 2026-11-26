// M18 18.7a: the Pico 2 W's machine and time names, generated from MicroPython v1.29.0's source
// (scripts/gen-api.ts). If the source files change, these tests say what changed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { API_FILE, apiText, buildApi } from "../scripts/gen-api";
import { MICROPYTHON_API } from "../src/micropython-api";

describe("the Pico 2 W's machine and time names (from MicroPython v1.29.0's source)", () => {
  it("the generated file is up to date (npm run gen:api -w @breadpilot/circuit-core)", () => {
    expect(readFileSync(API_FILE, "utf8")).toBe(apiText());
  });

  it("PWM has no duty(), ADC has only read_u16(): the switches that remove them are named", () => {
    const c = MICROPYTHON_API.classes;
    expect(c.PWM.methods).toEqual(["init", "deinit", "freq", "duty_u16", "duty_ns"]);
    expect(c.PWM.notOnThePico).toEqual([{ name: "duty", because: "#if MICROPY_PY_MACHINE_PWM_DUTY" }]);
    expect(c.ADC.methods).toEqual(["read_u16"]);
    expect(c.ADC.constants).toEqual(["CORE_TEMP"]);
    expect(c.ADC.notOnThePico.map((x) => x.name)).toEqual(["init", "deinit", "block", "read_uv", "atten", "width", "read", "read_timed", "busy"]);
  });

  it("Pin, I2C, Timer and time", () => {
    const c = MICROPYTHON_API.classes;
    expect(c.Pin.methods).toEqual(["init", "value", "low", "high", "off", "on", "toggle", "irq", "board", "cpu"]);
    expect(c.Pin.constants).toEqual(expect.arrayContaining(["IN", "OUT", "OPEN_DRAIN", "PULL_UP", "PULL_DOWN", "IRQ_RISING", "IRQ_FALLING", "ALT_PIO2", "ALT_HSTX"]));
    expect(c.Pin.args).toEqual({ init: ["mode", "pull", "value", "alt"], irq: ["handler", "trigger", "hard"] });
    expect(c.PWM.args.init).toEqual(["freq", "duty_u16", "duty_ns", "invert"]);
    expect(c.I2C.methods).toEqual(expect.arrayContaining(["scan", "readfrom", "writeto", "readfrom_mem", "writeto_mem", "readfrom_mem_into"]));
    expect(c.I2C.args.constructor).toEqual(["id", "freq", "scl", "sda", "timeout"]);
    expect(c.Timer.constants).toEqual(["ONE_SHOT", "PERIODIC"]);
    expect(MICROPYTHON_API.modules.time.names).toEqual(["gmtime", "localtime", "mktime", "time", "time_ns", "sleep", "sleep_ms", "sleep_us", "ticks_ms", "ticks_us", "ticks_cpu", "ticks_add", "ticks_diff"]);
  });

  it("every name in each C table is either on the Pico or named as left out", () => {
    const docs = fileURLToPath(new URL("../../../docs/software/micropython-v1.29.0/", import.meta.url));
    for (const [cls, v] of Object.entries(buildApi().classes as Record<string, { methods: string[]; constants: string[]; notOnThePico: { name: string }[]; from: string[] }>)) {
      const src = readFileSync(docs + v.from[0]!, "utf8");
      const table = src.slice(src.search(/(locals_dict_table|globals_table)\[\] = \{/), src.indexOf("\n};", src.search(/(locals_dict_table|globals_table)\[\] = \{/)));
      const inTable = new Set([...table.matchAll(/\{ MP_ROM_QSTR\(MP_QSTR_(\w+)\)/g)].map((m) => m[1]!));
      const accounted = new Set([...v.methods, ...v.constants, ...v.notOnThePico.map((x) => x.name)]);
      for (const n of inTable) expect(accounted.has(n), `${cls}.${n}`).toBe(true);
    }
  });
});

