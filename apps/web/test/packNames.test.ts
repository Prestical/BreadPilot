// Names in the UI come from part packs (text.json names); these must read as before part packs.
import { describe, expect, it } from "vitest";
import { GREETING_PARTS, planPartName } from "../src/ui/StageOverlay";

describe("UI names from part packs", () => {
  it("plan card labels and colour dots", () => {
    expect(planPartName({ kind: "led", purpose: "x", color: "green" })).toEqual({ name: "green LED", dot: "led-green" });
    expect(planPartName({ kind: "led", purpose: "x" })).toEqual({ name: "red LED", dot: "led-red" });
    expect(planPartName({ kind: "button", purpose: "x" })).toEqual({ name: "Push button" });
    expect(planPartName({ kind: "pot", purpose: "x" })).toEqual({ name: "Knob (potentiometer)" });
    expect(planPartName({ kind: "oled", purpose: "x" })).toEqual({ name: '1.3" OLED display (I2C)' });
  });

  it("the start screen's parts line", () => {
    expect(`Parts: ${GREETING_PARTS}, and the Pico's own LED, Wi-Fi and temperature sensor.`).toBe('Parts: LEDs, buttons, slide switches, a tilt switch, a reed switch, a touch sensor, a Hall sensor, knobs, a light sensor, a BH1750 light sensor, a thermistor, a water level sensor, a soil moisture sensor, the 1.3" OLED, the 0.96" OLED, a temperature and humidity sensor, a DHT22 sensor, a DS18B20 sensor, an obstacle sensor, a pressure sensor, a flame sensor, a sound sensor, a vibration sensor, a line sensor, a buzzer, an active buzzer, a vibration motor, a real-time clock, an accelerometer, and the Pico\'s own LED, Wi-Fi and temperature sensor.');
  });
});
