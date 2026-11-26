// The space a part's 3D model takes (an axis-aligned box in breadboard coordinates, mm), so tests can
// check that parts placed next to each other don't go through each other (user, 18/11/2026).
import type { Vec3 } from "./coords";
import type { Geometry, ShapeNode } from "./shapes";

export interface Box3 {
  min: Vec3;
  max: Vec3;
}

type Mat = number[]; // 3x3, row-major

const mul = (a: Mat, b: Mat): Mat => [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!));
const apply = (m: Mat, v: Vec3): Vec3 => [m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2], m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2], m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2]];
const I: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** three.js Euler "XYZ": R = Rx · Ry · Rz. */
function euler([x, y, z]: Vec3): Mat {
  const rx: Mat = [1, 0, 0, 0, Math.cos(x), -Math.sin(x), 0, Math.sin(x), Math.cos(x)];
  const ry: Mat = [Math.cos(y), 0, Math.sin(y), 0, 1, 0, -Math.sin(y), 0, Math.cos(y)];
  const rz: Mat = [Math.cos(z), -Math.sin(z), 0, Math.sin(z), Math.cos(z), 0, 0, 0, 1];
  return mul(mul(rx, ry), rz);
}

/** The geometry's own box, before any move or turn. */
function localBox(g: Geometry): Box3 {
  switch (g.type) {
    case "box":
    case "roundedBox": {
      const [w, h, d] = g.args;
      return { min: [-w / 2, -h / 2, -d / 2], max: [w / 2, h / 2, d / 2] };
    }
    case "cylinder": {
      const r = Math.max(g.args[0], g.args[1]);
      return { min: [-r, -g.args[2] / 2, -r], max: [r, g.args[2] / 2, r] };
    }
    case "sphere":
      return { min: [-g.args[0], -g.args[0], -g.args[0]], max: [g.args[0], g.args[0], g.args[0]] };
    case "capsule": {
      const [r, len] = g.args;
      return { min: [-r, -len / 2 - r, -r], max: [r, len / 2 + r, r] };
    }
    case "plane":
      return { min: [-g.args[0] / 2, -g.args[1] / 2, 0], max: [g.args[0] / 2, g.args[1] / 2, 0] };
    case "lathe": {
      const r = Math.max(...g.points.map((p) => p[0]));
      const ys = g.points.map((p) => p[1]);
      return { min: [-r, Math.min(...ys), -r], max: [r, Math.max(...ys), r] };
    }
  }
}

function grow(box: Box3 | null, p: Vec3): Box3 {
  if (!box) return { min: [...p], max: [...p] };
  return { min: [0, 1, 2].map((i) => Math.min(box.min[i]!, p[i]!)) as Vec3, max: [0, 1, 2].map((i) => Math.max(box.max[i]!, p[i]!)) as Vec3 };
}

/**
 * The box around every mesh of a shape tree. Legs (rods and leads) are left out by default: they
 * stand in the part's own holes, which the layout already keeps apart.
 */
export function shapeBounds(n: ShapeNode, opts: { legs?: boolean } = {}, rot: Mat = I, at: Vec3 = [0, 0, 0]): Box3 | null {
  if (n.node === "group") {
    const pos = apply(rot, n.position ?? [0, 0, 0]);
    const here: Vec3 = [at[0] + pos[0], at[1] + pos[1], at[2] + pos[2]];
    const r = n.rotation ? mul(rot, euler(n.rotation)) : rot;
    let box: Box3 | null = null;
    for (const c of n.children) {
      const b = shapeBounds(c, opts, r, here);
      if (b) box = grow(grow(box, b.min), b.max);
    }
    return box;
  }
  if (n.node === "mesh") {
    const pos = apply(rot, n.position ?? [0, 0, 0]);
    const r = n.rotation ? mul(rot, euler(n.rotation)) : rot;
    const l = localBox(n.geometry);
    let box: Box3 | null = null;
    for (const x of [l.min[0], l.max[0]]) for (const y of [l.min[1], l.max[1]]) for (const z of [l.min[2], l.max[2]]) {
      const p = apply(r, [x, y, z]);
      box = grow(box, [at[0] + pos[0] + p[0], at[1] + pos[1] + p[1], at[2] + pos[2] + p[2]]);
    }
    return box;
  }
  if (opts.legs && (n.node === "rod" || n.node === "lead")) {
    const pts = n.node === "rod" ? [n.from, n.to] : n.points;
    let box: Box3 | null = null;
    for (const p of pts) box = grow(box, [at[0] + p[0], at[1] + p[1], at[2] + p[2]]);
    return box;
  }
  return null;
}

/** How far two boxes go into each other along each axis (all three > 0 = they overlap). */
export function overlap(a: Box3, b: Box3): Vec3 {
  return [0, 1, 2].map((i) => Math.min(a.max[i]!, b.max[i]!) - Math.max(a.min[i]!, b.min[i]!)) as Vec3;
}
