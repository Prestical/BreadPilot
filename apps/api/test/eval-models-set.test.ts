// The 50-idea model test set (data/eval/models.jsonl, PLAN §13.2): its shape, and that every idea is
// fair: the idea rules read exactly the expected parts, nothing unsupported or unclear, and the
// build fits the breadboard (in the default rails mode). The user runs it on each model later.
import { readFileSync } from "node:fs";
import { layoutProject } from "@breadpilot/circuit-core";
import { describe, expect, it } from "vitest";
import { analyzeIdea } from "../src/agent/requirements";

interface Case {
  difficulty: "easy" | "medium" | "hard";
  idea: string;
  expect: { clarity: "clear"; parts: Record<string, number> };
}

const cases: Case[] = readFileSync(new URL("../../../data/eval/models.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

describe("model test set", () => {
  it("has 50 ideas: 20 easy, 20 medium, 10 hard, all different", () => {
    expect(cases).toHaveLength(50);
    expect(cases.map((c) => c.difficulty).reduce((n, d) => ({ ...n, [d]: (n[d] ?? 0) + 1 }), {} as Record<string, number>)).toEqual({ easy: 20, medium: 20, hard: 10 });
    expect(new Set(cases.map((c) => c.idea.toLowerCase())).size).toBe(50);
    expect(cases.every((c) => c.expect.clarity === "clear")).toBe(true);
  });

  it.each(cases.map((c, i) => [i + 1, c] as const))("idea %i is read as its expected parts and fits the breadboard", (_n, c) => {
    const r = analyzeIdea(c.idea);
    expect(r.unsupported).toEqual([]);
    expect(r.ambiguous).toEqual([]);
    const read: Record<string, number> = {};
    for (const [kind, need] of Object.entries(r.parts)) read[kind] = need.exact ?? need.min;
    expect(read).toEqual(c.expect.parts);
    const requests = Object.entries(c.expect.parts).flatMap(([kind, n]) => Array.from({ length: n }, () => ({ kind })));
    expect(() => layoutProject(requests as never)).not.toThrow();
  });
});
