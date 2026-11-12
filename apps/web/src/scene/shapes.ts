// What each part looks like in 3D, as plain data (no React, no three.js objects), so it can be
// tested and later read from part packs. Parts.tsx only turns these nodes into meshes.
// Sizes are millimetres (1 unit = 1 mm, see coords.ts).
import { packOfPart, resistorBands, type ResolvedPart, type ViewSpec } from "@breadpilot/circuit-core";
import { holePos, type Vec3 } from "./coords";

export type ItemState = "done" | "current" | "ghost";

/** Canvas text texture (labels.ts `labelTexture` arguments). */
export interface LabelSpec {
  text: string;
  bg: string;
  fg: string;
  width: number;
  height: number;
}

export type Geometry =
  | { type: "box"; args: [number, number, number] }
  /** Box with rounded edges: width, height, depth, edge radius. */
  | { type: "roundedBox"; args: [number, number, number, number] }
  | { type: "cylinder"; args: [number, number, number, number] }
  | { type: "sphere"; args: [number, number, number, number, number, number, number] }
  | { type: "capsule"; args: [number, number, number, number] }
  | { type: "plane"; args: [number, number] }
  /** A profile of [radius, y] points spun around the y axis; args = [segments around]. */
  | { type: "lathe"; args: [number]; points: [number, number][] };

export interface Material {
  kind: "standard" | "basic";
  color?: string;
  emissive?: string;
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  /** Faceted shading: shows the ribs of a knurled shaft. */
  flatShading?: boolean;
  transparent: boolean;
  opacity: number;
  map?: LabelSpec;
}

export type ShapeNode =
  | { node: "mesh"; geometry: Geometry; material: Material; position?: Vec3; rotation?: Vec3; pulse?: boolean; noRaycast?: boolean }
  | { node: "rod"; from: Vec3; to: Vec3; opacity: number }
  /** A bent metal lead: a round wire through `points`, its corners rounded with radius `bend`. */
  | { node: "lead"; points: Vec3[]; radius: number; bend: number; opacity: number }
  | { node: "light"; color: string; intensity: number; distance: number }
  | { node: "group"; position?: Vec3; rotation?: Vec3; hover?: boolean; children: ShapeNode[] };

const BAND_HEX: Record<string, string> = {
  black: "#111", brown: "#7a4a1d", red: "#d32020", orange: "#f07d12", yellow: "#f2d21b", green: "#2ca53b",
  blue: "#2457d6", violet: "#8a3fd1", grey: "#8c8c8c", white: "#f5f5f5", gold: "#c9a227",
};

const legsOf = (part: ResolvedPart) => Object.fromEntries(Object.entries(part.legs).map(([id, h]) => [id, holePos(h)])) as Record<string, Vec3>;
const mid = (pts: Vec3[]): Vec3 => pts.reduce<Vec3>((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]);
const group = (position: Vec3, children: ShapeNode[], extra: { rotation?: Vec3; hover?: boolean } = {}): ShapeNode => ({ node: "group", position, ...extra, children });
/** Turn (around y) that points a group's local +z from `a` toward `b`. */
const turnTo = (a: Vec3, b: Vec3) => Math.atan2(b[0] - a[0], b[2] - a[2]);
const fade = (state: ItemState) => (state === "ghost" ? 0.3 : 1);
/** A plain material in the part's opacity. */
const std = (color: string, opacity: number, extra: Partial<Material> = {}): Material => ({ kind: "standard", color, transparent: opacity < 1, opacity, ...extra });
const METAL = { metalness: 0.85, roughness: 0.3 };
const TIN = "#c3c8cf";

type Spec<S extends ViewSpec["shape"]> = Extract<ViewSpec, { shape: S }>;

/** The 3D nodes for one part in one state, from its pack's view.json; `lit` lights an LED. */
export function partShapes(part: ResolvedPart, state: ItemState, lit = false): ShapeNode {
  const view = packOfPart(part.def)?.view;
  switch (view?.shape) {
    case "led-dome":
      return led(part, state, lit, view);
    case "axial":
      return axial(part, state, view);
    case "tact-button":
      return button(part, state, view);
    case "rotary-knob":
      return knob(part, state, view);
    case "header-module":
      return headerModule(part, state, view);
    case "cylinder":
      return cylinder(part, state, view);
    case "slide-switch":
      return slideSwitch(part, state, view);
    case "upright-module":
      return uprightModule(part, state, view);
    case "grid-sensor":
      return gridSensor(part, state, view);
    default:
      return generic(part, state);
  }
}

/**
 * A 5 mm LED: the flange (rim) at the bottom, the straight epoxy body and its round dome as one
 * turned shape, and inside the clear epoxy the two metal pieces of a real LED: the big anvil with
 * the chip's cup on the cathode leg and the thin post on the anode leg.
 */
function led(part: ResolvedPart, state: ItemState, lit: boolean, v: Spec<"led-dome">): ShapeNode {
  const legs = legsOf(part);
  const anode = legs[v.legs[0]]!;
  const cathode = legs[v.legs[1]]!;
  // An unknown colour shows as the first one listed (red for the LED).
  const color = v.colors[String(part.props[v.colorProp])] ?? Object.values(v.colors)[0]!;
  const center = mid([anode, cathode]);
  const opacity = state === "ghost" ? 0.25 : 0.85;
  const rod = fade(state);
  const baseY = 4.2; // underside of the flange
  const R = 2.5;
  const straight = 5.1;
  const dome: [number, number][] = [[R, 0], [R, straight], ...Array.from({ length: 10 }, (_, i): [number, number] => {
    const a = ((i + 1) / 10) * (Math.PI / 2);
    return [Math.max(0, R * Math.cos(a)), straight + R * Math.sin(a)];
  })];
  const epoxy = { roughness: 0.18, transparent: true, opacity };
  const frame = std("#9aa0a8", opacity * 0.9, { ...METAL, transparent: true });
  return {
    node: "group",
    children: [
      { node: "rod", from: [anode[0], 0, anode[2]], to: [anode[0], baseY + 0.4, anode[2]], opacity: rod },
      { node: "rod", from: [cathode[0], 0, cathode[2]], to: [cathode[0], baseY + 0.4, cathode[2]], opacity: rod },
      group(
        [center[0], baseY, center[2]],
        [
          // flange (rim)
          { node: "mesh", position: [0, 0.5, 0], geometry: { type: "cylinder", args: [2.95, 2.95, 1, 32] }, material: { kind: "standard", color, ...epoxy } },
          // body and dome
          { node: "mesh", position: [0, 1, 0], geometry: { type: "lathe", args: [32], points: dome }, pulse: true, material: { kind: "standard", color, emissive: lit ? color : "#ffffff", emissiveIntensity: lit ? 2 : 0, ...epoxy } },
          // inside: anvil with the chip's cup (cathode side, local +z) and the post (anode side)
          { node: "mesh", position: [0, 2.6, 0.75], noRaycast: true, geometry: { type: "box", args: [0.5, 3.2, 1.7] }, material: frame },
          { node: "mesh", position: [0, 4.3, 0.35], noRaycast: true, geometry: { type: "cylinder", args: [0.95, 0.6, 0.6, 16] }, material: frame },
          { node: "mesh", position: [0, 2.5, -1], noRaycast: true, geometry: { type: "box", args: [0.5, 3, 0.6] }, material: frame },
          ...(lit ? [{ node: "light", color, intensity: 40, distance: 30 } as ShapeNode] : []),
        ],
        { rotation: [0, turnTo(anode, cathode), 0], hover: true },
      ),
    ],
  };
}

/**
 * A two-legged part lying flat between its legs, with colour bands from a prop (a resistor): the
 * "dog bone" body of a film resistor (thicker at both ends), and one wire bent down into both holes.
 */
function axial(part: ResolvedPart, state: ItemState, v: Spec<"axial">): ShapeNode {
  const legs = legsOf(part);
  const a = legs[v.legs[0]]!;
  const b = legs[v.legs[1]]!;
  const y = 1.9;
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const center = mid([a, b]);
  const L = Math.min(6.3, len * 0.75);
  const k = L / 6.3; // short spans get a shorter body with the same look
  const bands = resistorBands(Number(part.props[v.bandsProp]));
  const opacity = fade(state);
  const h = L / 2;
  const cap = 1.8 * k;
  // [radius, position along the body]: rounded end, thick cap, thinner waist, and back
  const half: [number, number][] = [[0, -h], [0.7, -h + 0.04], [1.08, -h + 0.3 * k], [1.2, -h + cap * 0.5], [1.14, -h + cap * 0.85], [0.98, -h + cap * 1.1], [0.95, -h + cap * 1.4]];
  const profile: [number, number][] = [...half, ...half.map(([r, p]): [number, number] => [r, -p]).reverse()];
  // The first band and the tolerance band sit on the thick ends, the others on the waist.
  const places = [-h + cap * 0.5, -0.8 * k, 0.15 * k, h - cap * 0.5];
  return {
    node: "group",
    children: [
      { node: "lead", points: [a, [a[0], y, a[2]], [b[0], y, b[2]], b], radius: 0.28, bend: 0.9, opacity },
      group(
        [center[0], y, center[2]],
        [
          { node: "mesh", rotation: [Math.PI / 2, 0, 0], geometry: { type: "lathe", args: [20], points: profile }, pulse: true, material: std(v.body, opacity, { emissive: "#ffffff", roughness: 0.55 }) },
          ...bands.map((band, i): ShapeNode => {
            const z = places[Math.min(i, places.length - 1)]!;
            const r = Math.abs(z) > h - cap ? 1.22 : 0.975;
            return { node: "mesh", rotation: [Math.PI / 2, 0, 0], position: [0, 0, z], geometry: { type: "cylinder", args: [r, r, 0.5 * k, 20] }, material: std(BAND_HEX[band]!, opacity, { roughness: 0.5 }) };
          }),
        ],
        { rotation: [0, turnTo(a, b), 0], hover: true },
      ),
    ],
  };
}

/**
 * A 6 mm tactile switch: black body, metal top plate bent down at the four sides, the four black
 * pegs that hold the plate, the round plunger, and four flat legs that come out of two sides and
 * bend down into their holes.
 */
function button(part: ResolvedPart, state: ItemState, v: Spec<"tact-button">): ShapeNode {
  const legs = legsOf(part);
  const pts = Object.values(legs);
  const center = mid(pts);
  const opacity = fade(state);
  const plate = v.plate ?? TIN;
  const metal = std(plate, opacity, METAL);
  // The legs leave the body on the two sides they are furthest from (across the channel).
  const acrossX = Math.max(...pts.map((p) => Math.abs(p[0] - center[0]))) >= Math.max(...pts.map((p) => Math.abs(p[2] - center[2])));
  return {
    node: "group",
    children: [
      ...pts.map((p): ShapeNode => {
        const inX = acrossX ? center[0] + Math.sign(p[0] - center[0]) * 2.8 : p[0];
        const inZ = acrossX ? p[2] : center[2] + Math.sign(p[2] - center[2]) * 2.8;
        return { node: "lead", points: [p, [p[0], 1.1, p[2]], [inX, 1.1, inZ]], radius: 0.3, bend: 0.5, opacity };
      }),
      group(
        [center[0], 0, center[2]],
        [
          { node: "mesh", position: [0, 2, 0], geometry: { type: "roundedBox", args: [6, 3.4, 6, 0.25] }, pulse: true, material: std(v.body, opacity, { emissive: "#ffffff", roughness: 0.6 }) },
          // metal plate on top, bent down at the four sides like the real part
          { node: "mesh", position: [0, 3.82, 0], geometry: { type: "box", args: [6.2, 0.25, 6.2] }, material: metal },
          ...([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).map(
            ([x, z]): ShapeNode => ({ node: "mesh", position: [x * 3.05, 3.1, z * 3.05], geometry: { type: "box", args: [x ? 0.2 : 2.2, 1.3, z ? 0.2 : 2.2] }, material: metal }),
          ),
          // the body's four pegs that come up through the plate's corners
          ...([[-1, -1], [-1, 1], [1, -1], [1, 1]] as const).map(
            ([x, z]): ShapeNode => ({ node: "mesh", position: [x * 2.25, 4.02, z * 2.25], noRaycast: true, geometry: { type: "cylinder", args: [0.45, 0.45, 0.2, 14] }, material: std("#111214", opacity, { roughness: 0.6 }) }),
          ),
          // plunger: a short collar and the round cap you press
          { node: "mesh", position: [0, 4.1, 0], geometry: { type: "cylinder", args: [1.9, 1.9, 0.4, 28] }, material: std(v.body, opacity, { roughness: 0.5 }) },
          { node: "mesh", position: [0, 4.85, 0], geometry: { type: "cylinder", args: [1.6, 1.7, 1.3, 28] }, material: std(v.cap, opacity, { roughness: 0.45 }) },
        ],
        { hover: true },
      ),
    ],
  };
}

/**
 * A panel potentiometer like the common 16 mm ones (scaled to sit on the board): the three legs in
 * their holes go up into a brown circuit-board tab with solder lugs; the round body sits beside it,
 * toward the channel (the wires use the holes on the outer side); on top a hex nut, a threaded
 * bushing and a ribbed metal shaft with its slot, plus the small anti-rotation pin.
 */
function knob(part: ResolvedPart, state: ItemState, v: Spec<"rotary-knob">): ShapeNode {
  const legs = legsOf(part);
  const pts = Object.values(legs);
  const center = mid(pts);
  const opacity = state === "ghost" ? 0.3 : 1;
  const t = opacity < 1;
  const inward = center[0] < 0 ? 1 : -1; // toward the centre channel
  const R = 5;
  const spanZ = Math.max(...pts.map((p) => p[2])) - Math.min(...pts.map((p) => p[2])) + 3.2;
  const metal = { kind: "standard" as const, color: v.knob, metalness: 0.9, roughness: 0.28, transparent: t, opacity };
  const tab = v.tab ?? "#8a4b23";
  return {
    node: "group",
    children: [
      ...pts.map((p): ShapeNode => ({ node: "rod", from: p, to: [p[0], 2.6, p[2]], opacity })),
      // brown circuit-board tab and its solder lugs, right over the legs
      { node: "mesh", position: [center[0] + inward * 1.6, 2.6, center[2]], noRaycast: true, geometry: { type: "box", args: [4.6, 1, spanZ] }, material: { kind: "standard", color: tab, roughness: 0.75, transparent: t, opacity } },
      ...pts.map((p): ShapeNode => ({ node: "mesh", position: [p[0], 3.2, p[2]], noRaycast: true, geometry: { type: "cylinder", args: [0.75, 0.75, 0.35, 14] }, material: metal })),
      group(
        [center[0] + inward * (R + 1.6), 0, center[2]],
        [
          { node: "mesh", position: [0, 4.2, 0], geometry: { type: "cylinder", args: [R, R, 3.8, 40] }, pulse: true, material: { kind: "standard", color: v.body, emissive: "#ffffff", metalness: 0.55, roughness: 0.35, transparent: t, opacity } },
          { node: "mesh", position: [0, 6.75, 0], geometry: { type: "cylinder", args: [3.6, 3.6, 1.3, 6] }, material: metal },
          { node: "mesh", position: [0, 8.75, 0], geometry: { type: "cylinder", args: [2.5, 2.5, 2.7, 24] }, material: metal },
          // thread ridges on the bushing
          ...[7.9, 8.6, 9.3].map((y): ShapeNode => ({ node: "mesh", position: [0, y, 0], noRaycast: true, geometry: { type: "cylinder", args: [2.68, 2.68, 0.22, 24] }, material: metal })),
          { node: "mesh", position: [0, 13.35, 0], geometry: { type: "cylinder", args: [1.8, 1.8, 6.5, 18] }, material: { ...metal, flatShading: true } },
          { node: "mesh", position: [0, 16.5, 0], noRaycast: true, geometry: { type: "box", args: [3.7, 0.5, 0.7] }, material: { kind: "standard", color: "#3a3d42", roughness: 0.8, transparent: t, opacity } },
          // anti-rotation pin beside the nut
          { node: "mesh", position: [0, 6.9, -4.1], geometry: { type: "box", args: [1, 1.8, 0.8] }, material: metal },
        ],
        { hover: true },
      ),
    ],
  };
}

/**
 * A module board standing on a pin header (e.g. the OLED): header pins in the build's holes, the
 * board lying over the left half, an optional screen and the pin names printed next to the pins.
 */
function headerModule(part: ResolvedPart, state: ItemState, v: Spec<"header-module">): ShapeNode {
  const OLED = { boardX: v.board.size[0], boardZ: v.board.size[1], height: v.board.height, glassX: v.screen?.size[0] ?? 0, glassZ: v.screen?.size[1] ?? 0 };
  const legs = legsOf(part);
  const order = v.pins.filter((id) => legs[id]);
  const pts = order.map((id) => legs[id]!);
  const center = mid(pts);
  const opacity = state === "ghost" ? 0.3 : 1;
  const t = opacity < 1;
  // Header along the board's right edge; the module lies over the channel and the left half.
  const boardCenterX = center[0] + 2 - OLED.boardX / 2;
  return {
    node: "group",
    children: [
      ...pts.map((p): ShapeNode => ({ node: "rod", from: p, to: [p[0], OLED.height, p[2]], opacity })),
      // black plastic spacer of the pin header
      { node: "mesh", position: [center[0], 1.25, center[2]], noRaycast: true, geometry: { type: "box", args: [2.5, 2.5, 2.54 * pts.length] }, material: { kind: "standard", color: "#1d1f23", transparent: t, opacity } },
      group(
        [boardCenterX, OLED.height, center[2]],
        [
          { node: "mesh", geometry: { type: "box", args: [OLED.boardX, 1.6, OLED.boardZ] }, pulse: true, material: { kind: "standard", color: v.board.color, emissive: "#ffffff", roughness: 0.5, transparent: t, opacity } },
          // plated mounting holes in the four corners
          ...([[-1, -1], [-1, 1], [1, -1], [1, 1]] as const).flatMap(([x, z]): ShapeNode[] => [
            { node: "mesh", position: [x * (OLED.boardX / 2 - 2.2), 0.81, z * (OLED.boardZ / 2 - 2.2)], noRaycast: true, geometry: { type: "cylinder", args: [1.35, 1.35, 0.05, 20] }, material: { kind: "standard", color: "#cfd3d8", metalness: 0.85, roughness: 0.3, transparent: t, opacity } },
            { node: "mesh", position: [x * (OLED.boardX / 2 - 2.2), 0.83, z * (OLED.boardZ / 2 - 2.2)], noRaycast: true, geometry: { type: "cylinder", args: [0.75, 0.75, 0.05, 16] }, material: { kind: "standard", color: "#0b0d12", transparent: t, opacity } },
          ]),
          // soldered header pins: a gold pad and the pin's tip on top of the board
          ...pts.flatMap((p): ShapeNode[] => [
            { node: "mesh", position: [p[0] - boardCenterX, 0.82, p[2] - center[2]], noRaycast: true, geometry: { type: "cylinder", args: [0.9, 0.9, 0.06, 18] }, material: std("#d8ae3c", opacity, METAL) },
            { node: "mesh", position: [p[0] - boardCenterX, 1.1, p[2] - center[2]], noRaycast: true, geometry: { type: "cylinder", args: [0.3, 0.45, 0.6, 10] }, material: std(TIN, opacity, METAL) },
          ]),
          ...(v.screen
            ? [
                // the display's flat cable, folded over the board edge opposite the pins
                { node: "mesh", position: [(-2 - OLED.glassX / 2 - OLED.boardX / 2) / 2, 0.9, 0], noRaycast: true, geometry: { type: "box", args: [OLED.boardX / 2 - 2 - OLED.glassX / 2 + 0.3, 0.2, Math.min(12, OLED.glassZ * 0.45)] }, material: std("#b5732a", opacity, { roughness: 0.5 }) } as ShapeNode,
                { node: "mesh", position: [-2, 1.1, 0], geometry: { type: "box", args: [OLED.glassX, 0.6, OLED.glassZ] }, material: { kind: "standard", color: "#05070d", roughness: 0.15, metalness: 0.3, transparent: t, opacity } } as ShapeNode,
                // "lit" pixels, so the screen side is obvious
                {
                  node: "mesh",
                  position: [-2, 1.45, 0],
                  rotation: [-Math.PI / 2, 0, Math.PI / 2],
                  noRaycast: true,
                  geometry: { type: "plane", args: [OLED.glassZ - 3, OLED.glassX - 4] },
                  material: { kind: "basic", map: { text: v.screen.text, bg: v.screen.bg, fg: v.screen.fg, width: 384, height: 64 }, transparent: true, opacity },
                } as ShapeNode,
              ]
            : []),
        ],
        { hover: true },
      ),
      // pin names printed next to each header pin
      ...(v.labels ? order : []).map(
        (id, i): ShapeNode => ({
          node: "mesh",
          position: [center[0] - 4.2, OLED.height + 0.85, pts[i]![2]],
          rotation: [-Math.PI / 2, 0, 0],
          noRaycast: true,
          geometry: { type: "plane", args: [4.6, 1.6] },
          material: { kind: "basic", map: { text: id.toUpperCase(), bg: v.board.color, fg: "#ffffff", width: 128, height: 48 }, transparent: true, opacity },
        }),
      ),
    ],
  };
}

/** A round body standing over its legs (e.g. a buzzer), with an optional top colour and label. */
function cylinder(part: ResolvedPart, state: ItemState, v: Spec<"cylinder">): ShapeNode {
  const pts = Object.values(legsOf(part));
  const center = mid(pts);
  const opacity = state === "ghost" ? 0.3 : 1;
  const t = opacity < 1;
  const legTop = 1.5;
  return {
    node: "group",
    children: [
      ...pts.map((p): ShapeNode => ({ node: "rod", from: p, to: [p[0], legTop, p[2]], opacity })),
      group(
        [center[0], legTop + v.height / 2, center[2]],
        [
          { node: "mesh", geometry: { type: "cylinder", args: [v.radius, v.radius, v.height, 32] }, pulse: true, material: { kind: "standard", color: v.color, emissive: "#ffffff", roughness: 0.6, transparent: t, opacity } },
          ...(v.top ? [{ node: "mesh", position: [0, v.height / 2 + 0.05, 0], rotation: [-Math.PI / 2, 0, 0], geometry: { type: "plane", args: [v.radius * 1.2, v.radius * 1.2] }, material: { kind: "basic", map: { text: v.label ?? "", bg: v.top, fg: "#ffffff", width: 96, height: 96 }, transparent: true, opacity } } as ShapeNode] : []),
        ],
        { hover: true },
      ),
    ],
  };
}

/**
 * A small slide switch: a black body on three legs in a row, a slot on top and the slider knob in
 * it, drawn toward the first outer leg.
 */
function slideSwitch(part: ResolvedPart, state: ItemState, v: Spec<"slide-switch">): ShapeNode {
  const legs = legsOf(part);
  const pts = v.legs.map((id) => legs[id]!);
  const center = pts[1]!;
  const opacity = fade(state);
  const [long, wide, tall] = v.size;
  const base = 0.6;
  const travel = long * 0.17;
  return {
    node: "group",
    children: [
      ...pts.map((p): ShapeNode => ({ node: "rod", from: p, to: [p[0], base + 0.3, p[2]], opacity })),
      group(
        [center[0], base, center[2]],
        [
          { node: "mesh", position: [0, tall / 2, 0], geometry: { type: "roundedBox", args: [wide, tall, long, 0.3] }, pulse: true, material: std(v.body, opacity, { emissive: "#ffffff", roughness: 0.55 }) },
          // the slot the slider moves in
          { node: "mesh", position: [0, tall + 0.02, 0], noRaycast: true, geometry: { type: "box", args: [wide * 0.5, 0.06, long * 0.66] }, material: std("#08090b", opacity, { roughness: 0.9 }) },
          // slider knob with its grip ridges
          { node: "mesh", position: [0, tall + 1.4, -travel], geometry: { type: "roundedBox", args: [wide * 0.42, 2.8, long * 0.27, 0.25] }, material: std(v.slider, opacity, { roughness: 0.45 }) },
          ...[-0.55, 0, 0.55].map((dz): ShapeNode => ({ node: "mesh", position: [0, tall + 2.84, -travel + dz], noRaycast: true, geometry: { type: "box", args: [wide * 0.42, 0.12, 0.22] }, material: std("#0c0d0f", opacity, { roughness: 0.7 }) })),
        ],
        { rotation: [0, turnTo(pts[0]!, pts[2]!), 0], hover: true },
      ),
    ],
  };
}

/**
 * A module whose pin header is bent to the side, so the board stands upright on the breadboard
 * (e.g. the 3-pin buzzer module). Its parts face the centre channel, like the potentiometer, so the
 * wires keep the outer holes: the round buzzer, the small transistor and resistor, the mounting
 * hole and the pin names printed above the pins.
 */
function uprightModule(part: ResolvedPart, state: ItemState, v: Spec<"upright-module">): ShapeNode {
  const legs = legsOf(part);
  const order = v.pins.filter((id) => legs[id]);
  const pts = order.map((id) => legs[id]!);
  const center = mid(pts);
  const opacity = fade(state);
  const face = center[0] < 0 ? 1 : -1; // the side with the parts: toward the centre channel
  const [across, tall] = v.board.size;
  const T = 1.6;
  const bottom = 3.2;
  const front = face * (T / 2);
  const metal = std(TIN, opacity, METAL);
  const flatOn = (y: number, z: number, size: [number, number, number], color: string, extra: Partial<Material> = {}): ShapeNode => ({ node: "mesh", position: [front + face * (size[0] / 2), y, z], noRaycast: true, geometry: { type: "box", args: size }, material: std(color, opacity, extra) });
  return {
    node: "group",
    children: [
      ...pts.map((p): ShapeNode => ({ node: "rod", from: p, to: [p[0], bottom + 1.5, p[2]], opacity })),
      // black plastic bar of the pin header
      { node: "mesh", position: [center[0], bottom - 1.25, center[2]], noRaycast: true, geometry: { type: "box", args: [2.5, 2.5, 2.54 * pts.length] }, material: std("#1d1f23", opacity) },
      group(
        [center[0], bottom, center[2]],
        [
          { node: "mesh", position: [0, tall / 2, 0], geometry: { type: "box", args: [T, tall, across] }, pulse: true, material: std(v.board.color, opacity, { emissive: "#ffffff", roughness: 0.5 }) },
          // solder joints of the header on both faces
          ...pts.flatMap((p): ShapeNode[] => [-1, 1].map((side): ShapeNode => ({ node: "mesh", position: [side * (T / 2 + 0.15), 1.5, p[2] - center[2]], rotation: [0, 0, Math.PI / 2], noRaycast: true, geometry: { type: "cylinder", args: [0.75, 0.75, 0.3, 14] }, material: metal }))),
          ...(v.buzzer
            ? [
                { node: "mesh", position: [front + face * (v.buzzer.height / 2), tall * 0.62, 0], rotation: [0, 0, Math.PI / 2], geometry: { type: "cylinder", args: [v.buzzer.radius, v.buzzer.radius, v.buzzer.height, 40] }, material: std(v.buzzer.color, opacity, { roughness: 0.45 }) } as ShapeNode,
                // the raised ring and the sound hole on the buzzer's face
                { node: "mesh", position: [front + face * (v.buzzer.height + 0.1), tall * 0.62, 0], rotation: [0, 0, Math.PI / 2], noRaycast: true, geometry: { type: "cylinder", args: [v.buzzer.radius * 0.8, v.buzzer.radius * 0.86, 0.2, 40] }, material: std(v.buzzer.color, opacity, { roughness: 0.35 }) } as ShapeNode,
                { node: "mesh", position: [front + face * (v.buzzer.height + 0.22), tall * 0.62, 0], rotation: [0, 0, Math.PI / 2], noRaycast: true, geometry: { type: "cylinder", args: [1.1, 1.1, 0.06, 20] }, material: std("#050506", opacity, { roughness: 0.9 }) } as ShapeNode,
              ]
            : []),
          // transistor (3 legs) and a small resistor between the pins and the buzzer
          flatOn(tall * 0.29, -across * 0.2, [1, 1.4, 2.9], "#17181b", { roughness: 0.5 }),
          flatOn(tall * 0.29, across * 0.22, [0.5, 1, 2], "#22242a", { roughness: 0.5 }),
          flatOn(tall * 0.29, across * 0.22 - 1.15, [0.52, 1, 0.4], TIN, METAL),
          flatOn(tall * 0.29, across * 0.22 + 1.15, [0.52, 1, 0.4], TIN, METAL),
          // mounting hole near the top, drilled through
          { node: "mesh", position: [0, tall - 3, 0], rotation: [0, 0, Math.PI / 2], noRaycast: true, geometry: { type: "cylinder", args: [2.1, 2.1, T + 0.06, 24] }, material: metal },
          { node: "mesh", position: [0, tall - 3, 0], rotation: [0, 0, Math.PI / 2], noRaycast: true, geometry: { type: "cylinder", args: [1.5, 1.5, T + 0.1, 24] }, material: std("#0b0d12", opacity) },
          // pin names, printed upward above each pin
          ...(v.labels ?? []).slice(0, pts.length).map(
            (text, i): ShapeNode => ({
              node: "mesh",
              position: [front + face * 0.03, 5.2, pts[i]![2] - center[2]],
              rotation: [0, face * (Math.PI / 2), Math.PI / 2],
              noRaycast: true,
              geometry: { type: "plane", args: [4.4, 1.7] },
              material: { kind: "basic", map: { text, bg: v.board.color, fg: "#ffffff", width: 128, height: 48 }, transparent: true, opacity },
            }),
          ),
        ],
        { hover: true },
      ),
    ],
  };
}

/**
 * A boxed sensor standing on a row of legs (the DHT11): a blue case whose front is a grid of
 * openings, a small mounting tab on top, and the legs coming out of the bottom near the back. The
 * grid faces the side from which the first pin is the left one, as in the part's own drawings.
 */
function gridSensor(part: ResolvedPart, state: ItemState, v: Spec<"grid-sensor">): ShapeNode {
  const legs = legsOf(part);
  const pts = v.pins.filter((id) => legs[id]).map((id) => legs[id]!);
  const center = mid(pts);
  const opacity = fade(state);
  const [wide, tall, thick] = v.body.size;
  const bottom = 2.2;
  // In the group's frame the legs run along z (first pin at -z) and the front faces -x.
  const bodyX = -(thick / 2 - 1.6);
  const frontX = bodyX - thick / 2;
  const cols = 4;
  const rows = 6;
  const cell: [number, number] = [(wide - 1.6) / cols, (tall - 2.4) / rows];
  const dark = std("#0d2547", opacity, { roughness: 0.8 });
  return {
    node: "group",
    children: [
      ...pts.map((p): ShapeNode => ({ node: "rod", from: p, to: [p[0], bottom + 0.3, p[2]], opacity })),
      group(
        [center[0], bottom, center[2]],
        [
          { node: "mesh", position: [bodyX, tall / 2, 0], geometry: { type: "roundedBox", args: [thick, tall, wide, 0.4] }, pulse: true, material: std(v.body.color, opacity, { emissive: "#ffffff", roughness: 0.45 }) },
          // the grid of openings on the front
          ...Array.from({ length: cols * rows }, (_, i): ShapeNode => {
            const c = i % cols;
            const r = Math.floor(i / cols);
            return { node: "mesh", position: [frontX - 0.02, 1.2 + cell[1] * (r + 0.5), (c - (cols - 1) / 2) * cell[0]], noRaycast: true, geometry: { type: "box", args: [0.1, cell[1] * 0.62, cell[0] * 0.7] }, material: dark };
          }),
          // mounting tab with its hole, on top at the back
          { node: "mesh", position: [bodyX + thick / 2 - 0.8, tall + 1.4, 0], geometry: { type: "roundedBox", args: [1.6, 3.4, 5, 0.3] }, material: std(v.body.color, opacity, { roughness: 0.45 }) },
          { node: "mesh", position: [bodyX + thick / 2 - 0.8, tall + 1.6, 0], rotation: [0, 0, Math.PI / 2], noRaycast: true, geometry: { type: "cylinder", args: [1, 1, 1.66, 18] }, material: dark },
        ],
        { rotation: [0, turnTo(pts[0]!, pts[pts.length - 1]!), 0], hover: true },
      ),
    ],
  };
}

function generic(part: ResolvedPart, state: ItemState): ShapeNode {
  const pts = Object.values(legsOf(part));
  const xs = pts.map((p) => p[0]);
  const zs = pts.map((p) => p[2]);
  const w = Math.max(...xs) - Math.min(...xs) + 6;
  const d = Math.max(...zs) - Math.min(...zs) + 6;
  const center = mid(pts);
  const opacity = state === "ghost" ? 0.3 : 1;
  return {
    node: "group",
    children: [
      ...pts.map((p): ShapeNode => ({ node: "rod", from: p, to: [p[0], 3, p[2]], opacity })),
      group(
        [center[0], 5, center[2]],
        [
          { node: "mesh", geometry: { type: "box", args: [w, 4, d] }, pulse: true, material: { kind: "standard", color: "#4b5563", emissive: "#ffffff", transparent: opacity < 1, opacity } },
          { node: "mesh", position: [0, 2.05, 0], rotation: [-Math.PI / 2, 0, 0], geometry: { type: "plane", args: [Math.min(w, 14), 3] }, material: { kind: "basic", map: { text: part.ref, bg: "#4b5563", fg: "#ffffff", width: 192, height: 48 }, transparent: true, opacity: 1 } },
        ],
        { hover: true },
      ),
    ],
  };
}
