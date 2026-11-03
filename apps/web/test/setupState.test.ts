import { describe, expect, it } from "vitest";
import type { HealthReport } from "../src/health";
import { localAiState, pullCommand } from "../src/ui/setupState";

const local = { baseUrl: "http://localhost:11434/v1", model: "qwen3:4b", embedModel: "nomic-embed-text", numCtx: 16384, keepAliveMin: 1 };
const ok = { status: "ok" as const, detail: "" };
const report = (llm: HealthReport["checks"]["llm"], embed: HealthReport["checks"]["embed"]): HealthReport => ({
  status: "ok",
  checks: { db: ok, llm, embed },
  version: "0.0.1",
  circuitCore: "x",
  uptimeS: 1,
});

describe("first-run setup: local AI status", () => {
  it("waits for the first check", () => {
    expect(localAiState(null, local)).toEqual({ kind: "checking" });
    expect(localAiState(report(ok, ok), null)).toEqual({ kind: "checking" });
  });

  it("says Ollama isn't running when it doesn't answer", () => {
    const down = { status: "down" as const, detail: "LLM endpoint unreachable: fetch failed" };
    expect(localAiState(report(down, down), local)).toEqual({ kind: "offline" });
  });

  it("lists the models still to download", () => {
    const missing = (m: string) => ({ status: "down" as const, detail: `${m} not pulled (run: ollama pull ${m})` });
    expect(localAiState(report(missing("qwen3:4b"), missing("nomic-embed-text")), local)).toEqual({ kind: "missing", models: ["qwen3:4b", "nomic-embed-text"] });
    expect(localAiState(report(ok, missing("nomic-embed-text")), local)).toEqual({ kind: "missing", models: ["nomic-embed-text"] });
  });

  it("is ready when both models are there", () => {
    expect(localAiState(report(ok, ok), local)).toEqual({ kind: "ready" });
  });

  it("gives the exact command to paste", () => {
    expect(pullCommand("qwen3:4b")).toBe("ollama pull qwen3:4b");
  });
});
