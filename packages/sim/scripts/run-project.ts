// Runs a saved BreadPilot project in the behaviour simulator and prints what happened (M18 18.7):
// how the run ended (with the error and its line), what it printed, the LEDs and modules over time,
// and the OLED frames drawn as text pictures. For comparing a simulated run with the real Pico.
//
//   npm run sim -w @breadpilot/sim -- "OLED Runner Game"
//   npm run sim -w @breadpilot/sim -- "Stopwatch" --press BTN1@1-1.3 --seconds 5 --frames all
//   npm run sim -w @breadpilot/sim -- --list
//   npm run sim -w @breadpilot/sim -- --all
//
// Projects come from .local/saved-projects.json (written by .local/export-projects.mjs from the
// running app) or from a file the app exported (--file path/to/project.json).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { driversFor, type Build } from "@breadpilot/circuit-core";
import { checkBehaviour, runProgram, type Finding, type Scenario, type SimEvent } from "../src/index";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const HELP = `Runs a saved project in the behaviour simulator.

  npm run sim -w @breadpilot/sim -- <title or id> [options]
  npm run sim -w @breadpilot/sim -- --list
  npm run sim -w @breadpilot/sim -- --all

Options:
  --file <path>        a project file the app exported, or a list of projects
                       (default: .local/saved-projects.json)
  --seconds <n>        virtual seconds to run (default 10)
  --press REF@a-b      hold a button/switch closed from a to b seconds (repeatable), e.g. BTN1@1-1.3
  --knob REF@t=v       set a knob's position (0-1) at t seconds (repeatable), e.g. POT1@2=0.8
  --sense KEY@t=v      set what a sensor senses at t seconds (repeatable), e.g. DHT1.temperature@0=30
  --frames last|all|N  which OLED frames to draw (default last; N = the first N)
  --list               list the projects in the file
  --all                run the automatic test on every project and list the findings

Without --press/--knob/--sense it runs BreadPilot's automatic test (each button pressed, held and
pressed twice; each knob swept; each sensor changed) and prints the findings (S001-S005).`;

interface Project {
  id: string;
  title?: string;
  build?: { build: Build; code?: string };
}

export function load(file: string): Project[] {
  const data = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (Array.isArray(data)) return data as Project[];
  const d = data as { format?: string; project?: Project; projects?: Project[] };
  if (d.format === "breadpilot-project" && d.project) return [d.project];
  if (d.projects) return d.projects;
  return Object.values(data as Record<string, Project>);
}

export function parse(argv: string[]) {
  const opts = { query: "", file: `${ROOT}.local/saved-projects.json`, seconds: 0, manual: false, frames: "last", list: false, all: false, help: false, scenario: { switches: {}, pots: {}, sensors: {} } as Required<Scenario> };
  const timeline = (map: Record<string, [number, number][]>, key: string, t: number, v: number) => {
    (map[key] ??= []).push([Math.round(t * 1_000_000), v]);
    map[key]!.sort((a, b) => a[0] - b[0]);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = () => argv[++i] ?? "";
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--list") opts.list = true;
    else if (a === "--all") opts.all = true;
    else if (a === "--file") opts.file = next();
    else if (a === "--seconds") opts.seconds = Number(next());
    else if (a === "--frames") opts.frames = next();
    else if (a === "--press") {
      const m = /^([\w#]+)@([\d.]+)-([\d.]+)$/.exec(next());
      if (!m) throw new Error("--press looks like BTN1@1-1.3");
      opts.manual = true;
      timeline(opts.scenario.switches, m[1]!, Number(m[2]), 1);
      timeline(opts.scenario.switches, m[1]!, Number(m[3]), 0);
    } else if (a === "--knob" || a === "--sense") {
      const m = /^([\w.#]+)@([\d.]+)=(-?[\d.]+)$/.exec(next());
      if (!m) throw new Error(`${a} looks like ${a === "--knob" ? "POT1@2=0.8" : "DHT1.temperature@0=30"}`);
      opts.manual = true;
      timeline(a === "--knob" ? opts.scenario.pots : opts.scenario.sensors, m[1]!, Number(m[2]), Number(m[3]));
    } else opts.query = opts.query ? `${opts.query} ${a}` : a;
  }
  return opts;
}

/** A 128 x 64 MONO_VLSB frame as 32 text lines (two pixel rows per character: ▀ ▄ █). */
export function draw(b64: string): string {
  const buf = Buffer.from(b64, "base64");
  const px = (x: number, y: number) => ((buf[(y >> 3) * 128 + x]! >> (y & 7)) & 1) === 1;
  const lines = [`+${"-".repeat(128)}+`];
  for (let y = 0; y < 64; y += 2) {
    let line = "";
    for (let x = 0; x < 128; x++) line += px(x, y) ? (px(x, y + 1) ? "█" : "▀") : px(x, y + 1) ? "▄" : " ";
    lines.push(`|${line}|`);
  }
  lines.push(lines[0]!);
  return lines.join("\n");
}

const ms = (e: SimEvent) => `${(e.t / 1000).toFixed(0).padStart(6)} ms`;

async function main() {
  const opts = parse(process.argv.slice(2));
  if (opts.help || (!opts.query && !opts.list && !opts.all)) {
    console.log(HELP);
    return;
  }
  const projects = load(opts.file).filter((p) => p.build?.code);
  if (opts.list) {
    for (const p of projects) console.log(`${p.id.slice(0, 8)}  ${p.title ?? "(no title)"}`);
    return;
  }
  if (opts.all) {
    // Every project through the automatic test, as the pipeline runs it (18.7h): one line each, then
    // its findings and notes.
    let flagged = 0;
    for (const p of projects) {
      const build = p.build!.build;
      const files = Object.fromEntries(driversFor(build.parts.map((x) => x.type)).map((d) => [d.file, d.source]));
      const c = await checkBehaviour({ code: p.build!.code!, circuit: build, files });
      if (c.findings.length) flagged++;
      const codes = c.findings.map((f) => f.code).join(" ") || "no findings";
      console.log(`${p.id.slice(0, 8)}  ${(p.title ?? "").padEnd(32)} ${codes.padEnd(16)} ${(c.result.virtualMs / 1000).toFixed(1)} s in ${c.result.wallMs} ms (${c.result.ended})`);
      for (const f of c.findings) console.log(`          ${f.code} ${f.message}`);
      for (const n of c.notes) console.log(`          note: ${n}`);
    }
    console.log(`\n${flagged} of ${projects.length} projects have findings.`);
    return;
  }
  const q = opts.query.toLowerCase();
  const exact = projects.filter((p) => (p.title ?? "").toLowerCase() === q || p.id === opts.query);
  const found = exact.length ? exact : projects.filter((p) => (p.title ?? "").toLowerCase().includes(q) || p.id.startsWith(opts.query));
  if (found.length === 0) throw new Error(`No project with code matches "${opts.query}" (try --list).`);
  if (found.length > 1 && !exact.length) {
    console.log(`Several projects match "${opts.query}"; using the first. Use more of the title or the id:`);
    for (const p of found) console.log(`  ${p.id.slice(0, 8)}  ${p.title}`);
  }
  const p = found[0]!;
  const build = p.build!.build;
  const code = p.build!.code!;
  const files = Object.fromEntries(driversFor(build.parts.map((x) => x.type)).map((d) => [d.file, d.source]));
  let r;
  let check: { findings: Finding[]; notes: string[]; phases: string[] } | undefined;
  if (opts.manual) {
    r = await runProgram({ code, files, circuit: build, scenario: opts.scenario, virtualSeconds: opts.seconds || 10, wallMs: 8000 });
  } else {
    const c = await checkBehaviour({ code, circuit: build, files });
    r = c.result;
    check = { findings: c.findings, notes: c.notes, phases: c.run.phases.map((ph) => `${(ph.from / 1e6).toFixed(1)}-${(ph.to / 1e6).toFixed(1)} s  ${ph.label}`) };
  }
  const seconds = opts.manual ? opts.seconds || 10 : Math.round(r.virtualMs / 100) / 10;

  console.log(`\n${p.title} (${p.id.slice(0, 8)}): ${seconds} virtual seconds in ${r.wallMs} ms${opts.manual ? "" : " (automatic test run)"}`);
  const parts = build.parts.map((x) => x.ref).join(", ");
  console.log(`Parts: ${parts}`);
  const ended = { finished: "the program finished", "time limit": "still running at the time limit (normal for a main loop)", "wall limit": "STOPPED: it never gave time back (a loop without sleep?)", error: "CRASHED" }[r.ended] ?? r.ended;
  console.log(`Ended: ${ended}`);
  if (r.error) {
    const line = r.error.line ? code.split("\n")[r.error.line - 1]?.trim() : undefined;
    console.log(`  ${r.error.type}: ${r.error.message}`);
    if (r.error.line) console.log(`  main.py line ${r.error.line}: ${line}`);
    if (r.error.at) console.log(`  inside ${r.error.at.file} line ${r.error.at.line}`);
  }

  if (check) {
    console.log(`\nTest run:`);
    for (const ph of check.phases) console.log(`  ${ph}`);
    console.log(check.findings.length ? `\nFindings (${check.findings.length}):` : `\nFindings: none.`);
    for (const f of check.findings) console.log(`  ${f.code} ${f.severity === "error" ? "ERROR  " : "warning"} ${f.message}`);
    for (const n of check.notes) console.log(`  note: ${n}`);
  }
  const notes = [...new Set(r.events.filter((e) => e.kind === "unsimulated").map((e) => String(e.a)))];
  if (notes.length && !check) console.log(`Not simulated: ${notes.join(", ")}`);
  const floating = r.events.filter((e) => e.kind === "floating").map((e) => `GP${e.a}`);
  if (floating.length) console.log(`Floating inputs (wired to nothing, no pull): ${floating.join(", ")}`);

  if (r.prints.length) {
    console.log(`\nPrinted (${r.prints.length} lines${r.prints.length > 20 ? ", first 20" : ""}):`);
    for (const line of r.prints.slice(0, 20)) console.log(`  ${line}`);
  }
  const shown = r.events.filter((e) => e.kind === "led" || e.kind === "actuator");
  if (shown.length) {
    console.log(`\nLEDs and modules (${shown.length} changes${shown.length > 30 ? ", first 30" : ""}):`);
    for (const e of shown.slice(0, 30)) {
      console.log(e.kind === "led" ? `  ${ms(e)}  ${e.a} ${Number(e.b) > 0 ? `on, ${e.b} mA` : "off"}` : `  ${ms(e)}  ${e.a} ${Number(e.b) > 0 ? `on${Number(e.c) ? `, ${e.c} Hz` : ""}` : "off"}`);
    }
  }
  const frames = r.events.filter((e) => e.kind === "frame");
  if (frames.length) {
    const pick = opts.frames === "all" ? frames : opts.frames === "last" ? frames.slice(-1) : frames.slice(0, Number(opts.frames) || 1);
    console.log(`\nDisplay: ${frames.length} different frames; showing ${opts.frames === "last" ? "the last" : pick.length}:`);
    for (const f of pick) console.log(`\n${String(f.a)} at ${ms(f).trim()}:\n${draw(String(f.b))}`);
  }
  console.log("");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: Error) => {
    console.error(err.message);
    process.exit(1);
  });
}
