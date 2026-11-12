import { describe, expect, it } from "vitest";
import { byDifficulty, difficultyTable, memoryLine, mistakeReport, ollamaProcessBytes, parseMeminfoSwap, parseSwapUsage, swapTooHigh } from "../src/agent/eval-report";

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

describe("memory during a model test", () => {
  it("reads macOS swap", () => {
    expect(parseSwapUsage("total = 2048.00M  used = 1024.50M  free = 1023.50M  (encrypted)")).toBe(1024.5 * 1024 ** 2);
    expect(parseSwapUsage("total = 4.00G  used = 1.50G  free = 2.50G")).toBe(1.5 * 1024 ** 3);
    expect(parseSwapUsage("total = 0.00M  used = 0.00M  free = 0.00M")).toBe(0);
    expect(parseSwapUsage("")).toBeNull();
  });

  it("reads Linux swap", () => {
    expect(parseMeminfoSwap("MemTotal: 16 kB\nSwapTotal:       2048 kB\nSwapFree:        1024 kB\n")).toBe(1024 * 1024);
    expect(parseMeminfoSwap("MemTotal: 16 kB\n")).toBeNull();
  });

  it("adds up only Ollama's processes, by program name", () => {
    const ps = [
      "  100000 /Applications/Ollama.app/Contents/Resources/ollama serve",
      " 5000000 /Applications/Ollama.app/Contents/Resources/ollama runner --model /Users/x/.ollama/models/blobs/sha256-a",
      "  200000 /opt/llama-server --port 1",
      "  900000 node src/eval-agent-cli.ts --model ollama:thing",
      "  300000 /usr/bin/tee .local/ollama.txt",
      "garbage",
    ].join("\n");
    expect(ollamaProcessBytes(ps)).toBe((100000 + 5000000 + 200000) * 1024);
    expect(ollamaProcessBytes("")).toBe(0);
  });

  it("prints one short line, and says when something can't be read", () => {
    expect(memoryLine({ processBytes: 9e8, ollamaBytes: 5.3e9, swapBytes: 120e6 })).toBe("memory: this test 900 MB · Ollama 5.3 GB · swap 120 MB");
    expect(memoryLine({ processBytes: 1.2e9, ollamaBytes: null, swapBytes: null })).toBe("memory: this test 1.2 GB · Ollama n/a · swap n/a");
  });

  it("stops only when swap grew more than the limit since the start", () => {
    expect(swapTooHigh(1e9, 3e9, 2)).toBe(false);
    expect(swapTooHigh(1e9, 3.1e9, 2)).toBe(true);
    expect(swapTooHigh(5e9, 5e9, 2)).toBe(false); // swap already in use before the test isn't its fault
    expect(swapTooHigh(null, 9e9, 2)).toBe(false);
    expect(swapTooHigh(0, null, 2)).toBe(false);
  });
});
