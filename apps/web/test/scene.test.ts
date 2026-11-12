import { describe, expect, it } from "vitest";
import { loadProject } from "../src/demos";
import { buildScene, clampPopup, keyPos, popupAnchor, POPUP } from "../src/scene/model";
import { changeSteps, layoutProject, resolveBuild, stableRequests } from "@breadpilot/circuit-core";
import { BOARD, holePos, PICO } from "../src/scene/coords";

describe("guided build scene", () => {
  const p = loadProject("led-button");
  const scene = (i: number) => buildScene(p.resolved, p.build.wires, p.steps, i, false);

  it("the hand-written LED + button build has 11 safe steps", () => {
    expect(p.steps).toHaveLength(11);
    expect(p.steps.at(-1)!.kind).toBe("usb");
  });

  it("shows the Pico as a ghost before its step, then solid", () => {
    expect(scene(0).pico).toBe("ghost");
    expect(scene(1).pico).toBe("done");
  });

  it("reveals parts and wires one step at a time", () => {
    const first = p.steps.findIndex((s) => s.kind === "wire");
    const s = scene(first);
    expect(s.parts.every((x) => x.state === "done")).toBe(true);
    expect(s.wires).toHaveLength(1);
    expect(s.wires[0]!.state).toBe("current");
    expect(scene(p.steps.length - 1).wires.every((w) => w.state === "done")).toBe(true);
    expect(scene(p.steps.length - 1).wires).toHaveLength(5);
  });

  it("highlights holes only for part and wire steps", () => {
    expect(scene(0).highlights).toEqual([]);
    const led = p.steps.find((s) => s.partRef === "LED1")!;
    expect(scene(led.index).highlights).toEqual(["27g", "28g"]);
  });

  it("puts wire ends exactly on hole positions", () => {
    const signal = p.steps.find((s) => s.dsl === "#21(GP16) -> #24j(R1.a)")!;
    const w = scene(signal.index).wires.find((x) => x.state === "current")!;
    expect(w.from).toEqual(holePos({ row: 20, col: "j" }));
    expect(w.to).toEqual(holePos({ row: 24, col: "j" }));
  });

  it("maps pin keys onto the Pico's pin positions", () => {
    expect(keyPos("pin:1")).toEqual(PICO.pinPos(1));
    expect(keyPos("pin:40")).toEqual(PICO.pinPos(40));
  });
});

describe("step pop-up anchor", () => {
  it("pins the card just past the board's right edge, level with the step (never over the board)", () => {
    expect(popupAnchor([[0, 0, 0], [10, 2, -4]])).toEqual([BOARD.maxX + 3, 3, -2]);
    expect(popupAnchor(null)).toBeNull();
    expect(popupAnchor([])).toBeNull();
  });

  it("every step of an example has an anchor (so the card always appears)", () => {
    const p = loadProject("led-button");
    for (let i = 0; i < p.steps.length; i++) expect(popupAnchor(buildScene(p.resolved, p.build.wires, p.steps, i, false).focus), `step ${i}`).not.toBeNull();
  });
});

describe("step pop-up stays inside the stage", () => {
  const size = { width: 1200, height: 900 };
  it("keeps a visible anchor where it is", () => {
    expect(clampPopup(500, 400, size)).toEqual([500, 400]);
  });
  it("pulls an off-screen anchor back to the right edge and clear of the tools and prompt", () => {
    expect(clampPopup(5000, -50, size)).toEqual([size.width - POPUP.width - POPUP.offset - POPUP.margin, POPUP.top]);
    expect(clampPopup(-80, 5000, size)).toEqual([POPUP.margin, size.height - POPUP.bottom]);
  });
  it("never returns NaN (camera not ready yet)", () => {
    expect(clampPopup(NaN, NaN, size).every(Number.isFinite)).toBe(true);
  });
});

describe("change steps in the 3D view (M9)", () => {
  it("parts and wires that stay are on the board from the start; the new part appears at its step", () => {
    const before = layoutProject([{ kind: "led" }]);
    const after = layoutProject(stableRequests(before, [{ kind: "led" }, { kind: "button" }]), undefined, { reservedRefs: before.build.parts.map((x) => x.ref) });
    const steps = changeSteps(before.build, after.build);
    const resolved = resolveBuild(after.build).resolved!;
    const at = (i: number) => buildScene(resolved, after.build.wires, steps, i, false);
    const refs = (i: number) => at(i).parts.map((x) => `${x.part.ref}:${x.state}`).sort();
    expect(refs(0)).toEqual(["LED1:done", "R1:done"]); // unplug step: the old board as it is
    const place = steps.findIndex((s) => s.kind === "place-part" && s.partRef === "BTN1");
    expect(refs(place)).toEqual(["BTN1:current", "LED1:done", "R1:done"]);
    expect(at(place).highlights.length).toBeGreaterThan(0);
    expect(at(0).pico).toBe("done");
  });
});

describe("parts and wires being removed in the 3D view (M9, the user's report 11/11/2026)", () => {
  it("are drawn from the old board until their removal step, highlighted at it, gone after it", () => {
    const before = layoutProject([{ kind: "led" }, { kind: "button" }]);
    const after = layoutProject(stableRequests(before, [{ kind: "button" }]), undefined, { reservedRefs: before.build.parts.map((x) => x.ref) });
    const steps = changeSteps(before.build, after.build);
    const resolved = resolveBuild(after.build).resolved!;
    const removed = { resolved: resolveBuild(before.build).resolved!, wires: before.build.wires };
    const at = (i: number) => buildScene(resolved, after.build.wires, steps, i, false, removed);
    const parts = (i: number) => at(i).parts.map((x) => `${x.key ?? x.part.ref}:${x.state}`).sort();
    const led = steps.findIndex((s) => s.kind === "remove-part" && s.partRef === "LED1");
    expect(parts(0)).toEqual(["BTN1:done", "old-LED1:done", "old-R1:done"]); // the board as it is
    expect(parts(led)).toContain("old-LED1:current");
    expect(parts(steps.length - 1)).toEqual(["BTN1:done"]); // taken out
    const firstWire = steps.findIndex((s) => s.kind === "remove-wire");
    const oldWires = (i: number) => at(i).wires.filter((w) => w.id.startsWith("old-")).length;
    expect(oldWires(0)).toBe(steps.filter((s) => s.kind === "remove-wire").length);
    expect(at(firstWire).wires.some((w) => w.id.startsWith("old-") && w.state === "current")).toBe(true);
    expect(oldWires(steps.length - 1)).toBe(0);
    // Without the old board (all steps view) nothing extra is drawn.
    expect(buildScene(resolved, after.build.wires, steps, 0, false).parts.map((x) => x.part.ref)).toEqual(["BTN1"]);
  });
});
