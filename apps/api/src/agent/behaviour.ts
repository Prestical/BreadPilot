// M18 18.7f: the behaviour simulator as the pipeline uses it. The code runs on the build's circuit
// with the automatic test run, next to the drivers the build needs (sh1106.py …), and the result is
// kept small for the project (findings and notes, no trace or frames).

import { driversFor, type Build } from "@breadpilot/circuit-core";
import { checkBehaviour } from "@breadpilot/sim";
import type { BehaviourSummary } from "./project";

export async function behaviourCheck(code: string, build: Build, claims: { when: string; then: string }[] = []): Promise<Omit<BehaviourSummary, "ok">> {
  const files = Object.fromEntries(driversFor(build.parts.map((p) => p.type)).map((d) => [d.file, d.source]));
  const c = await checkBehaviour({ code, circuit: build, files, claims });
  return {
    findings: c.findings.map((f) => ({ code: f.code, severity: f.severity, message: f.message, ...(f.line ? { line: f.line } : {}), ...(f.ref ? { ref: f.ref } : {}) })),
    notes: c.notes,
    seconds: Math.round(c.result.virtualMs / 100) / 10,
    ended: c.result.ended,
    ...(c.claims.length ? { claims: c.claims } : {}),
  };
}
