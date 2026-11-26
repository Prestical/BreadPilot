// M18 18.7c: the circuit link. What a pin reads, what the ADC measures and what LEDs and modules do
// come from circuit-core's netlist of the build: tested on the layout engine's blocks for every simple
// part, and on circuits wired by hand differently (the sandbox, M6, reuses this).

import { layoutProject, parseConnections, type Build, type GpioMode, type Part } from "@breadpilot/circuit-core";
import { describe, expect, it } from "vitest";
import { electricalModel } from "../src/circuit";
import { runProgram } from "../src/index";
import { devices, readAdc, readPin, solveCircuit, type PinState } from "../src/solver.mjs";

type State = { switches?: Record<string, number>; pots?: Record<string, number>; sensors?: Record<string, number> };
const look = (build: Build, state: State, pins: Record<number, PinState>) => {
  const m = electricalModel(build);
  const s = solveCircuit(m, { switches: state.switches ?? {}, pots: state.pots ?? {}, sensors: state.sensors ?? {} }, pins);
  return { m, s, pin: (g: number, pull = pins[g]?.pull ?? 0) => readPin(m, s, g, pull), adc: (ch: number) => readAdc(m, s, ch).volts, dev: () => devices(m, s, pins) };
};
const engine = (kinds: string[]) => layoutProject(kinds.map((kind) => ({ kind }))).build;
const mk = (parts: Part[], dsl: string, gpioModes: Record<string, GpioMode> = {}): Build => ({ boardId: "pico-2-w", parts, wires: parseConnections(dsl).wires, gpioModes });
const button = (ref: string, row: number): Part => ({ ref, type: "button-6mm", legs: { "1a": `${row}e`, "1b": `${row}f`, "2a": `${row + 2}e`, "2b": `${row + 2}f` } });

describe("engine blocks: inputs read what the wiring gives", () => {
  it("button to GND with the internal pull-up: 1 released, 0 pressed", () => {
    const b = engine(["button"]);
    const pins = { 16: { mode: "in" as const, pull: 1 } };
    expect(look(b, {}, pins).pin(16).level).toBe(1);
    expect(look(b, { switches: { BTN1: 1 } }, pins).pin(16).level).toBe(0);
  });

  it("slide switch: the side toward the GND leg reads 0, the other side reads the pull-up", () => {
    const b = engine(["slide-switch"]);
    const pins = { 16: { mode: "in" as const, pull: 1 } };
    const m = electricalModel(b);
    const reads = m.switches.map((s) => look(b, { switches: { [s.id]: 1 } }, pins).pin(16).level).sort();
    expect(m.switches).toHaveLength(2);
    expect(reads).toEqual([0, 1]);
  });

  it("tilt and reed switches close like a button", () => {
    for (const [kind, ref] of [["tilt", "TILT1"], ["reed", "REED1"]] as const) {
      const b = engine([kind]);
      const pins = { 16: { mode: "in" as const, pull: 1 } };
      expect([look(b, {}, pins).pin(16).level, look(b, { switches: { [ref]: 1 } }, pins).pin(16).level], kind).toEqual([1, 0]);
    }
  });

  it("knob: the ADC reads position × 3.3 V", () => {
    const b = engine(["pot"]);
    const pins = { 26: { mode: "in" as const, pull: 0 } };
    expect(look(b, { pots: { POT1: 0 } }, pins).adc(0)).toBeCloseTo(0, 3);
    expect(look(b, { pots: { POT1: 0.5 } }, pins).adc(0)).toBeCloseTo(1.65, 3);
    expect(look(b, { pots: { POT1: 1 } }, pins).adc(0)).toBeCloseTo(3.3, 3);
  });

  it("LDR and NTC dividers: the voltage moves with light and temperature, and the direction follows the wiring", () => {
    const pins = { 26: { mode: "in" as const, pull: 0 } };
    const ldr = engine(["ldr"]);
    const dark = look(ldr, { sensors: { LDR1: 1 } }, pins).adc(0);
    const bright = look(ldr, { sensors: { LDR1: 1000 } }, pins).adc(0);
    expect(Math.abs(dark - bright)).toBeGreaterThan(1);
    const ntc = engine(["ntc"]);
    const cold = look(ntc, { sensors: { NTC1: 0 } }, pins).adc(0);
    const warm = look(ntc, { sensors: { NTC1: 40 } }, pins).adc(0);
    expect(Math.abs(cold - warm)).toBeGreaterThan(0.5);
    expect(look(ntc, { sensors: { NTC1: 25 } }, pins).adc(0)).toBeCloseTo(1.65, 2); // 10 kΩ NTC = 10 kΩ resistor at 25 °C
  });

  it("module outputs follow their active level: IR obstacle (low when something is near), touch (high when touched)", () => {
    const pins = { 16: { mode: "in" as const, pull: 0 } };
    expect([look(engine(["obstacle"]), { sensors: { IR1: 0 } }, pins).pin(16).level, look(engine(["obstacle"]), { sensors: { IR1: 1 } }, pins).pin(16).level]).toEqual([1, 0]);
    expect([look(engine(["touch"]), { sensors: { TCH1: 0 } }, pins).pin(16).level, look(engine(["touch"]), { sensors: { TCH1: 1 } }, pins).pin(16).level]).toEqual([0, 1]);
  });

  it("line sensor: triggered means over a black line, which reads 1 (0 over a light surface)", () => {
    const pins = { 16: { mode: "in" as const, pull: 0 } };
    expect([look(engine(["line"]), { sensors: { LN1: 0 } }, pins).pin(16).level, look(engine(["line"]), { sensors: { LN1: 1 } }, pins).pin(16).level]).toEqual([0, 1]);
  });

  it("water level sensor: its analog output is the sensed fraction of its supply", () => {
    expect(look(engine(["water-level"]), { sensors: { WL1: 0.4 } }, { 26: { mode: "in", pull: 0 } }).adc(0)).toBeCloseTo(1.32, 2);
  });

  it("a DHT11's data line (a protocol, simulated in 18.7d) idles HIGH through its pull-up resistor", () => {
    expect(look(engine(["dht11"]), {}, { 16: { mode: "in", pull: 0 } }).pin(16).level).toBe(1);
  });
});

describe("engine blocks: outputs a person would see or hear", () => {
  it("LED: 3.94 mA when its pin is HIGH, 0 when LOW, scaled by PWM duty; blue gets its 100 Ω", () => {
    const b = layoutProject([{ kind: "led" }, { kind: "led", props: { color: "blue" } }]).build;
    const [p1, p2] = Object.keys(b.gpioModes).map((g) => Number(g.slice(2)));
    expect(look(b, {}, { [p1!]: { mode: "out", level: 1 }, [p2!]: { mode: "out", level: 0 } }).dev().leds).toEqual({ LED1: 3.94, LED2: 0 });
    expect(look(b, {}, { [p1!]: { mode: "pwm", duty: 16384, freq: 1000 }, [p2!]: { mode: "out", level: 1 } }).dev().leds).toEqual({ LED1: 0.98, LED2: 3 });
  });

  it("buzzer modules sound while their I/O is LOW (active-low); a passive one plays the PWM frequency", () => {
    expect(look(engine(["active-buzzer"]), {}, { 16: { mode: "out", level: 0 } }).dev().actuators).toEqual({ BZ1: { on: 1, freq: 0 } });
    expect(look(engine(["active-buzzer"]), {}, { 16: { mode: "out", level: 1 } }).dev().actuators).toEqual({ BZ1: { on: 0, freq: 0 } });
    expect(look(engine(["buzzer"]), {}, { 16: { mode: "pwm", duty: 32768, freq: 440 } }).dev().actuators.BZ1).toEqual({ on: 0.5, freq: 440 });
  });

  it("vibration motor module runs while its input is HIGH", () => {
    expect(look(engine(["vibration-motor"]), {}, { 16: { mode: "out", level: 1 } }).dev().actuators).toEqual({ VM1: { on: 1, freq: 0 } });
  });
});

describe("hand-wired circuits (the sandbox's case): the same link reads other wirings", () => {
  it("button to 3V3 with the internal pull-down: 0 released, 1 pressed", () => {
    const b = mk([button("B1", 30)], "#21(GP16) -> #30j(B1.1b)\n#32j(B1.2b) -> #36(3V3)", { GP16: "in_pulldown" });
    const pins = { 16: { mode: "in" as const, pull: 2 } };
    expect([look(b, {}, pins).pin(16).level, look(b, { switches: { B1: 1 } }, pins).pin(16).level]).toEqual([0, 1]);
  });

  it("button to 3V3 with an external 10 kΩ pull-down and no internal pull", () => {
    const b = mk(
      [button("B1", 30), { ref: "R1", type: "resistor", legs: { a: "40h", b: "43h" }, props: { ohms: 10000 } }],
      "#21(GP16) -> #30j(B1.1b)\n#32j(B1.2b) -> #36(3V3)\n#30i -> #40j(R1.a)\n#43j(R1.b) -> #38(GND)",
      { GP16: "in" },
    );
    const pins = { 16: { mode: "in" as const, pull: 0 } };
    expect([look(b, {}, pins).pin(16), look(b, { switches: { B1: 1 } }, pins).pin(16)].map((r) => [r.level, r.floating])).toEqual([[0, false], [1, false]]);
  });

  it("LED that sinks current (3V3 → resistor → LED → GPIO): lit while the pin is LOW", () => {
    const b = mk(
      [{ ref: "R1", type: "resistor", legs: { a: "30h", b: "33h" }, props: { ohms: 330 } }, { ref: "L1", type: "led-5mm", legs: { anode: "33g", cathode: "34g" } }],
      "#36(3V3) -> #30j(R1.a)\n#34j(L1.cathode) -> #21(GP16)",
      { GP16: "out" },
    );
    expect(look(b, {}, { 16: { mode: "out", level: 0 } }).dev().leds).toEqual({ L1: 3.94 });
    expect(look(b, {}, { 16: { mode: "out", level: 1 } }).dev().leds).toEqual({ L1: 0 });
  });

  it("a knob with its ends swapped reads the other way round", () => {
    const b = mk([{ ref: "P1", type: "potentiometer", legs: { end1: "30h", wiper: "31h", end2: "32h" } }], "#38(GND) -> #30j(P1.end1)\n#31(GP26) -> #31j(P1.wiper)\n#32j(P1.end2) -> #36(3V3)", { GP26: "adc" });
    const pins = { 26: { mode: "in" as const, pull: 0 } };
    expect(look(b, { pots: { P1: 0.25 } }, pins).adc(0)).toBeCloseTo(3.3 * 0.75, 3);
  });

  it("an input wired to nothing and without a pull is floating (said, read as 0)", () => {
    const b = mk([button("B1", 30)], "#21(GP16) -> #30j(B1.1b)", { GP16: "in" });
    expect(look(b, {}, { 16: { mode: "in", pull: 0 } }).pin(16)).toMatchObject({ level: 0, floating: true });
  });
});

describe("in a run: the program reads the circuit and its LEDs are recorded", () => {
  it("button on GP17 lights the LED on GP16 while the scenario holds it pressed", async () => {
    const circuit = layoutProject([{ kind: "led", pin: "GP16" }, { kind: "button", pin: "GP17" }]).build;
    const r = await runProgram({
      circuit,
      scenario: { switches: { BTN1: [[1_000_000, 1], [2_000_000, 0]] } },
      code: "from machine import Pin\nimport time\nled = Pin(16, Pin.OUT)\nb = Pin(17, Pin.IN, Pin.PULL_UP)\nwhile True:\n    led.value(1 if b.value() == 0 else 0)\n    time.sleep(0.05)\n",
      virtualSeconds: 3,
    });
    expect(r.ended).toBe("time limit");
    const led = r.events.filter((e) => e.kind === "led").map((e) => [Math.round(e.t / 50_000) * 50, e.b]);
    expect(led).toEqual([[0, 0], [1000, 3.94], [2000, 0]]);
  });

  it("an LED in series with a button lights only while it is pressed, with the program doing nothing", async () => {
    const b = mk(
      [button("B1", 40), { ref: "R1", type: "resistor", legs: { a: "30h", b: "33h" }, props: { ohms: 330 } }, { ref: "L1", type: "led-5mm", legs: { anode: "33g", cathode: "34g" } }],
      "#21(GP16) -> #40j(B1.1b)\n#42j(B1.2b) -> #30j(R1.a)\n#34j(L1.cathode) -> #38(GND)",
      { GP16: "out" },
    );
    const r = await runProgram({ circuit: b, scenario: { switches: { B1: [[500_000, 1], [700_000, 0]] } }, code: "from machine import Pin\nimport time\nPin(16, Pin.OUT).on()\ntime.sleep(1)\n" });
    expect(r.events.filter((e) => e.kind === "led").map((e) => [Math.round(e.t / 1000), e.b])).toEqual([[0, 0], [500, 3.94], [700, 0]]);
  });

  it("a knob swept by the scenario is read through the ADC", async () => {
    const circuit = layoutProject([{ kind: "pot", pin: "GP26" }]).build;
    const r = await runProgram({ circuit, scenario: { pots: { POT1: [[0, 0], [1_000_000, 0.5], [2_000_000, 1]] } }, code: "from machine import ADC\nimport time\nk = ADC(26)\nfor i in range(3):\n    print(k.read_u16())\n    time.sleep(1)\n" });
    expect(r.prints.map(Number)).toEqual([0, expect.any(Number), 65535]);
    expect(Math.abs(Number(r.prints[1]) - 32768)).toBeLessThan(40);
  });

  it("a floating input is recorded once in the trace", async () => {
    const b = mk([button("B1", 30)], "#21(GP16) -> #30j(B1.1b)", { GP16: "in" });
    const r = await runProgram({ circuit: b, code: "from machine import Pin\nimport time\np = Pin(16, Pin.IN)\nfor i in range(3):\n    p.value()\n    time.sleep(0.1)\n" });
    expect(r.events.filter((e) => e.kind === "floating").map((e) => e.a)).toEqual([16]);
  });
});
