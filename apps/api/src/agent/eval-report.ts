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
