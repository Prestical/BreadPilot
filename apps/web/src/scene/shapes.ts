// What each part looks like in 3D, as plain data (no React, no three.js objects), so it can be
// tested and later read from part packs. Parts.tsx only turns these nodes into meshes.
// Sizes are millimetres (1 unit = 1 mm, see coords.ts).
import { packOfPart, resistorBands, type ModuleFeature, type ResolvedPart, type TetherUnit, type ViewSpec } from "@breadpilot/circuit-core";
import { BOARD, holePos, type Vec3 } from "./coords";

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
  /** `arc` = [start, length] in radians draws only that part of the round wall and its two ends. */
  | { type: "cylinder"; args: [number, number, number, number]; arc?: [number, number] }
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
  | { node: "lead"; points: Vec3[]; radius: number; bend: number; opacity: number; color?: string }
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
export const fade = (state: ItemState) => (state === "ghost" ? 0.3 : 1);
/** A plain material in the part's opacity. */
export const std = (color: string, opacity: number, extra: Partial<Material> = {}): Material => ({ kind: "standard", color, transparent: opacity < 1, opacity, ...extra });
export const METAL = { metalness: 0.85, roughness: 0.3 };
export const TIN = "#c3c8cf";

type Spec<S extends ViewSpec["shape"]> = Extract<ViewSpec, { shape: S }>;

/** The 3D nodes for one part in one state, from its pack's view.json; `lit` lights an LED. */
export function partShapes(part: ResolvedPart, state: ItemState, lit = false): ShapeNode {
  return viewShapes(packOfPart(part.def)?.view, part, state, lit);
}

/** The same for a given look (also used for models whose pack isn't written yet). */
export function viewShapes(view: ViewSpec | undefined, part: ResolvedPart, state: ItemState, lit = false): ShapeNode {
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
    case "slide-switch":
      return slideSwitch(part, state, view);
    case "upright-module":
      return uprightModule(part, state, view);
    case "grid-sensor":
      return gridSensor(part, state, view);
    case "photo-disc":
      return photoDisc(part, state, view);
    case "bead":
      return bead(part, state, view);
    case "metal-can":
      return metalCan(part, state, view);
    case "glass-axial":
      return glassAxial(part, state, view);
    case "to92":
      return to92(part, state, view);
    case "tethered":
      return tethered(part, state, view);
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
          ...(v.holes === false ? [] : ([[-1, -1], [-1, 1], [1, -1], [1, 1]] as const)).flatMap(([x, z]): ShapeNode[] => [
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
          // The parts on top: drawn as on an upright module's face, then laid flat. The header's
          // edge is where that face's bottom is, and the face looks up.
          ...(v.features
            ? [group([OLED.boardX / 2, 0.8, 0], v.features.flatMap((f) => moduleFeature(f, { face: 1, front: 0, tall: OLED.boardX, opacity, board: v.board.color, centerX: 0, bottom: 0 })), { rotation: [0, 0, Math.PI / 2] })]
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
          ...(v.features
            ? v.features.flatMap((f) => moduleFeature(f, { face, front, tall, opacity, board: v.board.color, centerX: center[0], bottom }))
            : [
                // transistor (3 legs) and a small resistor between the pins and the buzzer
                flatOn(tall * 0.29, -across * 0.2, [1, 1.4, 2.9], "#17181b", { roughness: 0.5 }),
                flatOn(tall * 0.29, across * 0.22, [0.5, 1, 2], "#22242a", { roughness: 0.5 }),
                flatOn(tall * 0.29, across * 0.22 - 1.15, [0.52, 1, 0.4], TIN, METAL),
                flatOn(tall * 0.29, across * 0.22 + 1.15, [0.52, 1, 0.4], TIN, METAL),
              ]),
          // mounting hole near the top, drilled through
          ...(v.hole === false
            ? []
            : [
                { node: "mesh", position: [0, tall - 3, 0], rotation: [0, 0, Math.PI / 2], noRaycast: true, geometry: { type: "cylinder", args: [2.1, 2.1, T + 0.06, 24] }, material: metal } as ShapeNode,
                { node: "mesh", position: [0, tall - 3, 0], rotation: [0, 0, Math.PI / 2], noRaycast: true, geometry: { type: "cylinder", args: [1.5, 1.5, T + 0.1, 24] }, material: std("#0b0d12", opacity) } as ShapeNode,
              ]),
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
  const [cols, rows] = v.grid?.cells ?? [4, 6];
  const cell: [number, number] = [(wide - 1.6) / cols, (tall - 2.4) / rows];
  const dark = std(v.grid?.color ?? "#0d2547", opacity, { roughness: 0.8 });
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

/** Where a module's face is, for the parts drawn on it. */
interface Face {
  /** +1 or -1: the way the face looks along x. */
  face: number;
  /** x of the face in the module's frame. */
  front: number;
  tall: number;
  opacity: number;
  board: string;
  /** The module's place in the scene (for the probe, which lies beside the breadboard). */
  centerX: number;
  bottom: number;
}

/** One thing on an upright module's face (view.json `features`), in the module's frame. */
function moduleFeature(f: ModuleFeature, m: Face): ShapeNode[] {
  const { face, front, opacity } = m;
  /** A box lying on the face: `out` thick, `up` x `side` large, raised `gap` off the board. */
  const on = (u: number, y: number, [out, up, side]: [number, number, number], color: string, extra: Partial<Material> = {}, gap = 0): ShapeNode => ({ node: "mesh", position: [front + face * (gap + out / 2), y, u], noRaycast: true, geometry: { type: "box", args: [out, up, side] }, material: std(color, opacity, extra) });
  /** A disc lying on the face, `out` thick, starting `gap` off the board. */
  const disc = (u: number, y: number, r: number, out: number, color: string, extra: Partial<Material> = {}, gap = 0): ShapeNode => ({ node: "mesh", position: [front + face * (gap + out / 2), y, u], rotation: [0, 0, Math.PI / 2], noRaycast: true, geometry: { type: "cylinder", args: [r, r, out, 32] }, material: std(color, opacity, extra) });
  const black = { roughness: 0.5 };
  /** A turned profile whose axis looks out of the face, starting `gap` off the board. */
  const turned = (u: number, y: number, gap: number, points: [number, number][], material: Material): ShapeNode => ({ node: "mesh", position: [front + face * gap, y, u], rotation: [0, 0, -face * (Math.PI / 2)], noRaycast: true, geometry: { type: "lathe", args: [32], points }, material });
  switch (f.type) {
    case "trimmer": {
      const [u, y] = f.at;
      return [
        on(u, y, [4.6, 6.6, 6.6], "#2a5fd0", { roughness: 0.4 }),
        disc(u, y, 1.6, 0.4, "#c9a24a", METAL, 4.6),
        on(u, y, [0.12, 0.45, 2.6], "#3a2c10", { roughness: 0.8 }, 4.95),
        // its three legs on the pin side
        ...[-2.54, 0, 2.54].map((d) => on(u + d, y - 3.7, [0.5, 1, 0.6], TIN, METAL)),
      ];
    }
    case "chip": {
      const [u, y] = f.at;
      return [
        on(u, y, [1.5, 5, 3.9], "#17181b", black),
        ...[-1, 1].flatMap((side) => [-1.9, -0.63, 0.63, 1.9].map((d) => on(u + side * 2.45, y + d, [0.5, 0.42, 1.1], TIN, METAL))),
        disc(u - 1.2, y + 1.8, 0.3, 0.04, "#3a3d43", black, 1.5),
      ];
    }
    case "led": {
      const [u, y] = f.at;
      return [on(u, y, [0.7, 1.5, 0.9], f.color, { emissive: f.color, emissiveIntensity: 0.35, roughness: 0.3 }), on(u, y - 1, [0.5, 0.5, 0.9], TIN, METAL), on(u, y + 1, [0.5, 0.5, 0.9], TIN, METAL)];
    }
    case "resistor": {
      const [u, y] = f.at;
      return [on(u, y, [0.5, 1, 2], "#22242a", black), on(u - 1.15, y, [0.52, 1, 0.4], TIN, METAL), on(u + 1.15, y, [0.52, 1, 0.4], TIN, METAL)];
    }
    case "to92": {
      const [u, y] = f.at;
      return [
        { node: "mesh", position: [front + face * 1.15, y, u], noRaycast: true, geometry: { type: "roundedBox", args: [1.5, 3.2, 4.1, 0.3] }, material: std("#17181b", opacity, black) },
        ...[-1.27, 0, 1.27].map((d) => on(u + d, y - 3.1, [0.4, 3.2, 0.45], TIN, METAL, 0.55)),
      ];
    }
    case "emitter": {
      // Like a small LED standing past the board's edge, its two legs bent back onto the face.
      const [u, y] = f.at;
      const R = 2.5;
      const x = front + face * 2.7;
      const dome: [number, number][] = [[R, 0], [R, 4.6], ...Array.from({ length: 8 }, (_, i): [number, number] => [Math.max(0, R * Math.cos(((i + 1) / 8) * (Math.PI / 2))), 4.6 + R * Math.sin(((i + 1) / 8) * (Math.PI / 2))])];
      const body = std(f.color, f.clear ? opacity * 0.55 : opacity, { roughness: 0.2, transparent: f.clear || opacity < 1 });
      return [
        ...[-1.27, 1.27].map((d): ShapeNode => ({ node: "lead", points: [[x, y + 0.4, u + d], [x, y - 2.2, u + d], [front + face * 0.2, y - 4.4, u + d]], radius: 0.25, bend: 1, opacity })),
        { node: "mesh", position: [x, y + 0.5, u], noRaycast: true, geometry: { type: "cylinder", args: [2.9, 2.9, 1, 28] }, material: body },
        { node: "mesh", position: [x, y + 1, u], noRaycast: true, geometry: { type: "lathe", args: [28], points: dome }, material: body },
      ];
    }
    case "mic": {
      const [u, y] = f.at;
      return [
        { node: "mesh", position: [front + face * (f.height / 2), y, u], rotation: [0, 0, Math.PI / 2], geometry: { type: "cylinder", args: [f.radius, f.radius, f.height, 40] }, material: std("#c9cdd3", opacity, METAL) },
        disc(u, y, f.radius * 0.84, 0.12, "#0e0f11", { roughness: 0.95 }, f.height),
      ];
    }
    case "pad": {
      const [u, y] = f.at;
      return [
        disc(u, y, f.radius, 0.04, "#e9eaec", { roughness: 0.6 }),
        disc(u, y, f.radius * 0.88, 0.05, m.board, { roughness: 0.5 }),
        disc(u, y, f.radius * 0.5, 0.06, "#e9eaec", { roughness: 0.6 }),
        disc(u, y, f.radius * 0.38, 0.07, m.board, { roughness: 0.5 }),
      ];
    }
    case "traces": {
      const [u, y] = f.at;
      const step = f.width / f.count;
      return [
        ...Array.from({ length: f.count }, (_, i) => on(u + (i - (f.count - 1) / 2) * step, y + f.length / 2 + (i % 2 ? 0 : 1.2), [0.06, f.length - (i % 2 ? 0 : 2.4), step * 0.52], "#d5d8dc", { metalness: 0.7, roughness: 0.35 })),
        // the bar that joins every second strip at the top
        on(u, y + f.length + 0.6, [0.06, 1, f.width - step * 0.48], "#d5d8dc", { metalness: 0.7, roughness: 0.35 }),
      ];
    }

    case "sensor": {
      const [u, y] = f.at;
      return [
        on(u, y, [1, f.size[1], f.size[0]], f.color, f.vent ? METAL : { roughness: 0.4 }),
        ...(f.vent ? [disc(u + f.size[0] * 0.25, y + f.size[1] * 0.25, Math.min(...f.size) * 0.1, 0.03, "#1a1b1e", { roughness: 0.9 }, 1)] : []),
      ];
    }
    case "hole": {
      const [u, y] = f.at;
      return [disc(u, y, f.radius, 0.04, "#cfd3d8", METAL), disc(u, y, f.radius * 0.6, 0.06, "#0b0d12")];
    }
    case "can": {
      // A vibration switch (SW-420): a metal can lying along the board, its sealed end dark, the two
      // wires at its ends bent onto the face.
      const [u, y] = f.at;
      const x = front + face * f.radius;
      const along = (du: number, r: number, len: number, color: string, extra: Partial<Material>): ShapeNode => ({ node: "mesh", position: [x, y, u + du], rotation: [Math.PI / 2, 0, 0], noRaycast: true, geometry: { type: "cylinder", args: [r, r, len, 24] }, material: std(color, opacity, extra) });
      return [
        along(0, f.radius, f.length, f.color, METAL),
        along(f.length / 2 + 0.4, f.radius * 0.9, 0.8, "#1a1b1e", { roughness: 0.7 }),
        ...[-1, 1].map((s) => on(u + s * (f.length / 2 + 1.2), y, [0.4, 0.5, 1.2], TIN, METAL)),
      ];
    }
    case "disc": {
      // A coin vibration motor stuck on the face: a metal disc with a thin rim, its two wires to the board.
      const [u, y] = f.at;
      return [
        disc(u, y, f.radius, f.height, f.color, METAL),
        disc(u, y, f.radius * 0.86, 0.06, "#b5b9c0", METAL, f.height),
        ...([[-0.8, "#d93a3a"], [0.8, "#2a2c31"]] as const).map(([d, color]): ShapeNode => ({ node: "lead", points: [[front + face * (f.height * 0.5), y - f.radius, u + d], [front + face * 0.3, y - f.radius - 2.5, u + d]], radius: 0.25, bend: 0.6, opacity, color })),
      ];
    }
    case "coin": {
      // On the back: the black holder, the cell in it and the spring clip across the cell.
      const [u, y] = f.at;
      const back = (r: number, thick: number, gap: number, color: string, extra: Partial<Material> = {}): ShapeNode => ({ node: "mesh", position: [-front - face * (gap + thick / 2), y, u], rotation: [0, 0, Math.PI / 2], noRaycast: true, geometry: { type: "cylinder", args: [r, r, thick, 40] }, material: std(color, opacity, extra) });
      return [
        back(f.radius * 1.1, 2, 0, "#1d1f23", { roughness: 0.6 }),
        back(f.radius, 3.2, 1, "#d5d8dc", METAL),
        { node: "mesh", position: [-front - face * 4.4, y, u], noRaycast: true, geometry: { type: "box", args: [0.4, 4, f.radius * 2.2] }, material: std("#c3c8cf", opacity, METAL) },
      ];
    }
  }
}

/**
 * A TO-92 case (a DS18B20, a small transistor): a black body that is round at the back and flat at
 * the front, with the part's name printed on the flat side, on three legs that spread out to their
 * holes. Seen from the flat side, the first leg is the left one.
 */
function to92(part: ResolvedPart, state: ItemState, v: Spec<"to92">): ShapeNode {
  const legs = legsOf(part);
  const pts = v.legs.map((id) => legs[id]!);
  const center = pts[1]!;
  const opacity = fade(state);
  const first = pts[0]!;
  const last = pts[2]!;
  const len = Math.hypot(last[0] - first[0], last[2] - first[2]) || 1;
  const dir: Vec3 = [(last[0] - first[0]) / len, 0, (last[2] - first[2]) / len];
  const baseY = 4.4;
  const R = 2.3;
  const tall = 4.6;
  const flat = 1.3; // from the middle to the flat side
  const cut = Math.acos(flat / R); // half of the round wall that the flat side takes away
  const body = std(v.color, opacity, { emissive: "#ffffff", roughness: 0.5 });
  return {
    node: "group",
    children: [
      // in the case the legs are 1.27 mm apart: the outer two bend out to their holes
      ...pts.map((p, i): ShapeNode => ({ node: "lead", points: [p, [p[0], 2, p[2]], [center[0] + dir[0] * (i - 1) * 1.27, baseY + 0.3, center[2] + dir[2] * (i - 1) * 1.27]], radius: 0.22, bend: 1, opacity })),
      group(
        [center[0], baseY, center[2]],
        [
          // the round back (the flat side looks toward -x) and the block that fills it up to the flat side
          { node: "mesh", position: [0, tall / 2, 0], geometry: { type: "cylinder", args: [R, R, tall, 32], arc: [(3 * Math.PI) / 2 + cut, 2 * Math.PI - 2 * cut] }, pulse: true, material: body },
          { node: "mesh", position: [-flat / 2, tall / 2, 0], geometry: { type: "box", args: [flat, tall, 2 * R * Math.sin(cut)] }, material: std(v.color, opacity, { roughness: 0.5 }) },
          ...(v.label ? [{ node: "mesh", position: [-flat - 0.02, tall * 0.56, 0], rotation: [0, -Math.PI / 2, 0], noRaycast: true, geometry: { type: "plane", args: [3.5, 1.1] }, material: { kind: "basic", map: { text: v.label, bg: v.color, fg: "#aeb3ba", width: 176, height: 56 }, transparent: true, opacity } } as ShapeNode] : []),
        ],
        { rotation: [0, turnTo(first, last), 0], hover: true },
      ),
    ],
  };
}

/** One thing lying on the mat beside the breadboard, in its own frame: x = 0 is its middle, -x looks at the breadboard, y = 0 is the mat. */
interface Unit {
  /** Half of its size across (mm), so it can be placed clear of the breadboard. */
  half: number;
  /** Where each wire ends on it. */
  ends: Vec3[];
  nodes: ShapeNode[];
}

/** The parts that hang on a `tethered` part's wires. `flip` = the unit is turned half round (it lies left of the breadboard). */
function tetherUnit(u: TetherUnit, wires: number, opacity: number, flip: boolean): Unit {
  const metal = std(TIN, opacity, METAL);
  const box = (at: Vec3, args: [number, number, number], color: string, extra: Partial<Material> = {}, pulse = false): ShapeNode => ({ node: "mesh", position: at, ...(pulse ? { pulse: true } : { noRaycast: true }), geometry: { type: "box", args }, material: std(color, opacity, { roughness: 0.5, ...(pulse ? { emissive: "#ffffff" } : {}), ...extra }) });
  const cyl = (at: Vec3, r: number, h: number, material: Material, rotation?: Vec3, pulse = false): ShapeNode => ({ node: "mesh", position: at, ...(rotation ? { rotation } : {}), ...(pulse ? { pulse: true } : { noRaycast: true }), geometry: { type: "cylinder", args: [r, r, h, 32] }, material });
  const side = (i: number, pitch: number) => (i - (wires - 1) / 2) * pitch;
  switch (u.type) {
    case "soil-probe": {
      // A capacitive soil moisture probe (v1.2) lying flat, pointing away from the breadboard (in this
      // frame -x looks at the breadboard). After the common board's photos: the head with the
      // electronics and the white 3-pin plug at its end, a small shoulder where the narrower probe
      // starts, the probe with its two lines of white print, and the arrow-shaped point.
      const L = 98;
      const W = 23; // the head
      const P = 21; // the probe, a little narrower: the shoulder
      const head = 25;
      const top = 1.6;
      const near = -L / 2;
      const tipBase = L / 2 - P / 2; // the point: two 45° edges meeting at the far end
      const probeLen = tipBase - (near + head);
      const board = std(u.board, opacity, { roughness: 0.5 });
      const print = (text: string, z: number): ShapeNode => ({
        node: "mesh",
        position: [near + head + probeLen / 2 + 1, top + 0.03, z],
        // lying flat; read with the point on the left, like the real print. No background: only the
        // letters are drawn, so the board's own black shows between them.
        rotation: [-Math.PI / 2, 0, 0],
        noRaycast: true,
        geometry: { type: "plane", args: [50, 6] },
        material: { kind: "basic", map: { text, bg: "rgba(0,0,0,0)", fg: "#f1f1ed", width: 500, height: 60 }, transparent: true, opacity },
      });
      return {
        half: L / 2,
        ends: Array.from({ length: wires }, (_, i): Vec3 => [near - 0.6, 3.4, side(i, 2)]),
        nodes: [
          // the head, the probe, and the point (a square turned 45°: its back half is hidden in the probe)
          box([near + head / 2, top / 2, 0], [head, top, W], u.board, { roughness: 0.5 }, true),
          box([near + head + probeLen / 2, top / 2, 0], [probeLen, top, P], u.board, { roughness: 0.5 }),
          { node: "mesh", position: [tipBase, top / 2, 0], rotation: [0, Math.PI / 4, 0], noRaycast: true, geometry: { type: "box", args: [P / Math.SQRT2, top, P / Math.SQRT2] }, material: board },
          // the white line along the head's edge: push it into the soil only up to here
          box([near + head - 0.4, top + 0.03, 0], [0.5, 0.06, W - 1.5], "#f1f1ed", { roughness: 0.6 }),
          print("Capacitive Soil", -3.6),
          print("Moisture Sensor v1.2", 3.6),
          // electronics on the head: the timer chip with its legs, the regulator, small resistors
          box([near + 14, top + 0.75, 3], [5, 1.5, 4], "#17181b"),
          ...[-1, 1].flatMap((s) => [-1.27, 0, 1.27].map((d) => box([near + 14 + d * 1.3, top + 0.25, 3 + s * 2.4], [0.4, 0.5, 0.9], TIN, METAL))),
          box([near + 12, top + 0.6, -5], [1.8, 1.2, 3], "#17181b"),
          ...[[17, -6.5], [19, -3.5], [19, 8.5], [10, 8.5]].map(([x, z]) => box([near + x!, top + 0.4, z!], [1.6, 0.8, 1], "#22242a")),
          // the white 3-pin plug at the end, its opening toward the breadboard (-x), the pins inside
          box([near + 3, top + 2.9, 0], [6, 5.8, 8.6], "#f1efe9", { roughness: 0.45 }),
          box([near - 0.01, top + 2.9, 0], [0.04, 4, 7.4], "#3a3d43", { roughness: 0.8 }),
          ...Array.from({ length: 3 }, (_, i) => box([near + 1.5, top + 2.9, (i - 1) * 2], [3, 0.5, 0.5], TIN, METAL)),
        ],
      };
    }
  }
}

/**
 * A part on wires: each wire starts in one of the part's holes (under a small pin housing, or one
 * plug for all of them) and runs over the breadboard's edge down to the part itself, which lies on
 * the mat on the side away from the centre channel.
 */
function tethered(part: ResolvedPart, state: ItemState, v: Spec<"tethered">): ShapeNode {
  const legs = legsOf(part);
  const pts = v.pins.filter((id) => legs[id]).map((id) => legs[id]!);
  const center = mid(pts);
  const opacity = fade(state);
  const out = center[0] < 0 ? -1 : 1;
  const unit = tetherUnit(v.unit, pts.length, opacity, out < 0);
  const ux = out * (BOARD.maxX + 7 + unit.half) - center[0];
  const mat = -BOARD.height;
  // the unit's frame → this part's frame (it is turned half round on the left of the breadboard)
  const place = (p: Vec3): Vec3 => [ux + out * p[0], mat + p[1], out * p[2]];
  const dark = std("#1d1f23", opacity, { roughness: 0.6 });
  return {
    node: "group",
    children: [
      ...pts.map((p): ShapeNode => ({ node: "rod", from: p, to: [p[0], 2.5, p[2]], opacity })),
      group(
        [center[0], 0, center[2]],
        [
          ...(v.plug
            ? [{ node: "mesh", position: [0, 8, 0], noRaycast: true, geometry: { type: "box", args: [2.6, 12, 2.54 * pts.length] }, material: dark } as ShapeNode]
            : pts.map((p): ShapeNode => ({ node: "mesh", position: [p[0] - center[0], 8, p[2] - center[2]], noRaycast: true, geometry: { type: "box", args: [2.4, 12, 2.4] }, material: dark }))),
          ...pts.map((p, i): ShapeNode => {
            const end = place(unit.ends[i]!);
            const z = p[2] - center[2];
            return { node: "lead", points: [[p[0] - center[0], 13.5, z], [p[0] - center[0], 19, z], [end[0] - out * 9, Math.max(end[1] + 9, 6), end[2]], end], radius: 0.55, bend: 6, opacity, color: v.wires[i % v.wires.length] ?? "#8a8f98" };
          }),
          group([ux, mat, 0], unit.nodes, out < 0 ? { rotation: [0, Math.PI, 0] } : {}),
        ],
        { hover: true },
      ),
    ],
  };
}

/**
 * A light sensor (LDR): a flat ceramic disc facing up on two legs. On its face the light-sensitive
 * layer with the pale zigzag line that runs between its two electrodes.
 */
function photoDisc(part: ResolvedPart, state: ItemState, v: Spec<"photo-disc">): ShapeNode {
  const legs = legsOf(part);
  const a = legs[v.legs[0]]!;
  const b = legs[v.legs[1]]!;
  const center = mid([a, b]);
  const opacity = fade(state);
  const baseY = 3.4;
  const thick = 2;
  const R = v.radius * 0.8;
  const n = 5;
  const step = (2 * R) / (n + 1);
  const z = Array.from({ length: n }, (_, i) => -R + step * (i + 1));
  const half = z.map((zi) => Math.sqrt(R * R - zi * zi) - 0.1);
  const w = 0.24;
  const line = std(v.track, opacity, { roughness: 0.6 });
  const y = thick + 0.07;
  // Bar i joins bar i+1 at one end (the ends alternate), so the line snakes across the face.
  const joinAt = (i: number) => Math.min(half[i]!, half[i + 1]!);
  const bars = z.map((zi, i): ShapeNode => {
    const side = i % 2 ? -1 : 1;
    const toNext = i < n - 1 ? joinAt(i) : half[i]!;
    const toPrev = i > 0 ? joinAt(i - 1) : half[i]!;
    const from = -side * toPrev;
    const to = side * toNext;
    return { node: "mesh", position: [(from + to) / 2, y, zi], noRaycast: true, geometry: { type: "box", args: [Math.abs(to - from), 0.06, w] }, material: line };
  });
  const joins = z.slice(0, -1).map((zi, i): ShapeNode => ({ node: "mesh", position: [(i % 2 ? -1 : 1) * (joinAt(i) - w / 2), y, zi + step / 2], noRaycast: true, geometry: { type: "box", args: [w, 0.06, step + w] }, material: line }));
  return {
    node: "group",
    children: [
      { node: "rod", from: a, to: [a[0], baseY + 0.3, a[2]], opacity },
      { node: "rod", from: b, to: [b[0], baseY + 0.3, b[2]], opacity },
      group(
        [center[0], baseY, center[2]],
        [
          { node: "mesh", position: [0, thick / 2, 0], geometry: { type: "cylinder", args: [v.radius, v.radius, thick, 36] }, pulse: true, material: std(v.body, opacity, { emissive: "#ffffff", roughness: 0.55 }) },
          { node: "mesh", position: [0, thick + 0.02, 0], noRaycast: true, geometry: { type: "cylinder", args: [v.radius * 0.9, v.radius * 0.9, 0.04, 36] }, material: std(v.face, opacity, { roughness: 0.3 }) },
          ...bars,
          ...joins,
          // the two electrodes at the ends of the line, over the legs
          ...[-1, 1].map((side): ShapeNode => ({ node: "mesh", position: [0, thick + 0.05, side * v.radius * 0.84], noRaycast: true, geometry: { type: "box", args: [v.radius * 0.7, 0.06, 0.3] }, material: std(TIN, opacity, METAL) })),
        ],
        { rotation: [0, turnTo(a, b), 0], hover: true },
      ),
    ],
  };
}

/** A small epoxy bead on two thin legs that come together under it (an NTC thermistor). */
function bead(part: ResolvedPart, state: ItemState, v: Spec<"bead">): ShapeNode {
  const legs = legsOf(part);
  const a = legs[v.legs[0]]!;
  const b = legs[v.legs[1]]!;
  const center = mid([a, b]);
  const opacity = fade(state);
  const r = v.radius;
  const baseY = 5;
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
  const dir: Vec3 = [(b[0] - a[0]) / len, 0, (b[2] - a[2]) / len];
  // a drop: narrow where the legs enter, widest in the middle, rounded on top
  const drop: [number, number][] = ([[0.25, 0], [0.62, 0.3], [0.93, 0.8], [1, 1.3], [0.9, 1.8], [0.6, 2.15], [0.25, 2.3], [0, 2.32]] as const).map(([x, y]) => [x * r, y * r]);
  return {
    node: "group",
    children: [
      ...[[a, -1], [b, 1]].map(([p, side]): ShapeNode => {
        const hole = p as Vec3;
        const s = side as number;
        return { node: "lead", points: [hole, [hole[0], 2.4, hole[2]], [center[0] + dir[0] * s * 0.4, baseY + 0.3, center[2] + dir[2] * s * 0.4]], radius: 0.22, bend: 1.2, opacity };
      }),
      group([center[0], baseY, center[2]], [{ node: "mesh", geometry: { type: "lathe", args: [24], points: drop }, pulse: true, material: std(v.color, opacity, { emissive: "#ffffff", roughness: 0.3 }) }], { hover: true }),
    ],
  };
}

/**
 * A metal can standing on two legs (a ball tilt switch): the sealing plug at the bottom, the crimp
 * ring above it and the can with its rounded top edge.
 */
function metalCan(part: ResolvedPart, state: ItemState, v: Spec<"metal-can">): ShapeNode {
  const legs = legsOf(part);
  const a = legs[v.legs[0]]!;
  const b = legs[v.legs[1]]!;
  const center = mid([a, b]);
  const opacity = fade(state);
  const r = v.radius;
  const H = v.height;
  const legTop = 1.5;
  const can: [number, number][] = [[r, 0], [r, H - r * 0.45], [r * 0.95, H - r * 0.2], [r * 0.8, H - r * 0.05], [r * 0.55, H], [0, H]];
  return {
    node: "group",
    children: [
      { node: "rod", from: a, to: [a[0], legTop + 0.4, a[2]], opacity },
      { node: "rod", from: b, to: [b[0], legTop + 0.4, b[2]], opacity },
      group(
        [center[0], legTop, center[2]],
        [
          { node: "mesh", position: [0, 0.5, 0], noRaycast: true, geometry: { type: "cylinder", args: [r * 0.9, r * 0.9, 1, 28] }, material: std(v.base ?? "#2a2c31", opacity, { roughness: 0.6 }) },
          { node: "mesh", position: [0, 1, 0], geometry: { type: "lathe", args: [32], points: can }, pulse: true, material: std(v.color, opacity, { emissive: "#ffffff", ...METAL }) },
          { node: "mesh", position: [0, 1.5, 0], noRaycast: true, geometry: { type: "cylinder", args: [r * 1.06, r * 1.06, 0.6, 32] }, material: std(v.color, opacity, METAL) },
        ],
        { hover: true },
      ),
    ],
  };
}

/**
 * A reed switch: a thin glass tube lying between its two legs. Each leg's wire is bent up and goes
 * into one end of the tube; inside, the two flat reeds overlap in the middle with a small gap.
 */
function glassAxial(part: ResolvedPart, state: ItemState, v: Spec<"glass-axial">): ShapeNode {
  const legs = legsOf(part);
  const a = legs[v.legs[0]]!;
  const b = legs[v.legs[1]]!;
  const center = mid([a, b]);
  const opacity = fade(state);
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
  const dir: Vec3 = [(b[0] - a[0]) / len, 0, (b[2] - a[2]) / len];
  const [length, R] = v.size;
  const L = Math.min(length, len * 0.78);
  const y = R + 1.2;
  const inside = L / 2 - R;
  const overlap = 0.9;
  const metal = std("#b9bcc2", opacity, METAL);
  const wire = (hole: Vec3, side: number): ShapeNode => ({ node: "lead", points: [hole, [hole[0], y, hole[2]], [center[0] + dir[0] * side * inside, y, center[2] + dir[2] * side * inside]], radius: 0.25, bend: 0.9, opacity });
  const reed = (side: number): ShapeNode => ({ node: "mesh", position: [0, side * 0.14, side * (inside - overlap) / 2], noRaycast: true, geometry: { type: "box", args: [R * 0.8, 0.14, inside + overlap] }, material: metal });
  return {
    node: "group",
    children: [
      wire(a, -1),
      wire(b, 1),
      group(
        [center[0], y, center[2]],
        [
          reed(-1),
          reed(1),
          { node: "mesh", rotation: [Math.PI / 2, 0, 0], geometry: { type: "capsule", args: [R, L - 2 * R, 8, 20] }, pulse: true, material: std(v.glass, state === "ghost" ? 0.15 : 0.42, { emissive: "#ffffff", roughness: 0.06, transparent: true }) },
        ],
        { rotation: [0, turnTo(a, b), 0], hover: true },
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
