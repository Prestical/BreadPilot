import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { layoutProject } from "@breadpilot/circuit-core";
import { checkDraft, insertIndent, loadEdit, saveEdit } from "../src/steps/codeEdits";

const build = layoutProject([{ kind: "led" }, { kind: "button" }]).build; // GP16 LED, GP17 button
const GENERATED = "from machine import Pin\nimport time\n\nled = Pin(16, Pin.OUT)\nbutton = Pin(17, Pin.IN, Pin.PULL_UP)\n\nwhile True:\n    led.value(1 if button.value() == 0 else 0)\n    time.sleep(0.01)\n";

describe("user edits to main.py", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps an edit per project and forgets it when it equals the generated code", () => {
    expect(loadEdit("p1", GENERATED)).toBeNull();
    saveEdit("p1", GENERATED, GENERATED + "# mine\n");
    expect(loadEdit("p1", GENERATED)).toBe(GENERATED + "# mine\n");
    expect(loadEdit("p2", GENERATED)).toBeNull();
    saveEdit("p1", GENERATED, GENERATED);
    expect(store.size).toBe(0);
  });

  it("an edit saved for an older version of the code is dropped when it matches the new code", () => {
    saveEdit("p1", "old", "same");
    expect(loadEdit("p1", "same")).toBeNull();
  });

  it("works without storage (private mode)", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } });
    expect(loadEdit("p1", GENERATED)).toBeNull();
    expect(() => saveEdit("p1", GENERATED, "x")).not.toThrow();
  });
});

describe("live re-check of edited code", () => {
  it("the generated code passes; a pin the build doesn't wire is caught", () => {
    expect(checkDraft(GENERATED, build).ok).toBe(true);
    const bad = checkDraft(GENERATED.replace("Pin(16, Pin.OUT)", "Pin(15, Pin.OUT)"), build);
    expect(bad.ok).toBe(false);
    expect(bad.issues.map((i) => i.code)).toContain("C004");
  });

  it("a missing colon is a syntax problem with its line", () => {
    const r = checkDraft(GENERATED.replace("while True:", "while True"), build);
    expect(r.issues.find((i) => i.code === "C001")?.line).toBe(7);
  });
});

describe("Tab in the editor", () => {
  it("inserts 4 spaces at the cursor, replacing a selection", () => {
    expect(insertIndent("ab", 1, 1)).toEqual({ text: "a    b", cursor: 5 });
    expect(insertIndent("abcd", 1, 3)).toEqual({ text: "a    d", cursor: 5 });
  });
});

import { readFileSync } from "node:fs";

describe("stored check results can be out of date (found in the user's first UF2, 21/10/2026)", () => {
  it("unchanged code is re-checked with today's rules: the Wi-Fi scanner's stored 'ok' no longer holds", () => {
    // This code was stored with codeCheck.ok = true before the C013 row-layout checks existed,
    // so the Build for Pico button was enabled. The browser check now rejects it.
    const code = readFileSync(new URL("../../../packages/circuit-core/test/fixtures/wifi-scanner-llm-2.py", import.meta.url), "utf8");
    const scanner = layoutProject([{ kind: "oled" }, { kind: "button" }], undefined, { power: "direct" }).build;
    const r = checkDraft(code, scanner);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => `${i.code} ${i.line}`)).toEqual(["C013 46", "C013 46"]);
  });
});
