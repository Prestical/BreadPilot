// Repair messages the model can act on (PLAN §13.4, Milestone 8, step 8.2). The checker says what's
// wrong; this adds what to write: the model's own line, the corrected line when the checker knows it,
// the exact import line to change, and a note when the same mistake comes back. General: built only
// from the checker's issues and the code itself, never from the project's idea. BreadPilot never
// changes the code: the model writes every fix itself.

import type { CodeIssue } from "@breadpilot/circuit-core";

/** Names that live in `machine` (same list as the checker's C002). */
const MACHINE_NAMES = ["Pin", "ADC", "PWM", "Timer", "I2C", "SoftI2C", "SPI", "UART", "RTC", "WDT"];

const quote = (code: string) => `\`${code.trim()}\``;

/** The same problem in another attempt, whatever line it moved to. */
export const problemKey = (i: CodeIssue) => `${i.code} ${i.message.replace(/\b([Ll]ine) \d+/g, "$1 N").replace(/\bline \d+/g, "line N")}`;

/** `from machine import Pin, PWM` → its line number and names (aliases kept as written). */
function machineImport(code: string): { line: number; names: string[] } | null {
  const lines = code.split("\n");
  const i = lines.findIndex((l) => /^\s*from\s+machine\s+import\s+[^*]/.test(l));
  if (i < 0) return null;
  const names = lines[i]!
    .replace(/^\s*from\s+machine\s+import\s+/, "")
    .replace(/#.*$/, "")
    .replace(/[()]/g, "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  return { line: i + 1, names };
}

/** "Pin" from "Pin", "Pin as P" → "Pin". */
const importedName = (n: string) => n.split(/\s+as\s+/)[0]!.trim();

/**
 * The problems for the next attempt, one string each. Errors only; warnings stay in the Code panel.
 * `previous` = the issues of the attempt before, to say which mistakes are repeated.
 */
export function repairProblems(code: string, issues: CodeIssue[], previous: CodeIssue[] = []): string[] {
  const lines = code.split("\n");
  const errors = issues.filter((i) => i.severity === "error");
  const before = new Set(previous.filter((i) => i.severity === "error").map(problemKey));

  // Imports: everything `machine` must give, from missing-import problems and from the corrected lines.
  const imp = machineImport(code);
  const have = new Set((imp?.names ?? []).map(importedName));
  const star = /^\s*from\s+machine\s+import\s+\*/m.test(code);
  const needed = new Set<string>();
  for (const i of errors) {
    const missing = i.code === "C002" ? /uses (\w+) but it isn't imported/.exec(i.message)?.[1] : undefined;
    if (missing && MACHINE_NAMES.includes(missing)) needed.add(missing);
    for (const n of MACHINE_NAMES) if (i.fix && new RegExp(`\\b${n}\\s*\\(`).test(i.fix.write) && !have.has(n) && !star) needed.add(n);
  }
  const newImport = needed.size ? `from machine import ${[...(imp?.names ?? []), ...[...needed].filter((n) => !have.has(n))].join(", ")}` : null;
  const importLine = newImport ? (imp ? `Write line ${imp.line} as: ${quote(newImport)}.` : `Add this line at the top: ${quote(newImport)}.`) : null;

  const out = errors.map((i) => {
    const parts = [before.has(problemKey(i)) ? `Same mistake as in your last try, fix it this time: ${i.message}` : i.message];
    const own = i.line !== undefined ? lines[i.line - 1] : undefined;
    if (own?.trim()) parts.push(`Your line ${i.line}: ${quote(own)}`);
    if (i.fix) parts.push(`Write line ${i.fix.line} as: ${quote(i.fix.write)}`);
    if (i.code === "C002") {
      const mod = /never imports it\. Add: (import \w+)/.exec(i.message)?.[1];
      if (mod) parts.push(`Add this line at the top: ${quote(mod)}`);
      else if (importLine) parts.push(importLine);
    }
    return parts.join("\n  ");
  });
  // A corrected line that needs a new import, when no missing-import problem says so already.
  const c002Machine = errors.some((i) => i.code === "C002" && MACHINE_NAMES.includes(/uses (\w+) but/.exec(i.message)?.[1] ?? ""));
  if (importLine && !c002Machine) out.push(`The corrected lines need another import. ${importLine}`);
  return out;
}
