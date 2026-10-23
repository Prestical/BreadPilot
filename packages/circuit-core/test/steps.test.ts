import { describe, expect, it } from "vitest";
import { layoutProject } from "../src/layout";
import { buildSteps, formatOhms, resistorBands, StepsError } from "../src/steps";
import { mk } from "./helpers";

describe("resistor color bands", () => {
  it.each([
    [220, ["red", "red", "brown", "gold"]],
    [330, ["orange", "orange", "brown", "gold"]],
    [1000, ["brown", "black", "red", "gold"]],
    [10000, ["brown", "black", "orange", "gold"]],
    [47, ["yellow", "violet", "black", "gold"]],
  ])("%i Ω", (ohms, bands) => {
    expect(resistorBands(ohms)).toEqual(bands);
  });
  it("formats values", () => {
    expect([formatOhms(330), formatOhms(4700), formatOhms(10000)]).toEqual(["330 Ω", "4.7 kΩ", "10 kΩ"]);
  });
});

describe("buildSteps", () => {
  const { build } = layoutProject([{ kind: "led" }, { kind: "button" }]);
  const steps = buildSteps(build);

  it("orders breadboard → Pico → parts → ground → signal → USB", () => {
    expect(steps.map((s) => s.kind)).toEqual(["intro", "place-pico", "place-part", "place-part", "place-part", "wire", "wire", "wire", "wire", "wire", "usb"]);
    expect(steps.filter((s) => s.kind === "wire").map((s) => s.wireRole)).toEqual(["ground", "ground", "ground", "signal", "signal"]);
    expect(steps.map((s) => s.index)).toEqual(steps.map((_, i) => i));
  });

  it("writes hole numbers that match the layout", () => {
    const led = steps.find((s) => s.partRef === "LED1")!;
    expect(led.text).toBe("Push the red LED LED1 into the breadboard: long leg (+) into hole 27g and short leg (−) into hole 28g.");
    const signal = steps.find((s) => s.dsl === "#21(GP16) -> #24j(R1.a)")!;
    expect(signal.title).toBe("Yellow wire (signal)");
    expect(signal.text).toBe(
      "Take a yellow jumper wire. Plug one end into hole 20j, right next to Pico pin 21 (GP16). Plug the other end into hole 24j, in the same row as R1 leg 1.",
    );
    const gnd = steps.find((s) => s.dsl === "#23(GND) -> #RR-(GND)")!;
    expect(gnd.text).toContain("hole 18j, right next to Pico pin 23 (GND)");
    expect(gnd.text).toContain("the right − rail (blue line), next to row 18");
    expect(gnd.focus).toEqual({ holes: ["18j"], rails: ["RR-"] });
  });

  it("explains resistor bands", () => {
    expect(steps.find((s) => s.partRef === "R1")!.tip).toContain("orange, orange, brown, gold");
  });

  it("puts 3V3 power wires after signal wires", () => {
    const roles = buildSteps(layoutProject([{ kind: "pot" }, { kind: "led" }]).build)
      .filter((s) => s.kind === "wire")
      .map((s) => s.wireRole);
    expect(roles.indexOf("power")).toBeGreaterThan(roles.lastIndexOf("signal"));
  });

  it("explains every step with code-written 'why' notes that match the circuit", () => {
    const why = (pred: (s: (typeof steps)[number]) => boolean) => steps.find(pred)!.why;
    expect(steps.every((s) => s.why.length > 20)).toBe(true);
    expect(why((s) => s.partRef === "R1")).toBe(
      "R1 limits the current through LED1 to about 3.9 mA ((3.3 V − 2 V) ÷ 330 Ω). Without it, too much current would flow and could damage the LED or the Pico pin.",
    );
    expect(why((s) => s.dsl === "#23(GND) -> #RR-(GND)")).toMatch(/ground \(0 V\) on the whole − rail/);
    expect(why((s) => s.dsl === "#28j(LED1.cathode) -> #RR-(GND)")).toMatch(/completes LED1's circuit/);
    expect(why((s) => s.dsl === "#32j(BTN1.2b) -> #RR-(GND)")).toBe(
      "When BTN1 is pressed, it connects its pin to ground, so the pin reads 0 (LOW). The rest of the time the Pico's internal pull-up makes it read 1.",
    );
    expect(why((s) => s.dsl === "#21(GP16) -> #24j(R1.a)")).toBe("GP16 is an output: when the code turns it on (3.3 V), current flows through R1 and lights LED1.");
    expect(why((s) => s.dsl === "#22(GP17) -> #30j(BTN1.1b)")).toBe("GP17 is the input the code reads to see BTN1: 1 while it's released and 0 while it's pressed.");
    expect(why((s) => s.kind === "usb")).toMatch(/Power goes in last/);
  });

  it("explains knob wiring and uses each LED's own forward voltage", () => {
    const s2 = buildSteps(layoutProject([{ kind: "pot" }, { kind: "led", props: { color: "blue" } }]).build);
    expect(s2.find((s) => s.dsl === "#36(3V3) -> #RR+(3V3)")!.why).toMatch(/puts 3V3 on the whole \+ rail/);
    expect(s2.find((s) => s.dsl?.startsWith("#31(GP26)"))!.why).toMatch(/GP26 is an analog input \(ADC\)/);
    expect(s2.find((s) => s.dsl?.includes("POT1.end1"))!.why).toMatch(/3.3 V on the other outer leg of POT1/);
    expect(s2.find((s) => s.partRef === "R1")!.why).toContain("about 0.9 mA ((3.3 V − 3 V)");
  });

  it("refuses to make steps for an unsafe build", () => {
    expect(() => buildSteps(mk([], "#36(3V3) -> #38(GND)"))).toThrow(StepsError);
  });
});
