// M9 9.4: steps for a change list only what changes, so the user doesn't rebuild the whole board.
import { describe, expect, it } from "vitest";
import { layoutProject, stableRequests, type BlockRequest, type Layout } from "../src/layout";
import { buildSteps, canonicalJson, changeSteps } from "../src/steps";

const change = (before: Layout, after: BlockRequest[]) =>
  layoutProject(stableRequests(before, after), undefined, { reservedRefs: before.build.parts.map((p) => p.ref) });
const kinds = (steps: ReturnType<typeof changeSteps>) => steps.map((s) => `${s.kind}${s.partRef ? ` ${s.partRef}` : ""}`);
const mentions = (steps: ReturnType<typeof changeSteps>, ref: string) => steps.some((s) => s.partRef === ref || s.text.includes(`${ref}.`) || s.text.includes(` ${ref} `) || s.dsl?.includes(`(${ref}.`));

describe("change steps (M9 9.4)", () => {
  it("no wiring change: no steps (only the code changed)", () => {
    const l = layoutProject([{ kind: "led" }, { kind: "button" }]);
    expect(changeSteps(l.build, l.build)).toEqual([]);
    expect(changeSteps(l.build, change(l, [{ kind: "led" }, { kind: "button" }]).build)).toEqual([]);
  });

  it("the same board with its object keys in another order (as Postgres JSONB returns it) is no change", () => {
    const l = layoutProject([{ kind: "oled" }, { kind: "pot" }, { kind: "led" }]);
    const shuffle = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(shuffle) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, shuffle(x)])) : v;
    const stored = shuffle(l.build) as typeof l.build;
    expect(JSON.stringify(stored)).not.toBe(JSON.stringify(l.build)); // really re-ordered
    expect(changeSteps(stored, l.build)).toEqual([]);
    expect(canonicalJson(stored)).toBe(canonicalJson(l.build));
  });

  it("adding a knob: unplug, place the knob, its wires, USB; nothing about the parts that stay", () => {
    const before = layoutProject([{ kind: "led" }, { kind: "button" }]);
    const after = change(before, [{ kind: "led" }, { kind: "button" }, { kind: "pot" }]);
    const steps = changeSteps(before.build, after.build);
    expect(steps[0]!.kind).toBe("unplug");
    expect(steps.at(-1)!.kind).toBe("usb");
    expect(steps.filter((s) => s.kind.startsWith("remove"))).toEqual([]);
    expect(kinds(steps).filter((k) => k.startsWith("place"))).toEqual(["place-part POT1"]);
    expect(steps.filter((s) => s.kind === "wire").every((s) => s.dsl!.includes("POT1.") || /RR\+|3V3/.test(s.dsl!))).toBe(true);
    for (const ref of ["LED1", "R1", "BTN1"]) expect(mentions(steps, ref), ref).toBe(false);
    expect(steps.map((s) => s.index)).toEqual(steps.map((_, i) => i));
  });

  it("the place and wire steps are exactly buildSteps' steps for the new board (same text, holes, why)", () => {
    const before = layoutProject([{ kind: "led" }]);
    const after = change(before, [{ kind: "led" }, { kind: "button" }]);
    const full = buildSteps(after.build);
    for (const s of changeSteps(before.build, after.build).filter((x) => x.kind === "place-part" || x.kind === "wire")) {
      const same = full.find((f) => f.kind === s.kind && f.partRef === s.partRef && f.wireIndex === s.wireIndex)!;
      expect({ ...s, index: 0 }).toEqual({ ...same, index: 0 });
    }
  });

  it("removing the red LED: take out its wires, then LED1 and its resistor; the green LED and button get no step", () => {
    const before = layoutProject([{ kind: "led", props: { color: "red" } }, { kind: "led", props: { color: "green" } }, { kind: "button" }]);
    const after = change(before, [{ kind: "led", props: { color: "green" } }, { kind: "button" }]);
    const steps = changeSteps(before.build, after.build);
    const k = kinds(steps);
    expect(k.slice(0, 1)).toEqual(["unplug"]);
    expect(k.filter((x) => x.startsWith("remove-part")).sort()).toEqual(["remove-part LED1", "remove-part R1"]);
    expect(k.lastIndexOf("remove-wire")).toBeLessThan(k.findIndex((x) => x.startsWith("remove-part"))); // wires out first
    expect(steps.filter((s) => s.kind === "remove-wire").every((s) => /LED1|R1/.test(s.dsl!))).toBe(true);
    expect(steps.find((s) => s.partRef === "LED1")!.why).toBe("The changed project doesn't use LED1 any more.");
    expect(steps.some((s) => s.kind === "place-part" || s.kind === "wire")).toBe(false);
    for (const ref of ["LED2", "BTN1"]) expect(mentions(steps, ref), ref).toBe(false);
  });

  it("changing the LED's colour: take it out and put the new one in the same holes; no wire steps", () => {
    const before = layoutProject([{ kind: "led", props: { color: "red" } }, { kind: "button" }]);
    const after = change(before, [{ kind: "led", props: { color: "blue" } }, { kind: "button" }]);
    const steps = changeSteps(before.build, after.build);
    expect(kinds(steps)).toEqual(["unplug", "remove-part LED1", "place-part LED1", "usb"]);
    expect(steps[1]!.why).toBe("LED1 changes: the next steps put it back in its new form or place.");
    expect(steps[1]!.focus.holes).toEqual(steps[2]!.focus.holes);
    expect(steps[1]!.text).toMatch(/^Pull .* LED1 out of holes \d+[a-j], \d+[a-j]\.$/);
  });

  it("removal steps describe where the old wire was, in plain words", () => {
    const before = layoutProject([{ kind: "led" }, { kind: "button" }]);
    const after = change(before, [{ kind: "button" }]);
    const wire = changeSteps(before.build, after.build).find((s) => s.kind === "remove-wire" && s.dsl!.includes("GP16"))!;
    expect(wire.title).toMatch(/^Remove the \w+ wire$/);
    expect(wire.text).toMatch(/^Unplug the \w+ wire that goes from .*GP16.* to .*, and put it aside\.$/);
    expect(wire.why).toMatch(/belonged to R1|belonged to LED1/);
  });
});
