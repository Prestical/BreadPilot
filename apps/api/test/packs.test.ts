import { describe, expect, it } from "vitest";
import { PACKS } from "@breadpilot/circuit-core";
import { AGENT_PACKS, fill, joinList } from "../src/agent/packText";
import { PART_KINDS, PLAN_PROPS } from "../src/agent/schemas";
import { VOCABULARY_IDS } from "../src/agent/vocabulary";

describe("part packs in the agent", () => {
  it("every claimed vocabulary entry exists", () => {
    for (const p of PACKS) for (const c of p.agent?.words.claims ?? []) expect(VOCABULARY_IDS.has(c), `${p.meta.id} claims "${c}"`).toBe(true);
  });

  it("plan kinds and plan fields come from the packs", () => {
    expect(PART_KINDS).toEqual(AGENT_PACKS.map((p) => p.meta.kind));
    expect(PLAN_PROPS).toEqual({ color: ["red", "green", "yellow", "blue", "white"] });
  });

  it("fills placeholders and joins lists", () => {
    expect(fill("{a} and {b} {missing}", { a: 1, b: "x" })).toBe("1 and x {missing}");
    expect(joinList(["a"], "or")).toBe("a");
    expect(joinList(["a", "b", "c"], "and")).toBe("a, b and c");
  });
});
