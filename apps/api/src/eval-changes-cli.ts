// M9 9.6 change test: builds each project in data/eval/changes.jsonl from its idea, asks for one
// change, and reports whether the change was made, of the expected kind, with the right parts,
// with every part that stays in its place, and with code that passes the checks.
//   npm run eval:changes -w @breadpilot/api -- [--openai] [--model <tag>] [--only 1,3] [--json out.json]
// The code before and after each change is saved in the JSON for review: "correct" means "passes
// the checks", not "works on the Pico".
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { changeTable, runChangeCase, type ChangeCase, type ChangeResult } from "./agent/change-eval";
import { createLlm } from "./agent/llm";
import { memoryStore } from "./agent/project";
import type { AgentDeps } from "./agent/pipeline";
import { loadConfig } from "./config";
import { devKey, openDataDir } from "./datadir";
import { ollamaModels, thinkSetting } from "./local-models";
import { openAiEmbedder } from "./rag/embed";
import { hybridSearch } from "./rag/search";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const config = loadConfig();
const openai = process.argv.includes("--openai");
if (openai && !config.OPENAI_API_KEY.trim()) throw new Error("--openai needs OPENAI_API_KEY in .env");
const model = arg("model") ?? (openai ? config.OPENAI_MODEL : config.LLM_MODEL);
const only = arg("only")?.split(",").map(Number);
const data = await openDataDir({ dir: config.DATA_DIR, key: await devKey(config.DATA_DIR) });
const db = data.db;
const embedder = openAiEmbedder(config.LLM_BASE_URL, config.EMBED_MODEL);
const think = thinkSetting(ollamaModels({ baseUrl: () => config.LLM_BASE_URL }));
const deps: AgentDeps = {
  llm: openai
    ? createLlm({ api: "openai", baseUrl: config.OPENAI_BASE_URL, model, numCtx: config.LLM_NUM_CTX, temperature: config.LLM_TEMPERATURE, timeoutMs: config.OPENAI_TIMEOUT_MS, apiKey: config.OPENAI_API_KEY.trim(), reasoningEffort: config.OPENAI_REASONING_EFFORT })
    : createLlm({ api: config.LLM_API, baseUrl: config.LLM_BASE_URL, model, numCtx: config.LLM_NUM_CTX, temperature: config.LLM_TEMPERATURE, timeoutMs: config.LLM_TIMEOUT_MS, think: () => think(model) }),
  store: memoryStore(),
  search: async (q) => (await hybridSearch(db, embedder, q, { board: "pico-2-w", k: 2 })).hits.map((h) => ({ content: h.content, citation: h.citation })),
};

try {
  const index = await db.query<{ exists: boolean }>("SELECT to_regclass('chunks') IS NOT NULL AS exists");
  const vectors = index.rows[0]?.exists ? (await db.query<{ n: number }>("SELECT count(embedding)::int AS n FROM chunks")).rows[0]?.n : 0;
  if (!vectors) throw new Error("The documentation index is empty. Open Ollama, then run: npm run ingest -w @breadpilot/api");
  const file = arg("file") ?? "data/eval/changes.jsonl";
  const cases = (await readFile(join(config.REPO_DIR, file), "utf8"))
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as ChangeCase)
    .filter((_, i) => !only || only.includes(i + 1));
  console.log(`Model: ${model} · ${file} · ${cases.length} changes\n`);
  const out = arg("json");
  const results: ChangeResult[] = [];
  for (const [i, c] of cases.entries()) {
    let r: ChangeResult;
    try {
      r = await runChangeCase(deps, c);
    } catch (err) {
      r = { idea: c.idea, change: c.change, built: false, expectedKind: c.expect.kind, kind: null, made: false, partsBefore: {}, partsAfter: {}, partsMatch: false, kept: 0, moved: [], codeOk: false, changeSteps: [], secondsBuild: 0, secondsChange: 0, llmCallsChange: 0, correct: false, note: `crashed: ${(err as Error).message}` };
    }
    results.push(r);
    const parts = (p: Record<string, number>) => Object.entries(p).map(([k, n]) => `${n}×${k}`).join(" ") || "none";
    console.log(
      `${String(i + 1).padStart(2)}. ${r.correct ? "✓" : "✗"} ${r.built ? `${r.kind ?? "?"} (expected ${r.expectedKind}) · ${r.made ? "made" : `NOT made${r.changeError ? `: ${r.changeError}` : ""}`} · parts ${parts(r.partsBefore)} → ${parts(r.partsAfter)}${r.partsMatch ? "" : " (expected other)"} · kept ${r.kept}${r.moved.length ? `, MOVED ${r.moved.join(" ")}` : ""} · code ${r.codeOk ? "ok" : "fails the checks"} · ${r.secondsChange}s, ${r.llmCallsChange} calls` : `not built: ${r.note}`}`,
    );
    console.log(`    ${c.idea} → "${c.change}"`);
    if (r.changeSteps.length) console.log(`    steps: ${r.changeSteps.join(", ")}`);
    if (out) await writeFile(out, JSON.stringify({ partial: i + 1 < cases.length, model, results }, null, 2));
  }
  console.log(`\n${changeTable(model, results)}`);
  if (out) console.log(`\nDetails written to ${out}`);
} finally {
  await data.close();
}
