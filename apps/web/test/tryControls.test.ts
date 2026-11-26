// M8 8.C3c: the "Try it" panel's controls and outputs, from the circuit only.
import { layoutProject, type BlockRequest } from "@breadpilot/circuit-core";
import { electricalModel, inputSlots, ledFullMa } from "@breadpilot/sim";
import { describe, expect, it } from "vitest";
import { brightness, controlsFor, controlWrites, endText, fromPosition, moduleText, outputsFor, toPosition, valueText } from "../src/steps/tryControls";

const setup = (kinds: BlockRequest[]) => {
  const build = layoutProject(kinds).build;
  const model = electricalModel(build);
  return { build, model, controls: controlsFor(inputSlots(model), build, model) };
};
const brief = (kinds: BlockRequest[]) => setup(kinds).controls.map((c) => `${c.ref} ${c.kind} ${c.label}${c.kind === "slider" ? ` ${c.min}..${c.max} ${c.unit}${c.testRange ? " (test range)" : ""}` : ""}`);

describe("controls from the circuit", () => {
  it("a button is held, a tilt switch and a reed switch are toggled, a knob is a slider in %", () => {
    expect(brief([{ kind: "button" }, { kind: "tilt" }, { kind: "reed" }, { kind: "pot" }])).toEqual(["BTN1 hold Press", "TILT1 toggle Tilted", "REED1 toggle Magnet near", "POT1 slider Knob 0..1 %"]);
  });

  it("a tilt switch starts upright (its contact closed at rest)", () => {
    const tilt = setup([{ kind: "tilt" }]).controls[0]!;
    expect(tilt.value).toBe(1);
    expect(tilt.options).toEqual([
      { label: "Upright", value: 1 },
      { label: "Tilted", value: 0 },
    ]);
  });

  it("a slide switch is one control over its two contacts: setting a side closes it and opens the other", () => {
    const { controls } = setup([{ kind: "slide-switch" }]);
    expect(controls.map((c) => [c.kind, c.slots.length])).toEqual([["side", 2]]);
    const [a, b] = controls[0]!.slots;
    expect(controlWrites(controls[0]!, 1)).toEqual([[a, 0], [b, 1]]);
  });

  it("sensor sliders use the part's own measuring range when the pack records one, else a test range", () => {
    expect(brief([{ kind: "dht11" }])).toEqual(["DHT1 slider Temperature 0..50 °C", "DHT1 slider Humidity 20..90 %"]);
    expect(brief([{ kind: "ds18b20" }])).toEqual(["DS1 slider Temperature -55..125 °C"]);
    expect(brief([{ kind: "bme280" }])).toEqual(["BME1 slider Temperature -20..60 °C (test range)", "BME1 slider Humidity 0..100 % (test range)", "BME1 slider Pressure 300..1100 hPa"]);
    expect(brief([{ kind: "bh1750" }])).toEqual(["LUX1 slider Light 1..65535 lux"]);
    expect(brief([{ kind: "ldr" }, { kind: "ntc" }])).toEqual(["LDR1 slider Light 1..10000 lux (test range)", "NTC1 slider Temperature -20..100 °C (test range)"]);
    expect(brief([{ kind: "imu" }])).toEqual(["IMU1 slider Tilt -1..1 g", "IMU1 slider Turning -250..250 °/s"]);
  });

  it("modules: a digital output is a yes/no toggle named for what it senses, an analog one a slider", () => {
    expect(brief([{ kind: "touch" }, { kind: "soil" }])).toEqual(["TCH1 toggle Touched", "SOIL1 slider Reading 0..1 %"]);
  });

  it("light moves on a log scale, and values read in plain units", () => {
    const light = setup([{ kind: "ldr" }]).controls[0]!;
    expect(fromPosition(light, 0)).toBe(1);
    expect(fromPosition(light, 1000)).toBe(10000);
    expect(fromPosition(light, toPosition(light, 300))).toBeCloseTo(300, -1);
    const knob = setup([{ kind: "pot" }]).controls[0]!;
    expect(valueText(knob, 0.5)).toBe("50 %");
    expect(valueText(setup([{ kind: "dht11" }]).controls[0]!, 22.5)).toBe("22.5 °C");
  });
});

describe("outputs", () => {
  it("LEDs in their colour, modules and displays by name", () => {
    const { build, model } = setup([{ kind: "led", props: { color: "green" } }, { kind: "buzzer" }, { kind: "oled" }]);
    const out = outputsFor(build, model);
    expect(out.leds).toEqual([{ ref: "LED1", colour: "#22c55e", name: "green LED" }]);
    expect(out.modules.map((m) => [m.ref, m.type])).toEqual([["BZ1", "passive-buzzer"]]);
    expect(out.displays.map((d) => d.ref)).toEqual(["OLED1"]);
  });

  it("brightness is the LED's current over its full-on current", () => {
    const { model } = setup([{ kind: "led", pin: "GP16" }]);
    const full = ledFullMa(model).LED1!;
    expect(brightness(full, full)).toBe(1);
    expect(brightness(full / 4, full)).toBeCloseTo(0.25);
    expect(brightness(0, full)).toBe(0);
  });

  it("a passive buzzer sounds only with a tone", () => {
    expect(moduleText("passive-buzzer", { on: 0.5, freq: 440 })).toBe("tone 440 Hz");
    expect(moduleText("passive-buzzer", { on: 1, freq: 0 })).toBe("held on, no tone (silent)");
    expect(moduleText("active-buzzer", { on: 1, freq: 0 })).toBe("beeping");
    expect(moduleText("vibration-motor-module", { on: 0, freq: 0 })).toBe("off");
  });

  it("an error says its line", () => {
    expect(endText({ ended: "error", error: { type: "TypeError", message: "can't convert float to int", line: 69 } })).toBe("Stopped with TypeError: can't convert float to int (line 69). On the Pico it stops there the same way.");
  });
});
