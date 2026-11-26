// The `npm run sim` command (scripts/run-project.ts): options and frame pictures.

import { describe, expect, it } from "vitest";
import { draw, parse } from "../scripts/run-project";

describe("npm run sim", () => {
  it("turns --press, --knob and --sense into a scenario in microseconds, and joins the title words", () => {
    const o = parse(["OLED", "Runner", "Game", "--press", "BTN1@1-1.3", "--press", "BTN1@0.2-0.4", "--knob", "POT1@2=0.8", "--sense", "DHT1.temperature@0=30", "--seconds", "5", "--frames", "all"]);
    expect(o.query).toBe("OLED Runner Game");
    expect(o.seconds).toBe(5);
    expect(o.manual).toBe(true);
    expect(o.frames).toBe("all");
    expect(o.scenario.switches).toEqual({ BTN1: [[200000, 1], [400000, 0], [1000000, 1], [1300000, 0]] });
    expect(o.scenario.pots).toEqual({ POT1: [[2000000, 0.8]] });
    expect(o.scenario.sensors).toEqual({ "DHT1.temperature": [[0, 30]] });
  });

  it("refuses a malformed --press", () => {
    expect(() => parse(["x", "--press", "BTN1"])).toThrow(/BTN1@1-1.3/);
  });

  it("draws a frame as 32 text lines of 128 characters, two pixel rows per character", () => {
    const buf = new Uint8Array(1024);
    buf[0] = 0b11; // x 0: rows 0 and 1 -> full block
    buf[1] = 0b01; // x 1: row 0 only -> upper half
    buf[2] = 0b10; // x 2: row 1 only -> lower half
    const lines = draw(Buffer.from(buf).toString("base64")).split("\n");
    expect(lines).toHaveLength(34);
    expect(lines[1]!.slice(0, 5)).toBe("|█▀▄ ");
    expect(lines[1]!.length).toBe(130);
  });
});
