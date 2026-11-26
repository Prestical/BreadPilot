// M18 18.7b: the simulator's core. Each test pins one promise of the plan (PLAN §13.13, 18.7):
// a virtual clock, runaway programs stopped, crashes with their line, exactly the Pico's names,
// inputs over time, pin interrupts and timers.

import { MICROPYTHON_API } from "@breadpilot/circuit-core";
import { describe, expect, it } from "vitest";
import { runProgram, type SimResult } from "../src/index";

const H = "from machine import Pin, PWM, ADC, Timer\nimport time\n";
const kinds = (r: SimResult, kind: string) => r.events.filter((e) => e.kind === kind);

describe("virtual clock", () => {
  it("sleep takes no real time: 5 virtual minutes in well under a second", async () => {
    const r = await runProgram({ code: `${H}t0 = time.ticks_ms()\ntime.sleep(300)\nprint(time.ticks_diff(time.ticks_ms(), t0))\n`, virtualSeconds: 400 });
    expect(r.ended).toBe("finished");
    expect(Number(r.prints[0])).toBeGreaterThanOrEqual(300000);
    expect(Number(r.prints[0])).toBeLessThan(300010);
    expect(r.wallMs).toBeLessThan(3000);
  });

  it("sleep_ms, sleep_us, ticks wrap-around math, and time() starting on 2021-01-01", async () => {
    const r = await runProgram({ code: `${H}time.sleep_ms(250)\ntime.sleep_us(500)\nprint(time.ticks_us() // 1000)\nprint(time.ticks_diff(5, (1 << 30) - 5))\nprint(time.ticks_add((1 << 30) - 1, 2))\nprint(time.localtime()[0])\n` });
    expect(r.prints).toEqual(["250", "10", "1", "2021"]);
  });

  it("a loop that waits by polling ticks_ms() still moves forward", async () => {
    const r = await runProgram({ code: `${H}t0 = time.ticks_ms()\nwhile time.ticks_diff(time.ticks_ms(), t0) < 200:\n    pass\nprint("waited")\n` });
    expect(r.ended).toBe("finished");
    expect(r.prints).toEqual(["waited"]);
  });

  it("a program that keeps running ends at the virtual time limit, even inside except Exception", async () => {
    const r = await runProgram({ code: `${H}led = Pin(16, Pin.OUT)\nwhile True:\n    try:\n        led.toggle()\n        time.sleep(1)\n    except Exception:\n        pass\n`, virtualSeconds: 10 });
    expect(r.ended).toBe("time limit");
    expect(kinds(r, "out").length).toBeGreaterThanOrEqual(10);
  });

  it("a loop that never gives time back is stopped by the wall-clock limit, and its trace so far is kept", async () => {
    const r = await runProgram({ code: `${H}led = Pin(16, Pin.OUT)\nled.on()\nn = 0\nwhile True:\n    n += 1\n`, wallMs: 1500 });
    expect(r.ended).toBe("wall limit");
    expect(kinds(r, "out").map((e) => e.b)).toEqual([0, 1]);
  });

  it("reset() and deepsleep() end the run", async () => {
    expect((await runProgram({ code: `${H}import machine\nmachine.reset()\n` })).ended).toBe("reset");
    expect((await runProgram({ code: `${H}import machine\nmachine.deepsleep(1000)\n` })).ended).toBe("deep sleep");
  });
});

describe("crashes, with their line", () => {
  it("PWM.duty() and ADC.read() don't exist on the Pico", async () => {
    const r = await runProgram({ code: `${H}led = PWM(Pin(16))\nk = ADC(26)\nwhile True:\n    led.duty(k.read() // 64)\n    time.sleep(0.1)\n` });
    expect(r.ended).toBe("error");
    expect(r.error).toMatchObject({ type: "AttributeError", line: 6 });
    expect(r.error!.message).toMatch(/read|duty/);
  });

  it("machine.temperature() (a name machine doesn't have) and an undefined name", async () => {
    expect((await runProgram({ code: `${H}import machine\nprint(machine.temperature())\n` })).error).toMatchObject({ type: "AttributeError", line: 4 });
    expect((await runProgram({ code: `${H}x = 1\ny = speed + x\n` })).error).toMatchObject({ type: "NameError", line: 4 });
  });

  it("an error inside a driver names the driver's file and line, and the main.py line that called it", async () => {
    const r = await runProgram({ code: `${H}import drv\ndrv.go()\n`, files: { "drv.py": "def go():\n    return 1 / 0\n" } });
    expect(r.error).toMatchObject({ type: "ZeroDivisionError", line: 4, at: { file: "drv.py", line: 2 } });
  });

  it("an I2C transfer to an address where nothing answers is OSError 5, as on the Pico", async () => {
    const r = await runProgram({ code: `${H}from machine import I2C\ni2c = I2C(0, sda=Pin(16), scl=Pin(17))\nprint(i2c.scan())\ni2c.writeto(0x3C, b"\\x00")\n` });
    expect(r.prints).toEqual(["[]"]);
    expect(r.error).toMatchObject({ type: "OSError", line: 6 });
  });
});

describe("exactly the Pico's names (MICROPYTHON_API, from MicroPython v1.29.0's rp2 source)", () => {
  it("machine and time have the same public names as the firmware", async () => {
    const r = await runProgram({ code: `import machine, time\nprint(" ".join(sorted(n for n in dir(machine) if not n.startswith("_"))))\nprint(" ".join(sorted(n for n in dir(time) if not n.startswith("_"))))\n` });
    expect(r.prints[0]!.split(" ")).toEqual([...MICROPYTHON_API.modules.machine.names].sort());
    expect(r.prints[1]!.split(" ")).toEqual([...MICROPYTHON_API.modules.time.names].sort());
  });

  it("Pin, PWM, ADC, I2C and Timer have exactly the firmware's methods and constants", async () => {
    const classes = ["Pin", "PWM", "ADC", "I2C", "Timer"] as const;
    const r = await runProgram({ code: `import machine\nfor c in ${JSON.stringify(classes)}:\n    print(" ".join(sorted(n for n in dir(getattr(machine, c)) if not n.startswith("_"))))\n` });
    classes.forEach((c, i) => {
      const api = MICROPYTHON_API.classes[c];
      expect(r.prints[i]!.split(" "), c).toEqual([...api.methods, ...api.constants].filter((n) => !n.startsWith("_")).sort());
    });
  });
});

describe("inputs over time, interrupts and timers", () => {
  it("a button scheduled to be pressed (GP17 to 0) is read as 0 from then on; unscheduled inputs read their pull", async () => {
    const r = await runProgram({
      code: `${H}b = Pin(17, Pin.IN, Pin.PULL_UP)\nd = Pin(18, Pin.IN, Pin.PULL_DOWN)\nfor i in range(4):\n    print(b.value(), d.value())\n    time.sleep(0.5)\n`,
      inputs: { pins: { 17: [[1_000_000, 0]] } },
    });
    expect(r.prints).toEqual(["1 0", "1 0", "0 0", "0 0"]);
  });

  it("Pin.irq runs its handler at the virtual moment the input changes, during a sleep", async () => {
    const r = await runProgram({
      code: `${H}b = Pin(17, Pin.IN, Pin.PULL_UP)\ndef pressed(p):\n    print("pressed at", time.ticks_ms())\nb.irq(pressed, Pin.IRQ_FALLING)\ntime.sleep(3)\n`,
      inputs: { pins: { 17: [[1_200_000, 0], [1_800_000, 1]] } },
    });
    expect(r.prints).toEqual(["pressed at 1200"]);
  });

  it("a periodic Timer runs its callback on the virtual clock", async () => {
    const r = await runProgram({ code: `${H}n = 0\ndef tick(t):\n    global n\n    n += 1\nt = Timer(period=100, mode=Timer.PERIODIC, callback=tick)\ntime.sleep(1)\nt.deinit()\ntime.sleep(1)\nprint(n)\n` });
    expect(r.prints).toEqual(["10"]);
  });

  it("ADC: volts become read_u16 values like the Pico's 12-bit converter; CORE_TEMP reads the chip's sensor", async () => {
    const r = await runProgram({
      code: `${H}k = ADC(26)\nprint(k.read_u16())\ntime.sleep(1)\nprint(k.read_u16())\nt = ADC(ADC.CORE_TEMP).read_u16() * 3.3 / 65535\nprint(round(27 - (t - 0.706) / 0.001721))\n`,
      inputs: { adc: { 0: [[0, 0], [500_000, 1.65]] } },
    });
    expect(Number(r.prints[0])).toBe(0);
    expect(Math.abs(Number(r.prints[1]) - 32768)).toBeLessThan(64);
    expect(Math.abs(Number(r.prints[2]) - 25)).toBeLessThanOrEqual(1);
  });

  it("outputs and PWM are recorded with their virtual time", async () => {
    const r = await runProgram({ code: `${H}led = PWM(Pin(16), freq=1000)\nfor d in (0, 32768, 65535):\n    led.duty_u16(d)\n    time.sleep(0.25)\n` });
    expect(kinds(r, "pwm").map((e) => [Math.round(e.t / 1000), e.a, e.b, e.c])).toEqual([
      [0, 16, 1000, 0], // duty_u16(0) right after PWM(..., freq=1000) at duty 0: no change, no second event
      [250, 16, 1000, 32768],
      [500, 16, 1000, 65535],
    ]);
  });
});

describe("modules frozen into the Pico 2 W firmware", () => {
  it("the real dht.py is the firmware's (micropython-lib at the commit v1.29.0 pins), byte for byte", async () => {
    const { readFileSync } = await import("node:fs");
    const ours = readFileSync(new URL("../src/py/frozen/dht.py", import.meta.url), "utf8");
    const docs = readFileSync(new URL("../../../docs/software/micropython-v1.29.0/micropython-lib__micropython__drivers__sensor__dht__dht.py", import.meta.url), "utf8");
    expect(ours).toBe(docs);
  });

  it("a DHT11 that doesn't answer fails as on the Pico (the real dht.py through machine.dht_readinto)", async () => {
    const r = await runProgram({ code: `${H}import dht\ns = dht.DHT11(Pin(16))\ntime.sleep(1)\ns.measure()\n` });
    expect(r.error).toMatchObject({ type: "OSError", line: 6, at: { file: "dht.py" } });
  });

  it("Wi-Fi isn't simulated: the program waits for a connection that never comes, and the trace says so", async () => {
    const r = await runProgram({ code: `${H}import network\nw = network.WLAN(network.STA_IF)\nw.active(True)\nw.connect("home", "secret")\nwhile not w.isconnected():\n    time.sleep(1)\nprint("online")\n`, virtualSeconds: 20 });
    expect(r.ended).toBe("time limit");
    expect(r.prints).toEqual([]);
    expect(r.events.filter((e) => e.kind === "unsimulated").map((e) => e.a)).toEqual(["network (Wi-Fi)"]);
  });

  it("ntptime and requests fail like a Pico with no network; urequests forwards to requests", async () => {
    const r = await runProgram({ code: `${H}import ntptime, urequests\ntry:\n    ntptime.settime()\nexcept OSError:\n    print("no time server")\ntry:\n    urequests.get("http://example.com")\nexcept OSError:\n    print("no web")\n` });
    expect(r.prints).toEqual(["no time server", "no web"]);
  });

  it("umqtt isn't in the firmware (bundle-networking has mip, ntptime, ssl, requests, webrepl, urequests), so importing it fails", async () => {
    const r = await runProgram({ code: `${H}from umqtt.simple import MQTTClient\n` });
    expect(r.error).toMatchObject({ type: "ImportError", line: 3 });
  });
});
