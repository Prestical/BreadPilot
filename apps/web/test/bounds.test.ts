// Parts placed next to each other must not go through each other (user, 18/11/2026: in a plant
// station the water sensor's board went through the buzzer module). The layout keeps bodies apart
// with each pack's `reach`; these tests measure the real 3D models.
import { describe, expect, it } from "vitest";
import { layoutProject, PACKS, resolveBuild, type BlockRequest, type PowerMode } from "@breadpilot/circuit-core";
import { overlap, shapeBounds, type Box3 } from "../src/scene/bounds";
import { PITCH, rowZ } from "../src/scene/coords";
import { partShapes } from "../src/scene/shapes";

const KINDS = PACKS.filter((p) => p.meta.kind && p.agent).map((p) => p.meta.kind!);

/** Each block's body box (its parts' meshes, without legs), in a laid-out project. */
function blockBoxes(requests: BlockRequest[], power: PowerMode = "rails") {
  const lay = layoutProject(requests, undefined, { power });
  const parts = resolveBuild(lay.build).resolved!.parts;
  return lay.blocks.map((b) => {
    let box: Box3 | null = null;
    for (const ref of b.refs) {
      const bx = shapeBounds(partShapes(parts.find((p) => p.ref === ref)!, "done"))!;
      box = box ? { min: box.min.map((v, i) => Math.min(v, bx.min[i]!)) as Box3["min"], max: box.max.map((v, i) => Math.max(v, bx.max[i]!)) as Box3["max"] } : bx;
    }
    return { block: b, box: box! };
  });
}

/** Pairs of blocks whose bodies overlap by more than a hair (0.05 mm on every axis). */
function collisions(requests: BlockRequest[], power: PowerMode = "rails"): string[] {
  const boxes = blockBoxes(requests, power);
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const o = overlap(boxes[i]!.box, boxes[j]!.box);
      if (o.every((v) => v > 0.05)) out.push(`${boxes[i]!.block.ref} × ${boxes[j]!.block.ref}`);
    }
  return out;
}

describe("part bodies don't go through each other", () => {
  it("every pack's reach covers how far its 3D body goes past its rows", () => {
    for (const kind of KINDS) {
      const { block, box } = blockBoxes([{ kind }])[0]!;
      const reach = PACKS.find((p) => p.meta.kind === kind)!.layout!.reach ?? [0, 0];
      const above = (rowZ(block.rows[0]) - box.min[2]) / PITCH;
      const below = (box.max[2] - rowZ(block.rows[1])) / PITCH;
      expect(above, `${kind} before its first row`).toBeLessThanOrEqual(reach[0]);
      expect(below, `${kind} after its last row`).toBeLessThanOrEqual(reach[1]);
    }
  });

  it("no part reaches over the Pico's board", () => {
    for (const kind of KINDS) {
      const { box } = blockBoxes([{ kind }])[0]!;
      expect(box.min[2], kind).toBeGreaterThan(rowZ(20.5));
    }
  });

  it("any two parts, in either order and both power modes", () => {
    const bad: string[] = [];
    for (const a of KINDS)
      for (const b of KINDS)
        for (const power of ["rails", "direct"] as PowerMode[]) {
          let found: string[];
          try {
            found = collisions([{ kind: a }, { kind: b }], power);
          } catch {
            continue; // can't be laid out together (e.g. limits): nothing to draw
          }
          if (found.length) bad.push(`${a} + ${b} (${power}): ${found.join(", ")}`);
        }
    expect(bad).toEqual([]);
  });

  it("the plant station and the night guard (user's projects, 18/11/2026)", () => {
    expect(collisions([{ kind: "dht22" }, { kind: "oled" }, { kind: "water-level" }, { kind: "buzzer" }])).toEqual([]);
    expect(collisions([{ kind: "ldr" }, { kind: "obstacle" }, { kind: "buzzer" }])).toEqual([]);
    expect(collisions([{ kind: "touch" }, { kind: "water-level" }, { kind: "sound-sensor" }, { kind: "flame" }])).toEqual([]);
  });
});
