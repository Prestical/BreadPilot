// Developer tool, not part of the app (PLAN §13.2): compares the sizes built into
// data/models/ollama.json with what Ollama's registry says today, and prints every difference.
// The app itself never contacts ollama.com; these built-in values are what it shows.
//   npm run check:models -w @breadpilot/api               compare only (exit 1 on a difference or a missing tag)
//   npm run check:models -w @breadpilot/api -- --write    copy Ollama's numbers into the file
// Needs the internet.

import { readFileSync, writeFileSync } from "node:fs";
import { builtInFrom, CATALOG, formatBytes, formatCatalog, registryClient, tierOf, type BuiltInSizes } from "./models";

const FILE = new URL("../../../data/models/ollama.json", import.meta.url);
const write = process.argv.includes("--write");
const client = registryClient();
const fresh = new Map<string, BuiltInSizes>();
let missing = 0;
let changed = 0;

const describe = (o: BuiltInSizes) =>
  [
    `download ${formatBytes(o.downloadBytes)}`,
    `weights ${formatBytes(o.weightsBytes)}`,
    o.visionBytes ? `vision ${formatBytes(o.visionBytes)}` : null,
    o.draftBytes ? `draft ${formatBytes(o.draftBytes)}` : null,
    [o.parameters, o.quantization].filter(Boolean).join(" ") || null,
    tierOf(o.weightsBytes),
  ]
    .filter(Boolean)
    .join(" · ");

for (const m of CATALOG.models) {
  const info = await client.info(m.tag);
  if (!info.ok) {
    missing++;
    console.log(`✗ ${m.tag}: ${info.message}`);
    continue;
  }
  const now = builtInFrom(info);
  fresh.set(m.tag, now);
  const diffs = (Object.keys(now) as (keyof BuiltInSizes)[]).filter((k) => now[k] !== m.ollama[k]).map((k) => `${k} ${m.ollama[k]} → ${now[k]}`);
  if (diffs.length) {
    changed++;
    console.log(`≠ ${m.tag}: ${diffs.join(", ")}`);
  } else console.log(`✓ ${m.tag}${m.default ? " (default)" : ""}: ${describe(now)}`);
}

if (write && !missing) {
  // Only the "ollama" values and the date change; everything else in the file stays as written.
  const json = JSON.parse(readFileSync(FILE, "utf8")) as { sizesChecked: string; models: { tag: string; ollama: BuiltInSizes }[] };
  json.sizesChecked = new Date().toISOString().slice(0, 10);
  for (const m of json.models) m.ollama = fresh.get(m.tag)!;
  writeFileSync(FILE, formatCatalog(json as unknown as Parameters<typeof formatCatalog>[0]));
  console.log(`\nWrote Ollama's numbers for ${json.models.length} models (checked ${json.sizesChecked}). Review the diff, then run the tests.`);
} else if (write) console.log("\nNothing written: some models couldn't be read.");

console.log(
  missing || changed
    ? `\n${missing} missing, ${changed} different from the built-in values (of ${CATALOG.models.length}).${write ? "" : " Run with --write to update them."}`
    : `\nAll ${CATALOG.models.length} built-in values match ollama.com.`,
);
process.exit(missing || (changed && !write) ? 1 : 0);
