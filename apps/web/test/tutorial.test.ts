import { describe, expect, it } from "vitest";
import { CHAPTERS } from "../src/tutorial/chapters";
import { checkClick, checkWire, lintChapter } from "../src/tutorial/engine";
import type { Target } from "../src/scene/targets";

const hole = (key: string): Target => ({ kind: "hole", key });
const chapter = (id: string) => CHAPTERS.find((c) => c.id === id)!;
const step = (id: string, i: number) => chapter(id).steps[i]!.expect;

describe("tutorial chapters", () => {
  it("has the 7 planned chapters", () => {
    expect(CHAPTERS.map((c) => c.id)).toEqual(["breadboard", "pin-numbers", "pin-names", "reading-lines", "parts", "safety", "practice"]);
  });

  it.each(CHAPTERS.map((c) => [c.id, c]))("%s is valid (targets exist, build is safe, hints present)", (_, c) => {
    expect(() => lintChapter(c)).not.toThrow();
  });
});

describe("click answers", () => {
  it("accepts any hole in the same strip as 30c, not across the channel", () => {
    const e = step("breadboard", 2);
    if (e.type !== "click") throw new Error();
    expect(checkClick(e, hole("30e")).ok).toBe(true);
    expect(checkClick(e, hole("30f")).ok).toBe(false);
    expect(checkClick(e, hole("30f")).message).toMatch(/same side of the channel/);
  });

  it("accepts any row of a rail", () => {
    const e = step("breadboard", 3);
    if (e.type !== "click") throw new Error();
    expect(checkClick(e, { kind: "rail", rail: "RR-", row: 50 }).ok).toBe(true);
    expect(checkClick(e, { kind: "rail", rail: "RR+", row: 50 }).ok).toBe(false);
  });

  it("knows pin 21 is GP16", () => {
    const e = step("pin-names", 1);
    if (e.type !== "click") throw new Error();
    expect(checkClick(e, { kind: "pin", phys: 21 }).ok).toBe(true);
    expect(checkClick(e, { kind: "pin", phys: 16 }).ok).toBe(false);
  });
});

describe("wire answers use the real validator", () => {
  it("safety chapter: 3V3 → GND is blocked with E001", () => {
    const e = step("safety", 1);
    if (e.type !== "wire") throw new Error();
    const r = checkWire(chapter("safety"), e, hole("5j"), hole("3j"));
    expect(r.ok).toBe(true);
    expect(r.issue?.code).toBe("E001");
    expect(r.dsl).toBe("#5j -> #3j");
  });

  it("practice chapter: GND → − rail passes, either click order", () => {
    const e = step("practice", 0);
    if (e.type !== "wire") throw new Error();
    expect(checkWire(chapter("practice"), e, hole("3j"), { kind: "rail", rail: "RR-", row: 9 }).ok).toBe(true);
    expect(checkWire(chapter("practice"), e, { kind: "rail", rail: "RR-", row: 9 }, { kind: "pin", phys: 38 }).ok).toBe(true);
  });

  it("practice chapter: a wire to the wrong place gets the hint", () => {
    const e = step("practice", 0);
    if (e.type !== "wire") throw new Error();
    const r = checkWire(chapter("practice"), e, hole("3j"), { kind: "rail", rail: "RR+", row: 9 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/different place/);
  });
});
