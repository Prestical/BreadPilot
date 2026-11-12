// Agent eval (Milestone 4 acceptance + model comparison).
//   npm run eval:agent -w @breadpilot/api -- [--file data/eval/agent-holdout.jsonl] [--only 3,7] [--model qwen3:8b] [--openai] [--limit 5] [--json /tmp/out.json] [--think on|off]
//   npm run eval:models -w @breadpilot/api -- --model qwen3.5:4b [--json out.json]
//     = the 50-idea model test (data/eval/models.jsonl: 20 easy, 20 medium, 10 hard), PLAN §13.2.
//   --openai: run every idea on OpenAI's model (OPENAI_API_KEY, OPENAI_MODEL in .env) to compare with the local one.
//   --think: override the model list's `think` value (only sent to models Ollama says can think).
//   --max-swap-gb 2: stop the run when swap grew this much since the start (default 2).
//   --keep-loaded: don't reload the model between ideas (to compare memory with and without it).
// For a local model it also reports the memory the model used, as the local Ollama's /api/ps says.
// Between ideas the model is unloaded and loaded again, outside the measured time, so its process
// starts clean for each idea. After each idea it prints this test's memory, Ollama's processes and
// swap, and the results so far are saved, so a stopped or cancelled run loses nothing.
// Runs every idea in data/eval/agent.jsonl through the real pipeline (in-memory project store,
// real LLM, real documentation search). Vague plans are auto-approved as-is.
// Target: ≥ 90% of supported ideas end with a validated build (milestone gate). "Correct project"
// is the stricter, user-level measure: right outcome, right parts, working code. Every result is
// re-checked here with validateBuild + checkMicroPython instead of trusting the pipeline's verdicts.

import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { checkMicroPython, getBoard, validateBuild } from "@breadpilot/circuit-core";
import { totalmem } from "node:os";
import { byDifficulty, difficultyTable, memoryLine, mistakeReport, ollamaProcessBytes, parseMeminfoSwap, parseSwapUsage, swapTooHigh, type Difficulty, type MemorySample } from "./agent/eval-report";
import { ollamaModels, sameTag, thinkSetting } from "./local-models";
import { loadConfig } from "./config";
import { devKey, openDataDir } from "./datadir";
import { createLlm } from "./agent/llm";
import { approvePlan, createProject, type AgentDeps } from "./agent/pipeline";
import { currentPlan, memoryStore, type Project } from "./agent/project";
import { openAiEmbedder } from "./rag/embed";
import { hybridSearch } from "./rag/search";

interface Case {
  idea: string;
  /** Model tests (data/eval/models.jsonl): how hard the project is. */
  difficulty?: Difficulty;
  /** outcome: "ready" (default) or "handoff" (e.g. more parts than fit). Unsupported ideas always expect a handoff. */
  expect: { clarity: "clear" | "vague" | "unsupported"; parts?: Record<string, number>; outcome?: "ready" | "handoff" };
}

interface Result {
  idea: string;
  difficulty?: Difficulty;
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
  /** Memory right after this idea. */
  memory?: MemorySample;
  /** What the plan said the project must do, and the final code: for reviewing whether it really does it. */
  behaviors?: string[];
  code?: string;
}

const run = promisify(execFile);

async function usedSwap(): Promise<number | null> {
  try {
    if (process.platform === "darwin") return parseSwapUsage((await run("sysctl", ["-n", "vm.swapusage"])).stdout);
    if (process.platform === "linux") return parseMeminfoSwap(await readFile("/proc/meminfo", "utf8"));
  } catch {
    /* not available here */
  }
  return null;
}

/** Never fails: a memory reading must not break a test (spawning can throw right away). */
async function ollamaBytes(): Promise<number | null> {
  if (process.platform === "win32") return null;
  try {
    return ollamaProcessBytes((await run("ps", ["-axo", "rss=,command="], { maxBuffer: 16 * 1024 * 1024 })).stdout);
  } catch {
    return null;
  }
}

async function sampleMemory(): Promise<MemorySample> {
  return { processBytes: process.memoryUsage().rss, ollamaBytes: await ollamaBytes(), swapBytes: await usedSwap() };
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
const maxSwapGb = Number(arg("max-swap-gb") ?? 2);
if (!(maxSwapGb > 0)) throw new Error("--max-swap-gb takes a number above 0");
const keepLoaded = process.argv.includes("--keep-loaded");
const data = await openDataDir({ dir: config.DATA_DIR, key: await devKey(config.DATA_DIR) });
const db = data.db;
const embedder = openAiEmbedder(config.LLM_BASE_URL, config.EMBED_MODEL);
const ollama = ollamaModels({ baseUrl: () => config.LLM_BASE_URL });
const thinkArg = arg("think");
if (thinkArg && thinkArg !== "on" && thinkArg !== "off") throw new Error("--think takes on or off");
const catalogThink = thinkSetting(ollama);
// --think forces a value (still only for models that can think); without it the model list decides.
const think = async (): Promise<boolean | undefined> => {
  if (!thinkArg) return catalogThink(model);
  const caps = await ollama.capabilities(model).catch(() => [] as string[]);
  return caps.includes("thinking") ? thinkArg === "on" : undefined;
};

const deps: AgentDeps = {
  llm: openai
    ? createLlm({ api: "openai", baseUrl: config.OPENAI_BASE_URL, model, numCtx: config.LLM_NUM_CTX, temperature: config.LLM_TEMPERATURE, timeoutMs: config.OPENAI_TIMEOUT_MS, apiKey: config.OPENAI_API_KEY.trim(), reasoningEffort: config.OPENAI_REASONING_EFFORT })
    : createLlm({ api: config.LLM_API, baseUrl: config.LLM_BASE_URL, model, numCtx: config.LLM_NUM_CTX, temperature: config.LLM_TEMPERATURE, timeoutMs: config.LLM_TIMEOUT_MS, think }),
  store: memoryStore(),
  search: async (q) => (await hybridSearch(db, embedder, q, { board: "pico-2-w", k: 2 })).hits.map((h) => ({ content: h.content, citation: h.citation })),
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
  // Without the documentation index every project would run without its datasheet excerpts (or
  // fail), and the results wouldn't say anything about the model.
  const index = await db.query<{ exists: boolean }>("SELECT to_regclass('chunks') IS NOT NULL AS exists");
  const vectors = index.rows[0]?.exists ? (await db.query<{ n: number }>("SELECT count(embedding)::int AS n FROM chunks")).rows[0]?.n : 0;
  if (!vectors) throw new Error("The documentation index is empty. Open Ollama, then run: npm run ingest -w @breadpilot/api");

  const file = arg("file") ?? "data/eval/agent.jsonl";
  const cases = (await readFile(join(config.REPO_DIR, file), "utf8"))
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Case)
    .filter((_, i) => !only || only.includes(i + 1))
    .slice(0, limit);
  console.log(`Model: ${model} · ${file} · ${cases.length} ideas\n`);

  const out = arg("json");
  const startSwap = await usedSwap();
  let stopped: string | null = null;
  const results: Result[] = [];
  for (const [i, c] of cases.entries()) {
    // A clean model process for every idea, outside the measured time.
    if (!openai && !keepLoaded) {
      if (i > 0) await ollama.load(model, config.LLM_NUM_CTX, 0).catch(() => {});
      await ollama.load(model, config.LLM_NUM_CTX, "15m").catch((err: Error) => console.log(`      couldn't load the model: ${err.message}`));
    }
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
      ...(c.difficulty ? { difficulty: c.difficulty } : {}),
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
      behaviors: currentPlan(p)?.behavior ?? [],
      ...(p.build?.code ? { code: p.build.code } : {}),
    };
    results.push(r);
    r.memory = await sampleMemory();
    const partsText = Object.entries(parts).map(([k, v]) => `${v}×${k}`).join(" ") || "-";
    console.log(
      `${String(i + 1).padStart(2)}. ${r.correct ? "✓" : "✗"} ${r.difficulty ? `[${r.difficulty}] ` : ""}${r.state.padEnd(14)} ` +
        `clarity ${r.clarity ?? "?"}${r.clarity === r.expectedClarity ? "" : ` (expected ${r.expectedClarity})`} · parts ${partsText}` +
        `${r.partsMatch === false ? " (≠ expected)" : ""} · code ${r.codeOk ? `ok after ${r.codeAttempts}` : r.codeAttempts ? "FAILED" : "-"} · ${r.seconds}s  ${c.idea}` +
        `${r.note ? `\n      note: ${r.note}` : ""}\n      ${memoryLine(r.memory)}`,
    );
    if (out) await writeFile(out, JSON.stringify({ partial: true, model, results }, null, 2));
    if (swapTooHigh(startSwap, r.memory.swapBytes, maxSwapGb)) {
      stopped = `Stopped after ${results.length} of ${cases.length} ideas: swap grew more than ${maxSwapGb} GB since the start. Close other apps and run it again, or use a smaller model.`;
      console.log(`\n${stopped}`);
      break;
    }
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
  const difficulty = byDifficulty(results);
  // Memory, as the local Ollama measured it while the model was loaded for this run.
  let memory: { bytes: number; contextLength: number | null; computerBytes: number } | null = null;
  if (!openai) {
    const run = (await ollama.running().catch(() => [])).find((m) => sameTag(m.tag, model));
    if (run) memory = { bytes: run.bytes, contextLength: run.contextLength, computerBytes: totalmem() };
  }

  console.log(`
| Model | Correct project | Validated build | READY (code ok) | Clarity | Unsupported caught | Parts match | Code 1st try | Code final | Avg s/project |
|---|---|---|---|---|---|---|---|---|---|
| ${summary.model} | ${summary.correct} | ${summary.validatedBuild} | ${summary.ready} | ${summary.clarity} | ${summary.unsupportedCaught} | ${summary.partsMatch} | ${summary.codeFirstTry} | ${summary.codeFinal} | ${summary.avgSeconds} |`);
  console.log(difficultyTable(difficulty));
  if (memory) {
    console.log(`\nMemory (local Ollama /api/ps): ${(memory.bytes / 1e9).toFixed(1)} GB at ${memory.contextLength ?? config.LLM_NUM_CTX} tokens of context · this computer ${Math.round(memory.computerBytes / 2 ** 30)} GB`);
  } else if (!openai) console.log("\nMemory: the model wasn't loaded at the end of the run, so Ollama couldn't report it.");

  if (out) {
    await writeFile(out, JSON.stringify({ ...(stopped ? { stopped } : {}), summary, difficulty, memory, results }, null, 2));
    console.log(`\nDetails written to ${out}`);
  }
  console.log(mistakeReport(results));
  if (stopped) console.log(`\n${stopped}`);
  if (stopped || built.length / Math.max(1, supported.length) < 0.9) process.exitCode = 1;
} finally {
  await data.close();
}

