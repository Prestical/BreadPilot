// How well the behaviour claims catch broken code (M18 18.7h). For each project of an agent eval run
// whose final code has claims, the code is broken on purpose in a general way (the button test
// inverted, the knob reversed) and run again with the same claims: a broken program whose claims
// still all hold is a miss. Misses are expected where a claim is loose ("LED1 on" and "LED1 off" for
// a toggle) or where the change still makes a working program (a toggle on release).
//
//   npm run eval:mutants -w @breadpilot/sim -- ../../.local/eval-run.json

import { readFileSync } from "node:fs";
import { checkMicroPython, driversFor, getBoard, layoutProject, type BlockRequest, type Build } from "@breadpilot/circuit-core";
import { checkBehaviour, type Claim } from "../src/index";

const MUTANTS: [string, (c: string) => string][] = [
  ["button test inverted", (c) => c.replace(/\.value\(\)\s*==\s*0/g, ".value() == __ONE__").replace(/\.value\(\)\s*==\s*1/g, ".value() == 0").replace(/__ONE__/g, "1").replace(/\bnot (\w+)\.value\(\)/g, "$1.value()")],
  ["knob reversed", (c) => c.replace(/(\w+)\.read_u16\(\)/g, "(65535 - $1.read_u16())")],
];
const marks = (claims: { held: boolean | null }[]) => claims.map((x) => (x.held === true ? "✓" : x.held === false ? "✗" : "?")).join("");

interface Row {
  idea: string;
  parts: Record<string, number>;
  code?: string;
  build?: Build;
  simulator?: { attempts: { claims: Claim[] }[] };
}

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Give the eval's --json file.");
  const { results } = JSON.parse(readFileSync(file, "utf8")) as { results: Row[] };
  let tried = 0;
  let caught = 0;
  for (const [i, r] of results.entries()) {
    const claims = (r.simulator?.attempts.at(-1)?.claims ?? []).map(({ when, then }) => ({ when, then }));
    if (!claims.length || !r.code) continue;
    // Older eval files have no circuit: the engine layout from the parts, if it matches the code.
    const kinds = Object.entries(r.parts).flatMap(([kind, n]) => Array.from({ length: n }, () => ({ kind }) as BlockRequest));
    const build = r.build ?? layoutProject(kinds).build;
    if (!checkMicroPython(r.code, build, getBoard("pico-2-w")!).ok) {
      console.log(`${i + 1}. skipped: the circuit rebuilt from the parts doesn't match the code`);
      continue;
    }
    const files = Object.fromEntries(driversFor(build.parts.map((p) => p.type)).map((d) => [d.file, d.source]));
    const base = await checkBehaviour({ code: r.code, circuit: build, files, claims });
    const out = [`${i + 1}. ${r.idea.slice(0, 60)}`, `   original: ${base.findings.map((f) => f.code).join(" ") || "no findings"} [${marks(base.claims)}]`];
    for (const [name, mutate] of MUTANTS) {
      const code = mutate(r.code);
      if (code === r.code) continue;
      const c = await checkBehaviour({ code, circuit: build, files, claims });
      tried++;
      const hit = c.findings.some((f) => f.code === "S006");
      if (hit) caught++;
      out.push(`   ${name}: ${hit ? "caught" : "missed"} (${c.findings.map((f) => f.code).join(" ") || "no findings"}) [${marks(c.claims)}]`);
    }
    console.log(out.join("\n"));
  }
  console.log(`\nBroken programs caught by a claim (S006): ${caught} of ${tried}.`);
}

main().catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
