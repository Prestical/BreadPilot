// Each part pack's own tests (parts/<id>/tests/): good and bad wirings for the validator and the
// build steps, good and bad programs for the code checker. Written as data in the pack, run here,
// so a new part brings its tests without editing this file.
//
// tests/wirings.json: { "cases": [ { name, layout: BlockRequest[], power?: "rails" | "direct" | "both",
//   rewire?: { "<REF.leg>": "<DSL line>" }, removeWires?: ["<REF.leg>"], swapLegs?: ["<REF>"],
//   modes?: { "GP16": "<mode>" | null }, expect: ["<codes>"] } ] }
//   expect = every issue code (errors and warnings), sorted; [] = clean, and the build steps must work.
// tests/code.json: { "cases": [ { name, file: "code/x.py", layout, errors: ["<codes>"], warnings?: [...] } ] }
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PARTS_DIR } from "../scripts/gen-parts";
import { PICO_2_W } from "../src/board";
import { checkMicroPython } from "../src/codecheck";
import { parseConnections } from "../src/dsl";
import { layoutProject, type BlockRequest, type PowerMode } from "../src/layout";
import { PACKS } from "../src/packs";
import { buildSteps } from "../src/steps";
import type { Build, GpioMode } from "../src/types";
import { validateBuild } from "../src/validate";

interface WiringCase {
  name: string;
  layout: BlockRequest[];
  power?: PowerMode | "both";
  rewire?: Record<string, string>;
  removeWires?: string[];
  swapLegs?: string[];
  modes?: Record<string, GpioMode | null>;
  expect: string[];
}
interface CodeCase {
  name: string;
  file: string;
  layout: BlockRequest[];
  errors: string[];
  warnings?: string[];
}

const touches = (w: Build["wires"][number], leg: string) => [w.from, w.to].some((e) => e.kind === "hole" && e.label === leg);

function edited(c: WiringCase, power: PowerMode): Build {
  const b = structuredClone(layoutProject(c.layout, PICO_2_W, { power }).build);
  for (const leg of c.removeWires ?? []) {
    if (!b.wires.some((w) => touches(w, leg))) throw new Error(`${c.name}: no wire ends on ${leg}`);
    b.wires = b.wires.filter((w) => !touches(w, leg));
  }
  for (const [leg, dsl] of Object.entries(c.rewire ?? {})) {
    const parsed = parseConnections(dsl);
    if (parsed.errors.length) throw new Error(`${c.name}: ${parsed.errors[0]!.message}`);
    if (!b.wires.some((w) => touches(w, leg))) throw new Error(`${c.name}: no wire ends on ${leg}`);
    b.wires = [...b.wires.filter((w) => !touches(w, leg)), ...parsed.wires];
  }
  for (const ref of c.swapLegs ?? []) {
    const p = b.parts.find((x) => x.ref === ref);
    if (!p) throw new Error(`${c.name}: no part ${ref}`);
    const [x, y] = Object.keys(p.legs);
    [p.legs[x!], p.legs[y!]] = [p.legs[y!]!, p.legs[x!]!];
    // The wires' labels follow the legs (a wire to "LED1.cathode" now reaches the anode's row).
    for (const w of b.wires) for (const e of [w.from, w.to]) if (e.kind === "hole" && e.label) e.label = e.label === `${ref}.${x}` ? `${ref}.${y}` : e.label === `${ref}.${y}` ? `${ref}.${x}` : e.label;
  }
  for (const [pin, mode] of Object.entries(c.modes ?? {})) {
    if (mode === null) delete b.gpioModes[pin];
    else b.gpioModes[pin] = mode;
  }
  return b;
}

const read = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const packDirs = PACKS.map((p) => p.meta.id);

describe("part pack tests (parts/*/tests)", () => {
  it("every part the AI can pick has good and bad wirings and programs", () => {
    for (const p of PACKS.filter((x) => x.meta.kind)) {
      const dir = join(PARTS_DIR, p.meta.id, "tests");
      expect(existsSync(join(dir, "wirings.json")), `${p.meta.id}: tests/wirings.json`).toBe(true);
      expect(existsSync(join(dir, "code.json")), `${p.meta.id}: tests/code.json`).toBe(true);
      const w = read<{ cases: WiringCase[] }>(join(dir, "wirings.json")).cases;
      const c = read<{ cases: CodeCase[] }>(join(dir, "code.json")).cases;
      expect(w.some((x) => !x.expect.length) && w.some((x) => x.expect.some((code) => code.startsWith("E"))), `${p.meta.id}: a clean wiring and one with an error`).toBe(true);
      expect(c.some((x) => !x.errors.length) && c.some((x) => x.errors.length), `${p.meta.id}: a passing program and a failing one`).toBe(true);
    }
  });

  for (const id of packDirs) {
    const dir = join(PARTS_DIR, id, "tests");
    if (existsSync(join(dir, "wirings.json"))) {
      describe(`${id}: wirings`, () => {
        for (const c of read<{ cases: WiringCase[] }>(join(dir, "wirings.json")).cases) {
          const modes: PowerMode[] = c.power === "both" || c.power === undefined ? ["rails", "direct"] : [c.power];
          for (const power of modes) {
            it(`${c.name} (${power})`, () => {
              const b = edited(c, power);
              const report = validateBuild(b);
              expect(report.issues.map((i) => i.code).sort()).toEqual([...c.expect].sort());
              if (report.ok) expect(buildSteps(b).at(-1)!.kind).toBe("usb");
            });
          }
        }
      });
    }
    if (existsSync(join(dir, "code.json"))) {
      describe(`${id}: programs`, () => {
        for (const c of read<{ cases: CodeCase[] }>(join(dir, "code.json")).cases) {
          it(c.name, () => {
            const build = layoutProject(c.layout, PICO_2_W).build;
            const report = checkMicroPython(readFileSync(join(dir, c.file), "utf8"), build, PICO_2_W);
            const codes = (sev: string) => [...new Set(report.issues.filter((i) => i.severity === sev).map((i) => i.code))].sort();
            expect(codes("error"), report.issues.map((i) => i.message).join("\n")).toEqual([...c.errors].sort());
            if (c.warnings) expect(codes("warning")).toEqual([...c.warnings].sort());
          });
        }
      });
    }
  }

  it("no stray test folders (a tests/ folder without a pack)", () => {
    const dirs = readdirSync(PARTS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    for (const d of dirs) if (existsSync(join(PARTS_DIR, d, "tests"))) expect(packDirs, d).toContain(d);
  });
});
