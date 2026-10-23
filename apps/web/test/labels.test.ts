// Prompt-bar labels: the model's display name and the project's token line.
import { describe, expect, it } from "vitest";
import { modelName, usageText } from "../src/ui/labels";

describe("prompt bar labels", () => {
  it("turns OpenAI model ids into names", () => {
    expect(modelName("gpt-6-luna")).toBe("GPT-6 Luna");
    expect(modelName("gpt-6.1-sol")).toBe("GPT-6.1 Sol");
    expect(modelName("qwen3:4b")).toBe("qwen3:4b");
  });

  it("shows total, in, out, thinking and calls", () => {
    expect(usageText({ input: 9800, output: 2545, reasoning: 1900, calls: 6 })).toBe("12,345 tokens · 9,800 in · 2,545 out (1,900 thinking) · 6 model calls");
    expect(usageText({ input: 500, output: 200, reasoning: 0, calls: 1 })).toBe("700 tokens · 500 in · 200 out · 1 model call");
  });
});
