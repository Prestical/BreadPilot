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
    expect(`Parts: ${GREETING_PARTS}, and the Pico's own LED, Wi-Fi and temperature sensor.`).toBe('Parts: LEDs, buttons, knobs, the 1.3" OLED, and the Pico\'s own LED, Wi-Fi and temperature sensor.');
  });
});
