// Builds the model sheet (main.tsx) into apps/web/.model-sheet/index.html: one page with the script
// inside it, so it opens straight from disk (file://, or as a snapshot in a browser pane) without a
// server. Developer tool; never shipped.
import { build } from "esbuild";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const WEB = resolve(import.meta.dirname, "../..");
// MODEL_SHEET_OUT: another folder (a preview server that can't read this one may serve it from there).
const OUT = process.env.MODEL_SHEET_OUT ? resolve(process.env.MODEL_SHEET_OUT) : join(WEB, ".model-sheet");
await mkdir(OUT, { recursive: true });
await build({
  entryPoints: [join(import.meta.dirname, "main.tsx")],
  bundle: true,
  format: "iife",
  outfile: join(OUT, "sheet.js"),
  jsx: "automatic",
  minify: true,
  logLevel: "warning",
  define: { "process.env.NODE_ENV": '"production"' },
});
const script = (await readFile(join(OUT, "sheet.js"), "utf8")).replace(/<\/script/gi, "<\\/script");
await rm(join(OUT, "sheet.js"));
await writeFile(
  join(OUT, "index.html"),
  `<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><title>BreadPilot model sheet</title></head>
<body style="margin:0"><div id="root"></div><script>${script}</script></body></html>
`,
);
console.log(`model sheet: ${join(OUT, "index.html")}#kinds=<kind>[,<kind>…] or #model=<upcoming id>`);
