// BreadPilot behaviour simulator: one call that runs a program on its circuit with the automatic
// test run and returns what went wrong (M18 18.7e). Used by the pipeline (18.7f) and `npm run sim`.

import type { Build } from "@breadpilot/circuit-core";
import { electricalModel } from "./circuit";
import { checkClaims, type CheckedClaim, type Claim } from "./claims";
import { findings, type Finding } from "./findings";
import { runProgram, type SimResult } from "./run";
import { testRun, type TestRun } from "./scenario";

export interface BehaviourCheck {
  findings: Finding[];
  /** What wasn't tried or simulated (said, never silently passed). */
  notes: string[];
  /** The code's claims with whether each held (18.7g); [] when none were given. */
  claims: CheckedClaim[];
  result: SimResult;
  run: TestRun;
}

/** Other random seeds tried before a claim of a program that uses random counts as not held. */
const MORE_SEEDS = [2, 3, 4];
const usesRandom = (code: string) => /^\s*(import\s+(u?random|os)\b|from\s+(u?random|os)\s+import)/m.test(code);

export async function checkBehaviour(opts: { code: string; circuit: Build; files?: Record<string, string>; wallMs?: number; claims?: Claim[] }): Promise<BehaviourCheck> {
  const model = electricalModel(opts.circuit);
  const run = testRun(model);
  const result = await runProgram({ code: opts.code, files: opts.files ?? {}, circuit: opts.circuit, scenario: run.scenario, virtualSeconds: run.seconds, wallMs: opts.wallMs ?? 15_000 });
  const found = findings(result, model, run, opts.code);
  const claims = opts.claims ?? [];
  // Claims are checked only on a run that says something about them: not after a crash or a stuck
  // loop (that finding comes first), and not when the program waits for Wi-Fi.
  const why = found.findings.some((f) => f.code === "S001" || f.code === "S002") ? "the program didn't run through" : found.notes.some((n) => n.includes("Wi-Fi")) ? "the program uses Wi-Fi" : null;
  if (claims.length && why) return { ...found, notes: [...found.notes, `The code's claims weren't checked: ${why}.`], claims: claims.map((c) => ({ ...c, held: null })), result, run };
  let c = checkClaims(claims, result, model, run, opts.circuit);
  // A program that uses random may do what a claim says only on some rolls (a dice shows 1 on some
  // presses): a claim counts as not held only if it fails with every seed tried.
  if (c.findings.length && usesRandom(opts.code)) {
    const held = c.claims.map((x) => x.held);
    for (const seed of MORE_SEEDS) {
      if (!held.some((h) => h === false)) break;
      const again = await runProgram({ code: opts.code, files: opts.files ?? {}, circuit: opts.circuit, scenario: run.scenario, virtualSeconds: run.seconds, wallMs: opts.wallMs ?? 15_000, seed });
      const other = checkClaims(claims, again, model, run, opts.circuit);
      other.claims.forEach((x, i) => {
        if (x.held === true) held[i] = true;
      });
    }
    const failed = new Set(c.claims.flatMap((x, i) => (held[i] === false ? [`when ${x.when.trim()}, ${x.then.trim()}`] : [])));
    c = {
      findings: c.findings.filter((f) => [...failed].some((k) => f.message.includes(`"${k}"`))),
      notes: c.notes,
      claims: c.claims.map((x, i) => ({ ...x, held: held[i]! })),
    };
    c.notes.push(`The program uses random: a claim that didn't happen was tried again with other random numbers (up to ${MORE_SEEDS.length + 1} runs) and counts as held if it happened in any of them.`);
  }
  return { findings: [...found.findings, ...c.findings], notes: [...found.notes, ...c.notes], claims: c.claims, result, run };
}
