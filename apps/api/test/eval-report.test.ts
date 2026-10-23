import { describe, expect, it } from "vitest";
import { mistakeReport } from "../src/agent/eval-report";

describe("mistakeReport", () => {
  it("summarizes failed attempts per check and per message", () => {
    const text = mistakeReport([
      { idea: "a", failedAttempts: [{ attempt: 1, issues: [{ code: "C005", message: "GP16 is wired as an output, but line 4 sets it up as an input." }] }], designRetries: [] },
      { idea: "b", failedAttempts: [{ attempt: 1, issues: [{ code: "C005", message: "GP16 is wired as an output, but line 9 sets it up as an input." }, { code: "C099", message: "x" }] }], designRetries: ["No ADC pins left"] },
    ]);
    expect(text).toContain("Code mistakes: 2 failed attempt(s) in 2 project(s)");
    expect(text).toContain("| C005 | wrong pin mode (in/out/pull/ADC/PWM) | 2 | 2 |");
    expect(text).toContain("| C099 |  | 1 | 1 |"); // unknown codes don't crash
    expect(text).toContain("2× C005 GP16 is wired as an output, but line N sets it up as an input.");
    expect(text).toContain("Design repairs: 1");
  });
  it("handles a run with no mistakes", () => {
    expect(mistakeReport([{ idea: "a", failedAttempts: [], designRetries: [] }])).toBe("\nCode mistakes: 0 failed attempt(s) in 0 project(s)");
  });
});
