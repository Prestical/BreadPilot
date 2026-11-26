// M18 18.7d: chips that talk. Each pack's real driver (and the firmware's frozen dht/onewire/ds18x20)
// runs unchanged against a chip simulated at the level of its bytes and registers, and reads back what
// the scenario sets.

import { readFileSync } from "node:fs";
import { driversFor, layoutProject, parseConnections, type Build, type BlockRequest } from "@breadpilot/circuit-core";
import { describe, expect, it } from "vitest";
import { runProgram, type Scenario, type SimResult } from "../src/index";

const setup = (kinds: BlockRequest[]) => {
  const circuit = layoutProject(kinds).build;
  const files = Object.fromEntries(driversFor(circuit.parts.map((p) => p.type)).map((d) => [d.file, d.source]));
  const pins = Object.entries(circuit.gpioModes);
  const sda = pins.find(([, m]) => m.endsWith("_sda"))?.[0].slice(2);
  const scl = pins.find(([, m]) => m.endsWith("_scl"))?.[0].slice(2);
  const bus = pins.find(([, m]) => m.endsWith("_sda"))?.[1].slice(3, 4);
  const one = pins[0]?.[0].slice(2);
  return { circuit, files, i2c: `I2C(${bus}, sda=Pin(${sda}), scl=Pin(${scl}))`, one };
};
const run = (kinds: BlockRequest[], code: (s: ReturnType<typeof setup>) => string, scenario: Scenario = {}, virtualSeconds = 10) => {
  const s = setup(kinds);
  return runProgram({ circuit: s.circuit, files: s.files, scenario, virtualSeconds, code: `from machine import Pin, I2C\nimport time\n${code(s)}` });
};
/** A frame's pixels as rows of # and . (MONO_VLSB, 128 x 64). */
const rows = (r: SimResult, ref: string, which = -1, w = 24, h = 8) => {
  const frames = r.events.filter((e) => e.kind === "frame" && e.a === ref);
  const buf = Buffer.from(String(frames.at(which)?.b ?? ""), "base64");
  return Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => ((buf[(y >> 3) * 128 + x]! >> (y & 7)) & 1 ? "#" : ".")).join(""));
};

describe("OLED displays: the real drivers draw into a virtual panel", () => {
  it("SH1106 (1.3\"): scan finds 0x3C, and the frame shows the text where it was drawn", async () => {
    const r = await run([{ kind: "oled" }], (s) => `i2c = ${s.i2c}\nprint(i2c.scan())\nfrom sh1106 import SH1106_I2C\noled = SH1106_I2C(128, 64, i2c)\noled.fill(0)\noled.text("Hi", 0, 0)\noled.show()\n`);
    expect(r.ended).toBe("finished");
    expect(r.prints).toEqual(["[60]"]);
    expect(rows(r, "OLED1").slice(0, 7)).toEqual([".##..##....##...........", ".##..##.................", ".##..##....##...........", ".######....##...........", ".##..##....##...........", ".##..##....##...........", ".##..##....##..........."]);
  });

  it("SSD1306 (0.96\"): the same picture through horizontal addressing", async () => {
    const r = await run([{ kind: "oled-small" }], (s) => `i2c = ${s.i2c}\nfrom ssd1306 import SSD1306_I2C\noled = SSD1306_I2C(128, 64, i2c)\noled.fill(0)\noled.text("Hi", 0, 0)\noled.show()\n`);
    expect(r.ended).toBe("finished");
    const ref = r.events.find((e) => e.kind === "frame")!.a as string;
    expect(rows(r, ref)[3]).toBe(".######....##...........");
  });

  it("the module shows RAM columns 2-129: drawing with col_offset=0 comes out shifted by 2, as on the real module", async () => {
    const r = await run([{ kind: "oled" }], (s) => `i2c = ${s.i2c}\nfrom sh1106 import SH1106_I2C\noled = SH1106_I2C(128, 64, i2c, col_offset=0)\noled.fill(0)\noled.text("Hi", 0, 0)\noled.show()\n`);
    expect(rows(r, "OLED1")[3]).toBe("#####....##.............");
  });

  it("nothing is recorded until show(); a display that is never shown keeps its blank start-up frame", async () => {
    const r = await run([{ kind: "oled" }], (s) => `i2c = ${s.i2c}\nfrom sh1106 import SH1106_I2C\noled = SH1106_I2C(128, 64, i2c)\noled.text("never shown", 0, 0)\ntime.sleep(1)\n`);
    const frames = r.events.filter((e) => e.kind === "frame");
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(rows(r, "OLED1").every((row) => !row.includes("#"))).toBe(true);
  });

  it("the real 'no display found' error when the program opens the wrong pins", async () => {
    const r = await run([{ kind: "oled" }], () => `i2c = I2C(1, sda=Pin(2), scl=Pin(3))\nfrom sh1106 import SH1106_I2C\noled = SH1106_I2C(128, 64, i2c)\n`);
    expect(r.error).toMatchObject({ type: "OSError", at: { file: "sh1106.py" } });
    expect(r.error!.message).toMatch(/No SH1106 display found/);
  });
});

describe("sensors: the real drivers read back what the scenario sets", () => {
  it("BME280: temperature, pressure and humidity through the driver's own calibration formulas", async () => {
    const r = await run([{ kind: "bme280" }], (s) => `i2c = ${s.i2c}\nfrom bme280 import BME280\nb = BME280(i2c)\nt, p, h = b.read()\nprint(round(t, 1), round(p, 1), round(h))\n`, {
      sensors: { "BME1.temperature": [[0, 23.4]], "BME1.pressure": [[0, 998.2]], "BME1.humidity": [[0, 61]] },
    });
    expect(r.prints).toEqual(["23.4 998.2 61"]);
  });

  it("MPU-6050: lying still reads about 1 g down; tilted and turning as set", async () => {
    const r = await run([{ kind: "imu" }], (s) => `i2c = ${s.i2c}\nfrom mpu6050 import MPU6050\nm = MPU6050(i2c)\nprint([round(v, 2) for v in m.acceleration()], [round(v) for v in m.rotation()])\ntime.sleep(1)\nprint([round(v, 2) for v in m.acceleration()], [round(v) for v in m.rotation()])\n`, {
      sensors: { "IMU1.ax": [[500_000, 0.5]], "IMU1.az": [[500_000, 0.87]], "IMU1.gz": [[500_000, 90]] },
    });
    expect(r.prints).toEqual(["[0.0, 0.0, 1.0] [0, 0, 0]", "[0.5, 0.0, 0.87] [0, 0, 90]"]);
  });

  it("MPU-6050 that the code never wakes reads zeros (it starts asleep)", async () => {
    const r = await run([{ kind: "imu" }], (s) => `i2c = ${s.i2c}\nprint(list(i2c.readfrom_mem(0x68, 0x3B, 6)))\n`);
    expect(r.prints).toEqual(["[0, 0, 0, 0, 0, 0]"]);
  });

  it("DS3231: the set time keeps running on the virtual clock", async () => {
    const r = await run([{ kind: "rtc" }], (s) => `i2c = ${s.i2c}\nfrom ds3231 import DS3231\nc = DS3231(i2c)\nc.set_time(2026, 11, 25, 23, 59, 50)\ntime.sleep(15)\nprint(c.time())\nprint(c.temperature())\n`, {}, 30);
    expect(r.prints).toEqual(["(2026, 11, 26, 0, 0, 5)", "25.0"]);
  });

  it("BH1750: lux after its first measurement; 0 before it is ready", async () => {
    const r = await run([{ kind: "bh1750" }], (s) => `i2c = ${s.i2c}\ni2c.writeto(0x23, b"\\x10")\nd = i2c.readfrom(0x23, 2)\nprint((d[0] << 8 | d[1]) / 1.2)\ntime.sleep(0.2)\nd = i2c.readfrom(0x23, 2)\nprint((d[0] << 8 | d[1]) / 1.2)\n`, {
      sensors: { LUX1: [[0, 450]] },
    });
    expect(r.prints).toEqual(["0.0", "450.0"]);
  });
});

describe("one-wire: the firmware's frozen modules on a fake _onewire", () => {
  it("DHT11 (real dht.py): no answer in the first second, then temperature and humidity", async () => {
    const r = await run([{ kind: "dht11" }], (s) => `import dht\nd = dht.DHT11(Pin(${s.one}))\ntry:\n    d.measure()\nexcept OSError:\n    print("not ready")\ntime.sleep(2)\nd.measure()\nprint(d.temperature(), d.humidity())\n`, {
      sensors: { "DHT1.temperature": [[0, 24]], "DHT1.humidity": [[0, 55]] },
    });
    expect(r.prints).toEqual(["not ready", "24 55"]);
  });

  // Formatted: the WebAssembly build's floats are double precision, the Pico's single (PLAN 18.7
  // limits), so a bare 81.4 can print as 81.40000000000001 here and as 81.4 on the board.
  it("DHT22 (real dht.py): tenths and below zero", async () => {
    const r = await run([{ kind: "dht22" }], (s) => `import dht\nd = dht.DHT22(Pin(${s.one}))\ntime.sleep(2)\nd.measure()\nprint("%.1f %.1f" % (d.temperature(), d.humidity()))\n`, {
      sensors: { "DHT1.temperature": [[0, -3.7]], "DHT1.humidity": [[0, 81.4]] },
    });
    expect(r.prints).toEqual(["-3.7 81.4"]);
  });

  it("a DHT11 without its pull-up resistor never answers, as on the board", async () => {
    const s = setup([{ kind: "dht11" }]);
    const noPullUp: Build = { ...s.circuit, parts: s.circuit.parts.filter((p) => p.type !== "resistor") };
    const r = await runProgram({ circuit: noPullUp, files: s.files, code: `from machine import Pin\nimport time, dht\nd = dht.DHT11(Pin(${s.one}))\ntime.sleep(2)\nd.measure()\n` });
    expect(r.error).toMatchObject({ type: "OSError", at: { file: "dht.py" } });
  });

  it("DS18B20 (real onewire.py + ds18x20.py): scan finds it; 85 °C before a conversion, the temperature after 750 ms", async () => {
    const r = await run([{ kind: "ds18b20" }], (s) => `import onewire, ds18x20\nds = ds18x20.DS18X20(onewire.OneWire(Pin(${s.one})))\nroms = ds.scan()\nprint(len(roms), hex(roms[0][0]))\nprint(ds.read_temp(roms[0]))\nds.convert_temp()\ntime.sleep_ms(750)\nprint(ds.read_temp(roms[0]))\n`, {
      sensors: { "DS1.temperature": [[0, 21.5]] },
    });
    expect(r.prints).toEqual(["1 0x28", "85.0", "21.5"]);
  });

  it("the frozen onewire.py and ds18x20.py are the firmware's, byte for byte", () => {
    for (const [ours, docs] of [["onewire.py", "micropython-lib__micropython__drivers__bus__onewire__onewire.py"], ["ds18x20.py", "micropython-lib__micropython__drivers__sensor__ds18x20__ds18x20.py"]]) {
      const a = readFileSync(new URL(`../src/py/frozen/${ours}`, import.meta.url), "utf8");
      const b = readFileSync(new URL(`../../../docs/software/micropython-v1.29.0/${docs}`, import.meta.url), "utf8");
      expect(a, ours).toBe(b);
    }
  });
});

describe("a chip needs power and the right wires", () => {
  it("an OLED whose VCC wire is missing isn't found", async () => {
    const s = setup([{ kind: "oled" }]);
    const vccRow = Number(/^\d+/.exec(s.circuit.parts.find((p) => p.type === "oled-sh1106-i2c")!.legs.vcc!)![0]);
    const noPower: Build = { ...s.circuit, wires: s.circuit.wires.filter((w) => !(w.to.kind === "hole" && w.to.row === vccRow) && !(w.from.kind === "hole" && w.from.row === vccRow)) };
    const r = await runProgram({ circuit: noPower, files: s.files, code: `from machine import Pin, I2C\ni2c = ${s.i2c}\nprint(i2c.scan())\n` });
    expect(r.prints).toEqual(["[]"]);
  });

  it("a hand-wired OLED on other pins is found on those pins", async () => {
    const s = setup([{ kind: "oled" }]);
    const part = s.circuit.parts.find((p) => p.type === "oled-sh1106-i2c")!;
    const b: Build = {
      boardId: "pico-2-w",
      parts: [part],
      wires: parseConnections(`#36(3V3) -> #${/^\d+/.exec(part.legs.vcc!)![0]}j\n#38(GND) -> #${/^\d+/.exec(part.legs.gnd!)![0]}j\n#6(GP4) -> #${/^\d+/.exec(part.legs.sda!)![0]}j\n#7(GP5) -> #${/^\d+/.exec(part.legs.scl!)![0]}j`).wires,
      gpioModes: { GP4: "i2c0_sda", GP5: "i2c0_scl" },
    };
    const r = await runProgram({ circuit: b, files: s.files, code: "from machine import Pin, I2C\ni2c = I2C(0, sda=Pin(4), scl=Pin(5))\nprint(i2c.scan())\n" });
    expect(r.prints).toEqual(["[60]"]);
  });
});
