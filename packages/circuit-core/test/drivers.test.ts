import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { driversFor } from "../src/drivers";

describe("MicroPython drivers", () => {
  it("the OLED needs sh1106.py; other parts need nothing", () => {
    expect(driversFor(["oled-sh1106-i2c", "led-5mm", "oled-sh1106-i2c"]).map((d) => [d.file, d.module])).toEqual([["sh1106.py", "sh1106"]]);
    expect(driversFor(["led-5mm", "button-6mm"])).toEqual([]);
    expect(driversFor(["oled-sh1106-i2c"])[0]!.source).toMatch(/^# sh1106\.py/);
  });

  // Byte-level check against the SH1106 datasheet, run under CPython with fake framebuf/I2C.
  const python = spawnSync("python3", ["--version"]).status === 0;
  it.skipIf(!python)("sh1106.py sends exactly the datasheet's bytes (CPython, fake I2C)", () => {
    const r = spawnSync("python3", ["-I", new URL("./sh1106_driver_check.py", import.meta.url).pathname], { encoding: "utf8" });
    expect(r.stderr).toBe("");
    expect(r.stdout.trim()).toBe("ok");
  });
});
