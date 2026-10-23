// Bundles the API (and its CLIs) into dist/. Workspace packages (@breadpilot/*) are
// inlined because they ship as TypeScript source; npm dependencies stay external.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const external = Object.keys(pkg.dependencies ?? {}).filter((d) => !d.startsWith("@breadpilot/"));

await build({
  entryPoints: ["src/server.ts", "src/ingest-cli.ts", "src/eval-rag-cli.ts", "src/eval-agent-cli.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  external,
});
console.log("api built → dist/server.js + CLIs (ingest, eval-rag, eval-agent)");
