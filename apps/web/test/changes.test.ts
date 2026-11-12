// M9 9.5: the app's side of project changes (pure parts).
import { describe, expect, it } from "vitest";
import { partsChange } from "../src/projects/changes";
import type { ApiProject, PlanPart, PlanVersion, ProjectVersion } from "../src/projects/types";
import { editKey } from "../src/steps/codeEdits";
import { viewedVersion } from "../src/store";
import { planPartName } from "../src/ui/StageOverlay";
import { versionLabel } from "../src/ui/VersionMenu";

const plan = (parts: PlanPart[]): PlanVersion => ({ title: "t", goal: "g", behavior: [], parts, questions: [], version: 1, approved: true });
const name = (p: PlanPart) => planPartName(p).name;

describe("what a change does to the parts (approval card)", () => {
  it("adds a knob: one added, the rest kept", () => {
    const before = plan([{ kind: "led", purpose: "light", color: "red" }, { kind: "button", purpose: "switch" }]);
    const after = plan([...before.parts, { kind: "pot", purpose: "speed" }]);
    const d = partsChange(before, after, name);
    expect(d.added).toHaveLength(1);
    expect(d.added[0]).toMatch(/knob|potentiometer/i);
    expect(d).toMatchObject({ removed: [], changed: [], kept: 2 });
  });

  it("removes a part, and a colour change is shown as a change (not remove + add)", () => {
    const before = plan([{ kind: "led", purpose: "a", color: "red" }, { kind: "led", purpose: "b", color: "green" }, { kind: "button", purpose: "s" }]);
    expect(partsChange(before, plan([before.parts[1]!, before.parts[2]!]), name)).toMatchObject({ added: [], changed: [], kept: 2, removed: [name(before.parts[0]!)] });
    const blue = partsChange(before, plan([{ kind: "led", purpose: "a", color: "blue" }, before.parts[1]!, before.parts[2]!]), name);
    expect(blue).toMatchObject({ added: [], removed: [], kept: 2 });
    expect(blue.changed).toEqual([`${name(before.parts[0]!)} → ${name({ kind: "led", purpose: "a", color: "blue" })}`]);
  });

  it("a pin the user asks for is part of the name", () => {
    const before = plan([{ kind: "led", purpose: "a" }]);
    const d = partsChange(before, plan([{ kind: "led", purpose: "a", pin: "GP2" }]), name);
    expect(d.changed).toEqual([`${name(before.parts[0]!)} → ${name(before.parts[0]!)} on GP2`]);
  });
});

describe("code edits are kept per version", () => {
  it("version 1 and older projects keep the project id (old edits are found); later versions get their own", () => {
    expect(editKey({ id: "p" })).toBe("p");
    expect(editKey({ id: "p", versions: [{ n: 1 }] })).toBe("p");
    expect(editKey({ id: "p", versions: [{ n: 1 }, { n: 2 }] })).toBe("p@v2");
    expect(editKey({ id: "p", versions: [{ n: 1 }, { n: 2 }], currentVersion: 1 })).toBe("p"); // restored: version 1's edits
  });
});

describe("versions in the app", () => {
  const v = (n: number, extra: Partial<ProjectVersion> = {}): ProjectVersion => ({ n, llm: "local", planVersion: n, state: "READY", createdAt: "2026-11-11T10:00:00Z", build: { build: { boardId: "pico-2-w", parts: [], wires: [], gpioModes: {} }, steps: [], codeAttempts: 1, citations: [] }, ...extra });
  const p = { versions: [v(1), v(2, { request: "make it blink" }), v(3, { restoredFrom: 1 })] } as ApiProject;

  it("only an older version with a build can be viewed (not the current one, not a missing one)", () => {
    expect(viewedVersion(p, null)).toBeNull();
    expect(viewedVersion(p, 2)!.n).toBe(2);
    expect(viewedVersion(p, 3)).toBeNull();
    expect(viewedVersion(p, 9)).toBeNull();
    expect(viewedVersion({ versions: [v(1, { build: undefined }), v(2)] } as ApiProject, 1)).toBeNull();
  });

  it("labels say what each version was, and which version a change was made from when it's not the one before", () => {
    expect(p.versions!.map(versionLabel)).toEqual(["the first version", "“make it blink”", "restored from version 1"]);
    expect(versionLabel(v(3, { request: "add a red light", parent: 1 }))).toBe("“add a red light” (from version 1)");
    expect(versionLabel(v(2, { request: "add a red light", parent: 1 }))).toBe("“add a red light”");
  });

  it("after a restore, the restored version is current: it can't be viewed as 'other', the newest can", () => {
    const restored = { versions: [v(1), v(2, { request: "make it blink", parent: 1 })], currentVersion: 1 } as ApiProject;
    expect(viewedVersion(restored, 1)).toBeNull();
    expect(viewedVersion(restored, 2)!.n).toBe(2);
  });
});
