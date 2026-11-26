// M18 18.2: the gate for engine-made wiring stops on warnings too, not only on errors.
import { layoutProject, parseConnections, type Build, type Part } from "@breadpilot/circuit-core";
import { describe, expect, it } from "vitest";
import { assertEngineBuild } from "../src/agent/gate";

const build = (parts: Part[], dsl: string, gpioModes: Build["gpioModes"]): Build => ({ boardId: "pico-2-w", parts, wires: parseConnections(dsl).wires, gpioModes });
const button: Part = { ref: "BTN1", type: "button-6mm", legs: { "1a": "30e", "1b": "30f", "2a": "32e", "2b": "32f" } };

describe("engine build gate", () => {
  it("passes what the layout engine makes", () => {
    for (const kinds of [["led"], ["led", "button"], ["pot", "led", "oled"]]) {
      expect(() => assertEngineBuild(layoutProject(kinds.map((kind) => ({ kind }))).build, "generated layout")).not.toThrow();
    }
  });

  it("stops a build whose only issue is a warning (W002: motor straight on a GPIO)", () => {
    const b = build([{ ref: "M1", type: "dc-motor", legs: { a: "30g", b: "31g" } }], `#21(GP16) -> #30j(M1.a)\n#31j(M1.b) -> #38(GND)`, { GP16: "out" });
    expect(() => assertEngineBuild(b, "generated layout")).toThrow(/generated layout has a warning the layout engine should never cause \(W002: /);
  });

  it("stops a floating input (W003)", () => {
    const b = build([button], `#21(GP16) -> #30j(BTN1.1b)\n#32j(BTN1.2b) -> #38(GND)`, { GP16: "in" });
    expect(() => assertEngineBuild(b, "rails layout")).toThrow(/rails layout has a warning .*W003/);
  });

  it("names the error first when there are errors and warnings", () => {
    const b = build([button], `#36(3V3) -> #30j(BTN1.1b)\n#32j(BTN1.2b) -> #38(GND)\n#21(GP16) -> #30a(BTN1.1a)`, { GP16: "in" });
    expect(() => assertEngineBuild(b, "generated layout")).toThrow(/generated layout failed validation \(E00/);
  });
});
