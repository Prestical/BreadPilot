// Mistake statistics for the agent eval (kept out of the CLI so it can be unit-tested).

export interface AttemptRecord {
  idea: string;
  failedAttempts: { attempt: number; issues: { code: string; message: string }[] }[];
  designRetries: string[];
}

export const CHECK_TEXT: Record<string, string> = {
  C001: "syntax: brackets, quotes, missing ':' or indentation",
  C002: "uses something it never imported",
  C003: "pin that isn't on the header",
  C004: "pin that isn't wired",
  C005: "wrong pin mode (in/out/pull/ADC/PWM)",
  C006: "a wired part is never used",
  C008: "dangerous call (reset, sleep, file changes)",
  C010: "module that doesn't exist on the Pico",
  C011: "name used but never defined (typo)",
  C012: "display not set up, wrong size or never shown",
  C013: "display text, drawing names or methods that don't work",
  C014: "other names for machine's pin classes",
  C015: "name the machine module doesn't have",
  C016: "fake or unfinished code (placeholder value, TODO, empty function)",
  C017: "input(): waits for typing on a computer",
};

/** Normalizes line numbers so the same mistake on different lines counts once. */
export const normalizeMessage = (code: string, message: string) =>
  `${code} ${message.replace(/^Line \d+ /, "").replace(/ on line \d+/g, "").replace(/\bline \d+/g, "line N")}`;

export function mistakeReport(results: AttemptRecord[]): string {
  const out: string[] = [];
  const failed = results.flatMap((r) => r.failedAttempts.map((a) => ({ ...a, idea: r.idea })));
  out.push(`\nCode mistakes: ${failed.length} failed attempt(s) in ${new Set(failed.map((f) => f.idea)).size} project(s)`);
  if (failed.length) {
    const byCode = new Map<string, { attempts: number; projects: Set<string> }>();
    const byMessage = new Map<string, number>();
    for (const f of failed) {
      for (const code of new Set(f.issues.map((i) => i.code))) {
        const e = byCode.get(code) ?? { attempts: 0, projects: new Set<string>() };
        e.attempts++;
        e.projects.add(f.idea);
        byCode.set(code, e);
      }
      for (const i of f.issues) {
        const key = normalizeMessage(i.code, i.message);
        byMessage.set(key, (byMessage.get(key) ?? 0) + 1);
      }
    }
    out.push("| Check | Meaning | Failed attempts | Projects |", "|---|---|---|---|");
    for (const [code, e] of [...byCode].sort((a, b) => b[1].attempts - a[1].attempts)) {
      out.push(`| ${code} | ${CHECK_TEXT[code] ?? ""} | ${e.attempts} | ${e.projects.size} |`);
    }
    out.push("", "Most common messages:");
    for (const [msg, n] of [...byMessage].sort((a, b) => b[1] - a[1]).slice(0, 10)) out.push(`  ${String(n).padStart(3)}× ${msg}`);
  }
  const design = results.flatMap((r) => r.designRetries);
  if (design.length) out.push(`\nDesign repairs: ${design.length}`, ...design.map((d) => `  - ${d}`));
  return out.join("\n");
}

// ---------- per difficulty (model tests, PLAN §13.2) ----------

export type Difficulty = "easy" | "medium" | "hard";
export const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];

export interface DifficultyRecord {
  difficulty?: Difficulty;
  correct: boolean;
  validatedBuild: boolean;
  codeOk: boolean;
  codeAttempts: number;
  seconds: number;
}

export interface DifficultyRow {
  difficulty: Difficulty;
  ideas: number;
  correct: string;
  codeFirstTry: string;
  codeFinal: string;
  avgSeconds: number;
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "n/a");

/** One row per difficulty that has ideas: correct projects, code right first try / in the end, speed. */
export function byDifficulty(results: DifficultyRecord[]): DifficultyRow[] {
  return DIFFICULTIES.flatMap((difficulty) => {
    const rs = results.filter((r) => r.difficulty === difficulty);
    if (!rs.length) return [];
    const built = rs.filter((r) => r.validatedBuild);
    return [
      {
        difficulty,
        ideas: rs.length,
        correct: pct(rs.filter((r) => r.correct).length, rs.length),
        codeFirstTry: pct(built.filter((r) => r.codeOk && r.codeAttempts === 1).length, built.length),
        codeFinal: pct(built.filter((r) => r.codeOk).length, built.length),
        avgSeconds: Math.round((rs.reduce((n, r) => n + r.seconds, 0) / rs.length) * 10) / 10,
      },
    ];
  });
}

export function difficultyTable(rows: DifficultyRow[]): string {
  if (!rows.length) return "";
  return [
    "",
    "| Difficulty | Ideas | Correct project | Code 1st try | Code final | Avg s/project |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.difficulty} | ${r.ideas} | ${r.correct} | ${r.codeFirstTry} | ${r.codeFinal} | ${r.avgSeconds} |`),
  ].join("\n");
}

// ---------- memory during a run (model tests, PLAN §13.2) ----------

const UNITS: Record<string, number> = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 };

/** Used swap from macOS `sysctl -n vm.swapusage` ("total = 2048.00M  used = 1024.00M  free = …"). */
export function parseSwapUsage(text: string): number | null {
  const m = /used\s*=\s*([\d.]+)([KMG])/.exec(text);
  return m ? Math.round(Number(m[1]) * UNITS[m[2]!]!) : null;
}

/** Used swap from Linux /proc/meminfo (SwapTotal/SwapFree in kB). */
export function parseMeminfoSwap(text: string): number | null {
  const kb = (name: string) => Number(new RegExp(`^${name}:\\s+(\\d+) kB`, "m").exec(text)?.[1] ?? NaN);
  const used = kb("SwapTotal") - kb("SwapFree");
  return Number.isNaN(used) ? null : used * 1024;
}

/** Bytes used by Ollama's processes, from `ps -axo rss=,command=`. Only the sum leaves this function. */
export function ollamaProcessBytes(psOutput: string): number {
  let kb = 0;
  for (const line of psOutput.split("\n")) {
    const m = /^\s*(\d+)\s+(\S+)/.exec(line);
    if (m && /^(ollama|llama-server)/i.test(m[2]!.split("/").pop()!)) kb += Number(m[1]);
  }
  return kb * 1024;
}

export interface MemorySample {
  /** This test's own process. */
  processBytes: number;
  /** Ollama's processes; null where they can't be read. */
  ollamaBytes: number | null;
  /** Used swap; null where it can't be read. */
  swapBytes: number | null;
}

const size = (b: number | null) => (b === null ? "n/a" : b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);

export const memoryLine = (m: MemorySample) => `memory: this test ${size(m.processBytes)} · Ollama ${size(m.ollamaBytes)} · swap ${size(m.swapBytes)}`;

/** Stop a run before the computer suffers: true when swap grew more than the limit since the start. */
export function swapTooHigh(startBytes: number | null, nowBytes: number | null, limitGb: number): boolean {
  return startBytes !== null && nowBytes !== null && nowBytes - startBytes > limitGb * 1e9;
}
