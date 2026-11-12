// M9 9.2: when a project changes, parts that stay keep their pins, holes, names and wire colours, so
// the user only redoes what changed. Every layout here must also pass the validator.
import { describe, expect, it } from "vitest";
import { layoutProject, stableRequests, type BlockRequest, type Layout, type PlacedBlock } from "../src/layout";
import { validateBuild } from "../src/validate";

/** Everything the user touched for one block: its block record, its parts and its wires. */
function footprint(l: Layout, b: PlacedBlock) {
  const mine = (label?: string) => !!label && b.refs.some((r) => label.startsWith(`${r}.`));
  const ends = (e: { kind: string; label?: string; row?: number; col?: string }) => JSON.stringify(e);
  return {
    block: b,
    parts: l.build.parts.filter((p) => b.refs.includes(p.ref)),
    wires: l.build.wires.filter((w) => mine(w.from.label) || mine(w.to.label)).map((w) => `${ends(w.from)} -> ${ends(w.to)} ${w.color}`).sort(),
  };
}
const byRef = (l: Layout, ref: string) => l.blocks.find((b) => b.ref === ref)!;
/** Lays out `after` on top of `before` the way a project change does. */
const change = (before: Layout, after: BlockRequest[], power: "rails" | "direct" = "rails") => {
  const next = layoutProject(stableRequests(before, after), undefined, { power, reservedRefs: before.build.parts.map((p) => p.ref) });
  expect(validateBuild(next.build).ok).toBe(true);
  return next;
};
const keptSame = (before: Layout, after: Layout, refs: string[]) => {
  for (const ref of refs) expect(footprint(after, byRef(after, ref)), ref).toEqual(footprint(before, byRef(before, ref)));
};

describe("stable layout (M9 9.2)", () => {
  it("adding a part: every old part stays exactly where it was; the new one goes below with new names", () => {
    const before = layoutProject([{ kind: "led" }, { kind: "button" }]);
    const after = change(before, [{ kind: "led" }, { kind: "button" }, { kind: "pot" }]);
    keptSame(before, after, ["LED1", "BTN1"]);
    const pot = byRef(after, "POT1");
    expect(pot.rows[0]).toBeGreaterThan(Math.max(...before.blocks.filter((b) => b.side === pot.side).map((b) => b.rows[1])));
    expect(after.blocks.map((b) => b.gpio)).toEqual([...before.blocks.map((b) => b.gpio), pot.gpio]);
  });

  it("removing a part from the middle: the others keep their places and names; its rows stay empty", () => {
    const before = layoutProject([{ kind: "led", props: { color: "red" } }, { kind: "led", props: { color: "green" } }, { kind: "button" }]);
    // The plan drops the red LED (the first one): the green one must not slide into the red one's place.
    const after = change(before, [{ kind: "led", props: { color: "green" } }, { kind: "button" }]);
    keptSame(before, after, ["LED2", "BTN1"]);
    expect(after.blocks.map((b) => b.ref).sort()).toEqual(["BTN1", "LED2"]);
    const red = byRef(before, "LED1");
    expect(after.build.parts.some((p) => Object.values(p.legs).some((h) => Number(/^\d+/.exec(h)![0]) >= red.rows[0] && Number(/^\d+/.exec(h)![0]) <= red.rows[1] && (red.side === "R" ? /[f-j]$/ : /[a-e]$/).test(h)))).toBe(false);
  });

  it("changing a part's setting (LED colour): same place, pins, names and wires; only the setting changes", () => {
    const before = layoutProject([{ kind: "led", props: { color: "red" } }, { kind: "button" }]);
    const after = change(before, [{ kind: "led", props: { color: "blue" } }, { kind: "button" }]);
    const [b, a] = [footprint(before, byRef(before, "LED1")), footprint(after, byRef(after, "LED1"))];
    expect(a.block).toEqual(b.block);
    expect(a.wires).toEqual(b.wires);
    expect(a.parts.find((p) => p.ref === "LED1")!.props!.color).toBe("blue");
    keptSame(before, after, ["BTN1"]);
  });

  it("asking for another pin moves only that part (placed fresh); the rest stays", () => {
    const before = layoutProject([{ kind: "led" }, { kind: "button" }]);
    const after = change(before, [{ kind: "led", pin: "GP2" }, { kind: "button" }]);
    keptSame(before, after, ["BTN1"]);
    const led = after.blocks.find((b) => b.kind === "led")!;
    expect(led.gpio).toBe("GP2");
    expect(led.ref).toBe("LED2"); // a new part: the old LED1 is removed and its name isn't reused
  });

  it("a display keeps its I2C pins, bus and rows when a part is added; two LEDs keep their wire colours", () => {
    const before = layoutProject([{ kind: "oled" }, { kind: "led" }, { kind: "led" }]);
    const after = change(before, [{ kind: "oled" }, { kind: "led" }, { kind: "led" }, { kind: "button" }]);
    keptSame(before, after, ["OLED1", "LED1", "LED2"]);
    // The new part's signal wire gets a colour no wire on the board uses (the display's are fixed by its part file).
    const kept = new Set(before.build.wires.map((w) => w.color));
    const btn = footprint(after, byRef(after, "BTN1")).wires.filter((w) => w.includes('"kind":"pico"') && !/GND|3V3/.test(w));
    expect(btn.length).toBeGreaterThan(0);
    for (const w of btn) expect(kept.has(w.split(" ").at(-1)!)).toBe(false);
  });

  it("with nothing kept (a new project) the layout is exactly today's", () => {
    const reqs: BlockRequest[] = [{ kind: "oled" }, { kind: "led" }, { kind: "button" }, { kind: "pot" }];
    const empty = layoutProject([]);
    expect(layoutProject(stableRequests(empty, reqs))).toEqual(layoutProject(reqs));
    // and changing nothing keeps everything, wires included
    const before = layoutProject(reqs);
    expect(change(before, reqs)).toEqual(before);
  });

  it("direct power: kept parts keep their GPIO and holes (their GND/3V3 wires may go to other Pico pins)", () => {
    const before = layoutProject([{ kind: "led" }, { kind: "pot" }], undefined, { power: "direct" });
    const after = change(before, [{ kind: "led" }, { kind: "pot" }, { kind: "button" }], "direct");
    for (const ref of ["LED1", "POT1"]) {
      expect(byRef(after, ref)).toEqual(byRef(before, ref));
      expect(footprint(after, byRef(after, ref)).parts).toEqual(footprint(before, byRef(before, ref)).parts);
    }
  });

  it("a kept part without its pin, or off the board, is refused", () => {
    const before = layoutProject([{ kind: "led" }]);
    const kept = stableRequests(before, [{ kind: "led" }])[0]!;
    expect(() => layoutProject([{ ...kept, pin: undefined }])).toThrow(/needs its old pin/);
    expect(() => layoutProject([{ ...kept, place: { ...kept.place!, rows: [70, 74] } }])).toThrow(/doesn't fit/);
  });
});
