import { describe, expect, it } from "vitest";
import { byDifficulty, difficultyTable, mistakeReport } from "../src/agent/eval-report";

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

describe("byDifficulty (model tests)", () => {
  const r = (difficulty: "easy" | "medium" | "hard", correct: boolean, codeAttempts: number, seconds: number, built = true) => ({ difficulty, correct, validatedBuild: built, codeOk: correct, codeAttempts, seconds });

  it("summarises each difficulty that has ideas, in easy → medium → hard order", () => {
    const rows = byDifficulty([r("hard", false, 3, 60), r("easy", true, 1, 10), r("easy", true, 2, 20), r("hard", true, 1, 40)]);
    expect(rows).toEqual([
      { difficulty: "easy", ideas: 2, correct: "100%", codeFirstTry: "50%", codeFinal: "100%", avgSeconds: 15 },
      { difficulty: "hard", ideas: 2, correct: "50%", codeFirstTry: "50%", codeFinal: "50%", avgSeconds: 50 },
    ]);
    expect(difficultyTable(rows)).toContain("| easy | 2 | 100% | 50% | 100% | 15 |");
  });

  it("code rates only count projects that got a validated build; ideas without a difficulty are left out", () => {
    const rows = byDifficulty([r("medium", false, 0, 5, false), { correct: true, validatedBuild: true, codeOk: true, codeAttempts: 1, seconds: 1 }]);
    expect(rows).toEqual([{ difficulty: "medium", ideas: 1, correct: "0%", codeFirstTry: "n/a", codeFinal: "n/a", avgSeconds: 5 }]);
    expect(difficultyTable([])).toBe("");
  });
});
