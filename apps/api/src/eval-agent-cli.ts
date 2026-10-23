// Agent eval (Milestone 4 acceptance + model comparison).
//   docker compose exec api node dist/eval-agent-cli.js [--file data/eval/agent-holdout.jsonl] [--only 3,7] [--model qwen3:8b] [--openai] [--limit 5] [--json /tmp/out.json]
//   --openai: run every idea on OpenAI's model (OPENAI_API_KEY, OPENAI_MODEL in .env) to compare with the local one.
// Runs every idea in data/eval/agent.jsonl through the real pipeline (in-memory project store,
// real LLM, real documentation search). Vague plans are auto-approved as-is.
// Target: ≥ 90% of supported ideas end with a validated build (milestone gate). "Correct project"
// is the stricter, user-level measure: right outcome, right parts, working code. Every result is
// re-checked here with validateBuild + checkMicroPython instead of trusting the pipeline's verdicts.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { checkMicroPython, getBoard, validateBuild } from "@breadpilot/circuit-core";
import { mistakeReport } from "./agent/eval-report";
import { loadConfig } from "./config";
import { createPool } from "./db";
import { createLlm } from "./agent/llm";
import { approvePlan, createProject, type AgentDeps } from "./agent/pipeline";
import { memoryStore, type Project } from "./agent/project";
import { openAiEmbedder } from "./rag/embed";
import { hybridSearch } from "./rag/search";

interface Case {
  idea: string;
  /** outcome: "ready" (default) or "handoff" (e.g. more parts than fit). Unsupported ideas always expect a handoff. */
  expect: { clarity: "clear" | "vague" | "unsupported"; parts?: Record<string, number>; outcome?: "ready" | "handoff" };
}

interface Result {
  idea: string;
  expectedClarity: string;
  clarity: string | undefined;
  state: Project["state"];
  validatedBuild: boolean;
  partsMatch: boolean | null;
  /** What a user would call success: the right kind of outcome, the right parts, working code. */
  correct: boolean;
  parts: Record<string, number>;
  codeAttempts: number;
  codeOk: boolean;
  llmCalls: number;
  seconds: number;
  /** Checker findings of every failed code attempt. */
  failedAttempts: { attempt: number; issues: { code: string; message: string }[]; code: string }[];
  /** Why the design had to be repaired. */
  designRetries: string[];
  note?: string;
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const config = loadConfig();
const openai = process.argv.includes("--openai");
if (openai && !config.OPENAI_API_KEY.trim()) throw new Error("--openai needs OPENAI_API_KEY in .env");
const model = arg("model") ?? (openai ? config.OPENAI_MODEL : config.LLM_MODEL);
const limit = Number(arg("limit") ?? Infinity);
const only = arg("only")?.split(",").map(Number);
const pool = createPool(config.DATABASE_URL);
const embedder = openAiEmbedder(config.LLM_BASE_URL, config.EMBED_MODEL);

const deps: AgentDeps = {
  llm: openai
    ? createLlm({ api: "openai", baseUrl: config.OPENAI_BASE_URL, model, numCtx: config.LLM_NUM_CTX, temperature: config.LLM_TEMPERATURE, timeoutMs: config.OPENAI_TIMEOUT_MS, apiKey: config.OPENAI_API_KEY.trim(), reasoningEffort: config.OPENAI_REASONING_EFFORT })
    : createLlm({ api: config.LLM_API, baseUrl: config.LLM_BASE_URL, model, numCtx: config.LLM_NUM_CTX, temperature: config.LLM_TEMPERATURE, timeoutMs: config.LLM_TIMEOUT_MS }),
  store: memoryStore(),
  search: async (q) => (await hybridSearch(pool, embedder, q, { board: "pico-2-w", k: 2 })).hits.map((h) => ({ content: h.content, citation: h.citation })),
};

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "n/a");
const countParts = (p: Project) => {
  const counts: Record<string, number> = {};
  for (const b of p.build?.blocks ?? []) counts[b.kind] = (counts[b.kind] ?? 0) + 1;
  return counts;
};
const sameCounts = (a: Record<string, number>, b: Record<string, number>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a[k] ?? 0) === (b[k] ?? 0));
};

try {
  const file = arg("file") ?? "data/eval/agent.jsonl";
  const cases = (await readFile(join(config.REPO_DIR, file), "utf8"))
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Case)
    .filter((_, i) => !only || only.includes(i + 1))
    .slice(0, limit);
  console.log(`Model: ${model} · ${file} · ${cases.length} ideas\n`);

  const results: Result[] = [];
  for (const [i, c] of cases.entries()) {
    const start = performance.now();
    let p = await createProject(deps, c.idea);
    if (p.state === "AWAIT_APPROVAL") p = await approvePlan(deps, p.id);
    const parts = countParts(p);
    // Re-check independently instead of trusting the pipeline's own verdicts.
    const finished = p.state === "READY" || p.state === "HANDOFF";
    const validatedBuild = finished && !!p.build && validateBuild(p.build.build).ok;
    const codeOk = validatedBuild && !!p.build!.code && checkMicroPython(p.build!.code, p.build!.build, getBoard(p.board)!).ok;
    const partsMatch = c.expect.parts ? sameCounts(parts, c.expect.parts) : null;
    const expectHandoff = c.expect.clarity === "unsupported" || c.expect.outcome === "handoff";
    const correct = expectHandoff ? p.state === "HANDOFF" && !p.build : p.state === "READY" && validatedBuild && codeOk && partsMatch !== false;
    const r: Result = {
      idea: c.idea,
      expectedClarity: c.expect.clarity,
      clarity: p.intake?.clarity,
      state: p.state,
      validatedBuild,
      partsMatch,
      correct,
      parts,
      codeAttempts: p.build?.codeAttempts ?? 0,
      codeOk,
      // Each LLM call logs exactly one "ok" event; repair loops add separate "retry" events.
      llmCalls: p.events.filter((e) => ["intake", "plan", "code"].includes(e.stage) && e.status === "ok").length,
      seconds: Math.round((performance.now() - start) / 100) / 10,
      failedAttempts: (p.build?.codeHistory ?? []).filter((h) => !h.ok).map((h) => ({ attempt: h.attempt, issues: h.issues.filter((i) => i.severity === "error").map(({ code, message }) => ({ code, message })), code: h.code })),
      designRetries: p.events.filter((e) => e.stage === "design" && e.status !== "ok").map((e) => e.detail ?? ""),
      ...(p.failure ? { note: p.failure } : p.handoffReason && p.build ? { note: "code handoff" } : {}),
    };
    results.push(r);
    const partsText = Object.entries(parts).map(([k, v]) => `${v}×${k}`).join(" ") || "-";
    console.log(
      `${String(i + 1).padStart(2)}. ${r.correct ? "✓" : "✗"} ${r.state.padEnd(14)} ` +
        `clarity ${r.clarity ?? "?"}${r.clarity === r.expectedClarity ? "" : ` (expected ${r.expectedClarity})`} · parts ${partsText}` +
        `${r.partsMatch === false ? " (≠ expected)" : ""} · code ${r.codeOk ? `ok after ${r.codeAttempts}` : r.codeAttempts ? "FAILED" : "-"} · ${r.seconds}s  ${c.idea}` +
        `${r.note ? `\n      note: ${r.note}` : ""}`,
    );
  }

  const expectsBuild = (r: Result) => r.expectedClarity !== "unsupported" && cases.find((c) => c.idea === r.idea)?.expect.outcome !== "handoff";
  const supported = results.filter(expectsBuild);
  const unsupported = results.filter((r) => r.expectedClarity === "unsupported");
  const withParts = results.filter((r) => r.partsMatch !== null);
  const built = supported.filter((r) => r.validatedBuild);
  const avg = results.reduce((n, r) => n + r.seconds, 0) / Math.max(1, results.length);
  const summary = {
    model,
    correct: pct(results.filter((r) => r.correct).length, results.length),
    validatedBuild: pct(built.length, supported.length),
    ready: pct(supported.filter((r) => r.state === "READY").length, supported.length),
    clarity: pct(results.filter((r) => r.clarity === r.expectedClarity).length, results.length),
    unsupportedCaught: pct(unsupported.filter((r) => r.state === "HANDOFF" && !r.validatedBuild).length, unsupported.length),
    partsMatch: pct(withParts.filter((r) => r.partsMatch).length, withParts.length),
    codeFirstTry: pct(built.filter((r) => r.codeOk && r.codeAttempts === 1).length, built.length),
    codeFinal: pct(built.filter((r) => r.codeOk).length, built.length),
    avgSeconds: Math.round(avg * 10) / 10,
  };

  console.log(`
| Model | Correct project | Validated build | READY (code ok) | Clarity | Unsupported caught | Parts match | Code 1st try | Code final | Avg s/project |
|---|---|---|---|---|---|---|---|---|---|
| ${summary.model} | ${summary.correct} | ${summary.validatedBuild} | ${summary.ready} | ${summary.clarity} | ${summary.unsupportedCaught} | ${summary.partsMatch} | ${summary.codeFirstTry} | ${summary.codeFinal} | ${summary.avgSeconds} |`);

  const out = arg("json");
  if (out) {
    await writeFile(out, JSON.stringify({ summary, results }, null, 2));
    console.log(`\nDetails written to ${out}`);
  }
  console.log(mistakeReport(results));
  if (built.length / Math.max(1, supported.length) < 0.9) process.exitCode = 1;
} finally {
  await pool.end();
}

