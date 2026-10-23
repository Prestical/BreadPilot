import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { partsModule, PARTS_TS_PATH, readPacks } from "../scripts/gen-parts";
import { CATALOG } from "../src/catalog";
import { driversFor } from "../src/drivers";
import { loadPack, loadPacks, PackError, PACKS, unverifiedFacts, type PackSource } from "../src/packs";

const DOCS = fileURLToPath(new URL("../../../docs/hardware/", import.meta.url));
const docFiles = (dir = DOCS): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? docFiles(join(dir, d.name)) : [d.name]));

describe("part packs", () => {
  it("parts.generated.ts matches the parts/ folders", () => {
    expect(readFileSync(PARTS_TS_PATH, "utf8")).toBe(partsModule());
  });

  it("the 7 packs make up the catalog, with the OLED's driver", () => {
    expect(PACKS.map((p) => p.meta.id)).toEqual(["led-5mm", "button-6mm", "potentiometer", "oled-sh1106-i2c", "resistor", "dc-motor", "hc-sr04"]);
    for (const p of PACKS) expect(p.part, p.meta.id).toBe(CATALOG[p.meta.id]);
    expect(Object.keys(CATALOG).sort()).toEqual(PACKS.map((p) => p.meta.id).sort());
    expect(driversFor(["oled-sh1106-i2c"])[0]!.source).toBe(readFileSync(new URL("../../../parts/oled-sh1106-i2c/driver/sh1106.py", import.meta.url), "utf8"));
    expect(PACKS.map((p) => p.meta.kind).filter(Boolean)).toEqual(["led", "button", "pot", "oled"]);
  });

  it("every document a fact cites exists in docs/hardware/", () => {
    const files = new Set(docFiles());
    const cited = PACKS.flatMap((p) => p.facts.flatMap((f) => ("doc" in f.src ? [`${p.meta.id}: ${f.src.doc}`] : [])));
    expect(cited.length).toBeGreaterThan(0);
    for (const c of cited) expect(files.has(c.split(": ")[1]!), c).toBe(true);
  });

  it("facts without a datasheet are listed as unverified", () => {
    expect(Object.fromEntries(PACKS.map((p) => [p.meta.id, unverifiedFacts(p).map((f) => f.path)]))).toEqual({
      "led-5mm": ["part.specs.forwardVoltage", "part.specs.maxCurrentMa"],
      "button-6mm": [],
      potentiometer: [],
      "oled-sh1106-i2c": ["code.display.font"],
      resistor: [],
      "dc-motor": ["part.elements[0].currentMa", "part.specs.currentMa"],
      "hc-sr04": ["part.legs[0].voltageRange", "part.elements[0].currentMa", "part.specs.currentMa"],
    });
  });
});

describe("pack checks refuse bad packs with the exact field", () => {
  const good = (): PackSource => structuredClone(readPacks().find((p) => p.dir === "oled-sh1106-i2c")!) as PackSource;
  const refuse = (edit: (p: PackSource & { files: Record<string, any> }) => void, msg: RegExp) => {
    const p = good() as PackSource & { files: Record<string, any> };
    edit(p);
    expect(() => loadPack(p)).toThrow(PackError);
    expect(() => loadPack(p)).toThrow(msg);
  };

  it("the unchanged OLED pack loads", () => expect(loadPack(good()).meta.kind).toBe("oled"));
  it("a spec without a source", () => refuse((p) => (p.files["part.json"].specs.i2cMaxHz = 400000), /specs\.i2cMaxHz: must be an object/));
  it("a source of an unknown form", () => refuse((p) => (p.files["part.json"].specs.i2cMaxHz.src = { web: "somewhere" }), /i2cMaxHz\.src: doesn't match/));
  it("a supply limit without a source", () => refuse((p) => (p.files["part.json"].legs[0].maxSafeVoltage = 5), /legs\[0\]\.maxSafeVoltage/));
  it("an unknown field", () => refuse((p) => (p.files["part.json"].legs[0].ignoreSafety = true), /legs\[0\]\.ignoreSafety: unknown field/));
  it("an unknown leg kind", () => refuse((p) => (p.files["part.json"].legs[2].kind = "i2c_magic"), /legs\[2\]\.kind: must be one of/));
  it("an element on a missing leg", () => refuse((p) => (p.files["part.json"].elements[0].b = "nope"), /unknown leg/));
  it("an id that isn't the folder name", () => refuse((p) => (p.files["pack.json"].id = "oled-2"), /must be the folder name/));
  it("a driver that isn't plain ASCII", () => refuse((p) => (p.driver!.source += "# ünïcode\n"), /plain ASCII/));
  it("a missing driver", () => refuse((p) => delete p.driver, /missing driver file/));
  it("control characters in text", () => refuse((p) => (p.files["part.json"].name = "OLED\u0007"), /control characters/));
  it("an unknown pack file", () => refuse((p) => (p.files["extra.json"] = {}), /unknown pack file/));
  const refuseAll = (edit: (files: Record<string, any>) => void, msg: RegExp, dir = "led-5mm") => {
    const all = readPacks() as (PackSource & { files: Record<string, any> })[];
    edit(all.find((p) => p.dir === dir)!.files);
    expect(() => loadPacks(all)).toThrow(msg);
  };
  it("a pack with a kind but no layout", () => refuse((p) => delete p.files["layout.json"], /layout\.json: missing: a pack with a kind needs a layout/));
  it("a layout wire to a leg that doesn't exist", () => refuseAll((f) => (f["layout.json"].wires[1].ground[2] = "LED.middle"), /"LED\.middle" isn't a leg/));
  it("a layout part outside the block", () => refuseAll((f) => (f["layout.json"].parts[1].legs.cathode = [9, "g"]), /outside the block's height/));
  it("a layout that leaves a leg unplaced", () => refuseAll((f) => delete f["layout.json"].parts[1].legs.cathode, /must place exactly the legs anode, cathode/));
  it("a layout without the signal wire", () => refuseAll((f) => f["layout.json"].wires.shift(), /no wire from signal/));
  it("a layout with an unknown part type", () => refuseAll((f) => (f["layout.json"].parts[0].type = "resistor-x"), /unknown part "resistor-x"/));
  it("a layout pin without a mode", () => refuseAll((f) => delete f["layout.json"].pins.signal.mode, /pins\.signal\.mode: missing/));
  it("a layout limit without its reason", () => refuseAll((f) => delete f["layout.json"].maxMessage, /max and maxMessage go together/, "oled-sh1106-i2c"));
  it("code rules without the pack's driver", () => refuse((p) => {
    delete p.files["pack.json"].driver;
    delete p.driver;
  }, /code rules need the pack's driver/));
  it("a display size without a source", () => refuse((p) => (p.files["code.json"].display.width = 128), /display\.width: must be an object/));
  it("two packs with the same kind", () => {
    const a = good();
    const b = structuredClone(readPacks().find((p) => p.dir === "led-5mm")!) as PackSource & { files: Record<string, any> };
    b.files["pack.json"].kind = "oled";
    expect(() => loadPacks([a, b])).toThrow(/kind "oled" is also used by/);
  });
});

describe("the generator", () => {
  const dir = mkdtempSync(join(tmpdir(), "breadpilot-packs-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("leaves draft packs out unless asked", () => {
    const src = readPacks().find((p) => p.dir === "button-6mm")!;
    mkdirSync(join(dir, "button-6mm"));
    const meta = { ...(src.files["pack.json"] as object), review: { status: "draft", by: "datasheet drafter", date: "2026-10-23" } };
    writeFileSync(join(dir, "button-6mm", "pack.json"), JSON.stringify(meta));
    writeFileSync(join(dir, "button-6mm", "part.json"), JSON.stringify(src.files["part.json"]));
    expect(readPacks(dir)).toEqual([]);
    expect(readPacks(dir, { drafts: true }).map((p) => p.dir)).toEqual(["button-6mm"]);
  });

  it("names the file of broken JSON", () => {
    mkdirSync(join(dir, "broken"));
    writeFileSync(join(dir, "broken", "pack.json"), "{ nope");
    expect(() => readPacks(dir)).toThrow(/parts\/broken\/pack\.json: not valid JSON/);
    expect(existsSync(join(dir, "broken"))).toBe(true);
  });
});

describe("layout from packs", () => {
  it("an unknown plan kind is a layout error, not another part's template", async () => {
    const { layoutProject, LayoutError } = await import("../src/layout");
    expect(() => layoutProject([{ kind: "servo" }])).toThrow(LayoutError);
    expect(() => layoutProject([{ kind: "servo" }])).toThrow('Unknown part kind "servo".');
  });
});

describe("step texts from packs", () => {
  it("a valid build whose ADC wire misses the knob keeps the old wording (found while moving texts to packs)", async () => {
    const { layoutProject } = await import("../src/layout");
    const { buildSteps } = await import("../src/steps");
    const l = layoutProject([{ kind: "pot" }]);
    const b = structuredClone(l.build);
    const w = b.wires.find((x) => x.from.kind === "pico" && x.from.label === "GP26")!;
    b.wires[b.wires.indexOf(w)] = { ...w, to: { kind: "hole", row: 60, col: "j" } };
    expect(buildSteps(b).map((s) => s.why)).toContain("GP26 is an analog input (ADC): it measures the knob's middle-leg voltage and gives the code a number from 0 to 65535.");
  });

  it("a placeholder the engine doesn't fill is refused", () => {
    const all = readPacks() as (PackSource & { files: Record<string, any> })[];
    all.find((p) => p.dir === "led-5mm")!.files["text.json"].why = "{ref} glows {brightness}.";
    expect(() => loadPacks(all)).toThrow(/text\.json\.why: unknown placeholder \{brightness\}/);
  });
});
