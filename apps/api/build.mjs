// Bundles the API (and its CLIs) into dist/. Workspace packages (@breadpilot/*) are
// inlined because they ship as TypeScript source; npm dependencies stay external.
import { build } from "esbuild";
import { cpSync, readFileSync, rmSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith("@breadpilot/"));

await build({
  entryPoints: ["src/server.ts", "src/desktop.ts", "src/ingest-cli.ts", "src/eval-rag-cli.ts", "src/eval-agent-cli.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external,
});
// The behaviour simulator's worker thread and the files it loads at run time (plain JavaScript and
// MicroPython modules: not bundled, they run in their own thread / inside MicroPython).
const SIM = new URL("../../packages/sim/src/", import.meta.url);
rmSync(new URL("./dist/sim", import.meta.url), { recursive: true, force: true });
for (const f of ["worker.mjs", "core.mjs", "live.mjs", "solver.mjs", "chips.mjs", "py"]) cpSync(new URL(f, SIM), new URL(`./dist/sim/${f}`, import.meta.url), { recursive: true, filter: (src) => !/__pycache__|\.pyc$|\.d\.mts$/.test(src) });
console.log("api built → dist/server.js, dist/desktop.js + CLIs (ingest, eval-rag, eval-agent), dist/sim (behaviour simulator)");
