// "What you need" list, counted from real layouts.
import { describe, expect, it } from "vitest";
import { layoutProject } from "@breadpilot/circuit-core";
import { partsNeeded } from "../src/projects/parts";

describe("parts needed", () => {
  it("groups LEDs by color and resistors by value, and counts wires by color", () => {
    const { build } = layoutProject([{ kind: "led", props: { color: "red" } }, { kind: "led", props: { color: "red" } }, { kind: "led", props: { color: "green" } }, { kind: "button" }]);
    const items = partsNeeded(build);
    expect(items[0]!.name).toBe("Raspberry Pi Pico 2 W (with headers)");
    expect(items).toContainEqual({ count: 2, name: "red LEDs" });
    expect(items).toContainEqual({ count: 1, name: "green LED" });
    expect(items).toContainEqual({ count: 3, name: "330 Ω resistors" });
    expect(items).toContainEqual({ count: 1, name: "push button" });
    const wires = items.find((i) => i.name.startsWith("jumper wire"))!;
    expect(wires.count).toBe(build.wires.length);
    expect(wires.detail!.split(", ").reduce((n, s) => n + Number(s.split(" ")[0]), 0)).toBe(build.wires.length);
    expect(items.at(-1)!.name).toBe("USB data cable for the Pico");
  });

  it("names the OLED display", () => {
    const items = partsNeeded(layoutProject([{ kind: "oled" }, { kind: "button" }, { kind: "button" }]).build);
    expect(items).toContainEqual({ count: 1, name: '1.3" I2C OLED display (SH1106)' });
    expect(items).toContainEqual({ count: 2, name: "push buttons" });
  });
});
