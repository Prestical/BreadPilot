import { describe, expect, it } from "vitest";
import { formatWire, parseConnection, parseConnections, parseEndpoint } from "../src/dsl";

describe("DSL parser", () => {
  it("parses the canonical example #33(GND) -> #10(LED)", () => {
    expect(parseConnection("#33(GND) -> #10(LED)")).toEqual({
      from: { kind: "pico", phys: 33, label: "GND" },
      to: { kind: "hole", row: 10, label: "LED" },
    });
  });

  it("parses columns, component legs, rails and nested parentheses", () => {
    expect(parseEndpoint("#26a(R1.a)")).toEqual({ kind: "hole", row: 26, col: "a", label: "R1.a" });
    expect(parseEndpoint("#26A")).toEqual({ kind: "hole", row: 26, col: "a" });
    expect(parseEndpoint("#36(3V3(OUT))")).toEqual({ kind: "pico", phys: 36, label: "3V3(OUT)" });
    expect(parseEndpoint("#RL-(GND)")).toEqual({ kind: "rail", rail: "RL-", label: "GND" });
    expect(parseEndpoint("#rr+:30")).toEqual({ kind: "rail", rail: "RR+", row: 30 });
  });

  it("treats pin-name labels as Pico pins, even when the number is wrong (the validator catches it)", () => {
    expect(parseEndpoint("#33(GP15)")).toEqual({ kind: "pico", phys: 33, label: "GP15" });
  });

  it("rejects ambiguous or malformed endpoints with a helpful message", () => {
    expect(parseEndpoint("#33")).toMatch(/ambiguous/);
    expect(parseEndpoint("33(GND)")).toMatch(/Can't read/);
    expect(parseEndpoint("#RX+")).toMatch(/Can't read/);
    expect(parseConnection("#33(GND) #10(LED)")).toMatch(/exactly one "->"/);
  });

  it("parses multi-line text with comments and reports errors by line", () => {
    const r = parseConnections("// ground\n#38(GND) -> #RR-(GND)\n\n#oops -> #1a\n#21(GP16) -> #24j(R1.a) // signal");
    expect(r.wires).toHaveLength(2);
    expect(r.lines).toEqual([2, 5]);
    expect(r.errors).toEqual([expect.objectContaining({ line: 4 })]);
  });

  it("round-trips through formatWire", () => {
    for (const line of ["#33(GND) -> #10(LED)", "#20(GP15) -> #26a(R1.a)", "#28j(LED1.cathode) -> #RR-(GND)"]) {
      expect(formatWire(parseConnection(line) as never)).toBe(line);
    }
  });
});
