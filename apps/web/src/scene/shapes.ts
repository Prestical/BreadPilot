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
    case "cylinder":
      return cylinder(part, state, view);
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
    case "diode":
      return diode(part, state, view);
    case "can-capacitor":
      return canCapacitor(part, state, view);
    case "disc-capacitor":
      return discCapacitor(part, state, view);
    case "to220":
      return to220(part, state, view);
    case "tethered":
      return tethered(part, state, view);
    case "rgb-led":
      return rgbLed(part, state, view);
    case "seven-segment":
      return sevenSegment(part, state, view);
    case "keypad":
      return keypad(part, state, view);
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
 * A round body standing over its legs (e.g. a buzzer), with an optional top colour and label, a
 * sound hole in the top and a "+" printed on top beside the positive leg.
 */
function cylinder(part: ResolvedPart, state: ItemState, v: Spec<"cylinder">): ShapeNode {
  const legs = legsOf(part);
  const pts = Object.values(legs);
  const center = mid(pts);
  const plus = v.plus ? legs[v.plus] : undefined;
  const toPlus = plus ? Math.hypot(plus[0] - center[0], plus[2] - center[2]) || 1 : 1;
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
          ...(v.hole
            ? [
                // the raised rim of the top and the sound hole in its middle
                { node: "mesh", position: [0, v.height / 2 + 0.1, 0], noRaycast: true, geometry: { type: "cylinder", args: [v.radius * 0.84, v.radius * 0.9, 0.2, 40] }, material: std(v.color, opacity, { roughness: 0.4 }) } as ShapeNode,
                { node: "mesh", position: [0, v.height / 2 + 0.21, 0], noRaycast: true, geometry: { type: "cylinder", args: [v.hole, v.hole, 0.04, 20] }, material: std("#050506", opacity, { roughness: 0.9 }) } as ShapeNode,
              ]
            : []),
          ...(plus
            ? [{ node: "mesh", position: [((plus[0] - center[0]) / toPlus) * v.radius * 0.56, v.height / 2 + 0.22, ((plus[2] - center[2]) / toPlus) * v.radius * 0.56], rotation: [-Math.PI / 2, 0, 0], noRaycast: true, geometry: { type: "plane", args: [v.radius * 0.42, v.radius * 0.42] }, material: { kind: "basic", map: { text: "+", bg: v.color, fg: "#e6e7ea", width: 64, height: 64 }, transparent: true, opacity } } as ShapeNode]
            : []),
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
    case "probe": {
      // A fork of two bare prongs on its own cable. It lies on the mat beside the breadboard, on
      // the side away from the centre channel; two wires run to it from the back of the module.
      const [wide, long] = f.size;
      const head = 14;
      const px = -face * (BOARD.maxX + 5 + wide / 2) - m.centerX;
      const py = -BOARD.height - m.bottom;
      const prong = wide * 0.3;
      const tin = std("#cfd2d6", opacity, { metalness: 0.7, roughness: 0.4 });
      const plugZ = -long / 2 + 3;
      return [
        { node: "mesh", position: [px, py + 0.8, -long / 2 + head / 2], geometry: { type: "box", args: [wide, 1.6, head] }, material: std(f.color, opacity, { roughness: 0.5 }) },
        ...[-1, 1].flatMap((side): ShapeNode[] => [
          { node: "mesh", position: [px + side * (wide / 2 - prong / 2), py + 0.8, head / 2], noRaycast: true, geometry: { type: "box", args: [prong, 1.6, long - head] }, material: tin },
          // the pointed tip
          { node: "mesh", position: [px + side * (wide / 2 - prong / 2), py + 0.8, long / 2], rotation: [0, Math.PI / 4, 0], noRaycast: true, geometry: { type: "box", args: [prong / Math.SQRT2, 1.6, prong / Math.SQRT2] }, material: tin },
        ]),
        { node: "mesh", position: [px, py + 2.85, plugZ], noRaycast: true, geometry: { type: "box", args: [5.2, 2.5, 2.5] }, material: std("#1d1f23", opacity) },
        // the 2-pin plug on the module's back and the two wires
        { node: "mesh", position: [-face * 2.05, m.tall - 3.5, 0], noRaycast: true, geometry: { type: "box", args: [2.5, 2.5, 5.2] }, material: std("#1d1f23", opacity) },
        ...([[-1, "#d93a3a"], [1, "#2a2c31"]] as const).map(
          ([side, color]): ShapeNode => ({
            node: "lead",
            points: [[-face * 3.3, m.tall - 3.5, side * 1.27], [-face * 11, m.tall - 3.5, side * 1.27], [px + side * 1.27, py + 16, plugZ], [px + side * 1.27, py + 4, plugZ]],
            radius: 0.6,
            bend: 7,
            opacity,
            color,
          }),
        ),
      ];
    }

    case "transducer": {
      const [u, y] = f.at;
      return [
        { node: "mesh", position: [front + face * (f.height / 2), y, u], rotation: [0, 0, Math.PI / 2], geometry: { type: "cylinder", args: [f.radius, f.radius, f.height, 40] }, material: std("#c4c8ce", opacity, METAL) },
        // the rolled rim and the dark mesh behind it
        disc(u, y, f.radius * 0.9, 0.3, "#d5d8dc", METAL, f.height),
        disc(u, y, f.radius * 0.78, 0.34, "#2b2d31", { roughness: 0.95 }, f.height),
        disc(u, y, f.radius * 0.2, 0.38, "#1a1b1e", { roughness: 0.9 }, f.height),
      ];
    }
    case "crystal": {
      const [u, y] = f.at;
      return [{ node: "mesh", position: [front + face * 1.75, y, u], noRaycast: true, geometry: { type: "roundedBox", args: [3.5, 3.7, 10.5, 1.2] }, material: std("#c9cdd3", opacity, METAL) }];
    }
    case "stick": {
      const [u, y] = f.at;
      const dark = { roughness: 0.55 };
      // the cap: a wide mushroom with a rounded rim, seen from the shaft
      const cap: [number, number][] = [[2.6, 0], [2.6, 1.2], [8.2, 2], [9.6, 3], [9.8, 4.4], [9, 5.8], [7, 6.7], [3.5, 7.1], [0, 7.2]];
      return [
        on(u, y, [11, 16, 16], "#1b1c1f", dark),
        // the two potentiometers on the housing's sides
        on(u + 10.5, y, [9, 10, 5], "#2e3136", dark),
        on(u, y - 10.5, [9, 5, 10], "#2e3136", dark),
        // the ball the shaft tilts on, the shaft and the cap
        disc(u, y, 5.2, 1.6, "#2a2c31", dark, 11),
        disc(u, y, 2.6, 5, "#111214", dark, 12.6),
        turned(u, y, 16.4, cap, std("#17181b", opacity, { roughness: 0.6 })),
      ];
    }
    case "encoder": {
      const [u, y] = f.at;
      const steel = std("#b9bcc2", opacity, METAL);
      return [
        { node: "mesh", position: [front + face * 3.25, y, u], geometry: { type: "box", args: [6.5, 12, 12.4] }, material: steel },
        // threaded bushing with its ridges, then the shaft with its flat
        disc(u, y, 3.5, 5, "#c3c8cf", METAL, 6.5),
        ...[7.6, 8.8, 10].map((gap) => disc(u, y, 3.7, 0.3, "#c3c8cf", METAL, gap)),
        disc(u, y, 3, 13, "#a9adb4", METAL, 11.5),
        on(u, y + 2.6, [7, 1, 4.4], "#8e9299", METAL, 17.6),
      ];
    }
    case "digits": {
      const [u, y] = f.at;
      const [wide, high] = f.size;
      const deep = 7;
      const cell = (wide - 2) / f.count;
      const lit = { emissive: f.color, emissiveIntensity: 0.7, roughness: 0.4 };
      // A reader facing the module sees its left at the side the face turns toward +z.
      const right = -face;
      return [
        on(u, y, [deep, high, wide], "#e8e8e4", { roughness: 0.5 }),
        on(u, y, [0.1, high - 1, wide - 1], "#121316", { roughness: 0.35 }, deep),
        ...Array.from({ length: f.count }, (_, i) => segments(cell * 0.6, high * 0.72).map((s) => on(u + right * ((i - (f.count - 1) / 2) * cell + s.x), y + s.y, [0.08, s.h, s.w], f.color, lit, deep + 0.08))).flat(),
        ...(f.colon ? [-1, 1].map((side) => disc(u, y + side * high * 0.16, cell * 0.06, 0.08, f.color, lit, deep + 0.08)) : []),
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
    case "relay": {
      const [u, y] = f.at;
      return [
        { node: "mesh", position: [front + face * 7.75, y, u], geometry: { type: "roundedBox", args: [15.5, 19, 15.5, 0.5] }, material: std("#2a5fd0", opacity, { roughness: 0.4 }) },
        // the small vent nub on the relay's top
        disc(u + 4.5, y + 6, 0.9, 0.3, "#2452b8", { roughness: 0.4 }, 15.5),
      ];
    }
    case "terminal": {
      const [u, y] = f.at;
      const wide = f.ways * 5;
      return [
        on(u, y, [10, 8, wide], "#2a5fd0", { roughness: 0.45 }),
        ...Array.from({ length: f.ways }, (_, i) => [disc(u + (i - (f.ways - 1) / 2) * 5, y, 1.7, 0.3, "#c3c8cf", METAL, 10), on(u + (i - (f.ways - 1) / 2) * 5, y, [0.1, 0.5, 2.6], "#5c6068", METAL, 10.3)]).flat(),
      ];
    }
    case "pixel": {
      const [u, y] = f.at;
      return [on(u, y, [1.6, 5, 5], "#f2f2ee", { roughness: 0.4 }), disc(u, y, 1.9, 0.1, f.color, { emissive: f.color, emissiveIntensity: 0.9, roughness: 0.3 }, 1.6)];
    }
    case "dome": {
      const [u, y] = f.at;
      const r = f.radius;
      const half: [number, number][] = [[r, 0], ...Array.from({ length: 10 }, (_, i): [number, number] => [Math.max(0, r * Math.cos(((i + 1) / 10) * (Math.PI / 2))), r * Math.sin(((i + 1) / 10) * (Math.PI / 2))])];
      const white = { roughness: 0.4 };
      return [on(u, y, [3, r * 2, r * 2], "#f1f1ed", white), turned(u, y, 3, half, std("#f6f6f2", opacity * 0.94, { ...white, transparent: true }))];
    }
    case "matrix": {
      const [u, y] = f.at;
      const n = f.rows.length;
      const cell = f.size / n;
      const right = -face; // the reader's right, facing the module
      return [
        on(u, y, [7, f.size, f.size], "#f1f1ed", { roughness: 0.45 }),
        on(u, y, [0.1, f.size - 0.6, f.size - 0.6], "#17181b", { roughness: 0.4 }, 7),
        ...f.rows.flatMap((row, r) =>
          Array.from({ length: n }, (_, c) => {
            const lit = row[c] === "#";
            return disc(u + right * (c - (n - 1) / 2) * cell, y + ((n - 1) / 2 - r) * cell, cell * 0.36, 0.08, lit ? f.color : "#d6d2cc", lit ? { emissive: f.color, emissiveIntensity: 0.9, roughness: 0.3 } : { roughness: 0.5 }, 7.1);
          }),
        ),
      ];
    }
    case "coil": {
      const [u, y] = f.at;
      const copper = { metalness: 0.7, roughness: 0.35 };
      return [0, 1, 2].flatMap((i) => {
        const w = f.size[0] - i * 3.2;
        const h = f.size[1] - i * 3.2;
        return [on(u, y + h / 2, [0.05, 0.8, w + 0.8], "#d5d8dc", copper), on(u, y - h / 2, [0.05, 0.8, w + 0.8], "#d5d8dc", copper), on(u + w / 2, y, [0.05, h, 0.8], "#d5d8dc", copper), on(u - w / 2, y, [0.05, h, 0.8], "#d5d8dc", copper)];
      });
    }
    case "sd-slot": {
      const [u, y] = f.at;
      return [
        on(u, y, [1.9, 15, 14.5], "#c9cdd3", METAL),
        // the card, pushed in from the far edge, with its label
        on(u, y + 9.5, [0.8, 8, 11], "#17181b", { roughness: 0.45 }, 0.5),
        on(u, y + 10.5, [0.05, 4, 8], "#d93a3a", { roughness: 0.5 }, 1.3),
      ];
    }
    case "tft": {
      const [u, y] = f.at;
      const [wide, high] = f.size;
      const bars = ["#f4f4f0", "#ffd21f", "#22c7d6", "#35d04f", "#d94fd0", "#ff3b30", "#2f7bff"];
      const w = (wide - 3) / bars.length;
      return [
        on(u, y, [1.6, high, wide], "#0b0c0f", { roughness: 0.2, metalness: 0.3 }),
        ...bars.map((color, i) => on(u + (i - (bars.length - 1) / 2) * w * -face, y + 0.6, [0.05, high - 6, w], color, { emissive: color, emissiveIntensity: 0.55, roughness: 0.3 }, 1.6)),
      ];
    }
    case "shield": {
      const [u, y] = f.at;
      return [on(u, y, [2.2, f.size[1], f.size[0]], "#d6d8dc", METAL), on(u, y, [0.05, f.size[1] - 1.4, f.size[0] - 1.4], "#e4e6e9", METAL, 2.2)];
    }
    case "patch": {
      const [u, y] = f.at;
      const s = f.size;
      return [
        on(u, y, [4, s, s], "#cdbb94", { roughness: 0.6 }, 2.4),
        on(u, y, [0.08, s * 0.76, s * 0.76], "#d5d8dc", { metalness: 0.7, roughness: 0.35 }, 6.4),
        disc(u + s * 0.12, y - s * 0.1, 0.6, 0.12, "#c3c8cf", METAL, 6.4),
        // its thin cable, down to the small socket on the board
        { node: "lead", points: [[front + face * 4, y - s / 2, u - s * 0.3], [front + face * 4, y - s / 2 - 3, u - s * 0.3], [front + face * 0.6, y - s / 2 - 5, u - s * 0.3]], radius: 0.35, bend: 1.5, opacity, color: "#2a2c31" },
        disc(u - s * 0.3, y - s / 2 - 5, 1, 0.6, "#c9a24a", METAL),
      ];
    }
    case "lamp": {
      const [u, y] = f.at;
      const r = f.radius;
      const dome: [number, number][] = [[r, 0], [r, r * 0.8], ...Array.from({ length: 8 }, (_, i): [number, number] => [Math.max(0, r * Math.cos(((i + 1) / 8) * (Math.PI / 2))), r * 0.8 + r * Math.sin(((i + 1) / 8) * (Math.PI / 2))])];
      const glow = std(f.color, opacity * 0.92, { emissive: f.color, emissiveIntensity: 0.3, roughness: 0.2, transparent: true });
      return [disc(u, y, r * 1.16, 1, f.color, { emissive: f.color, emissiveIntensity: 0.3, roughness: 0.2 }), turned(u, y, 1, dome, glow)];
    }
  }
}

/**
 * The seven bars of a digit `wide` x `high`, around its middle: x to the reader's right, y up.
 * Order: a (top), b, c, d (bottom), e, f, g (middle).
 */
export function segments(wide: number, high: number): { x: number; y: number; w: number; h: number }[] {
  const t = wide * 0.2;
  const bar = (y: number) => ({ x: 0, y, w: wide - t * 1.5, h: t });
  const post = (x: number, y: number) => ({ x, y, w: t, h: high / 2 - t * 1.5 });
  return [bar(high / 2), post(wide / 2, high / 4), post(wide / 2, -high / 4), bar(-high / 2), post(-wide / 2, -high / 4), post(-wide / 2, high / 4), bar(0)];
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

/**
 * A diode lying between its two legs, each wire bent down into its hole: a plain round body with
 * the band that marks the second leg (the cathode).
 */
function diode(part: ResolvedPart, state: ItemState, v: Spec<"diode">): ShapeNode {
  const legs = legsOf(part);
  const a = legs[v.legs[0]]!;
  const b = legs[v.legs[1]]!;
  const center = mid([a, b]);
  const opacity = fade(state);
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
  const [length, R] = v.size;
  const L = Math.min(length, len * 0.75);
  const y = R + 0.7;
  return {
    node: "group",
    children: [
      { node: "lead", points: [a, [a[0], y, a[2]], [b[0], y, b[2]], b], radius: 0.3, bend: 0.9, opacity },
      group(
        [center[0], y, center[2]],
        [
          { node: "mesh", rotation: [Math.PI / 2, 0, 0], geometry: { type: "cylinder", args: [R, R, L, 28] }, pulse: true, material: std(v.body, opacity, { emissive: "#ffffff", roughness: 0.5 }) },
          { node: "mesh", rotation: [Math.PI / 2, 0, 0], position: [0, 0, L / 2 - L * 0.16], noRaycast: true, geometry: { type: "cylinder", args: [R + 0.03, R + 0.03, L * 0.16, 28] }, material: std(v.band, opacity, { roughness: 0.45 }) },
        ],
        { rotation: [0, turnTo(a, b), 0], hover: true },
      ),
    ],
  };
}

/**
 * An electrolytic capacitor: a sleeved can standing on two legs, the rubber plug under it, the
 * scored metal top, and the stripe down the side of the negative (second) leg.
 */
function canCapacitor(part: ResolvedPart, state: ItemState, v: Spec<"can-capacitor">): ShapeNode {
  const legs = legsOf(part);
  const plus = legs[v.legs[0]]!;
  const minus = legs[v.legs[1]]!;
  const center = mid([plus, minus]);
  const opacity = fade(state);
  const r = v.radius;
  const H = v.height;
  const legTop = 1.6;
  // the sleeve: tucked in at the bottom, with the groove near it and a rounded top edge
  const sleeve: [number, number][] = [[r * 0.82, 0], [r, 0.5], [r, 1.5], [r * 0.93, 1.9], [r, 2.3], [r, H - 0.5], [r * 0.9, H], [r * 0.78, H]];
  const half = 0.42; // half of the stripe's width, as an angle
  return {
    node: "group",
    children: [
      { node: "rod", from: plus, to: [plus[0], legTop + 0.4, plus[2]], opacity },
      { node: "rod", from: minus, to: [minus[0], legTop + 0.4, minus[2]], opacity },
      group(
        [center[0], legTop, center[2]],
        [
          { node: "mesh", position: [0, 0.3, 0], noRaycast: true, geometry: { type: "cylinder", args: [r * 0.84, r * 0.84, 0.6, 28] }, material: std("#17181b", opacity, { roughness: 0.8 }) },
          { node: "mesh", geometry: { type: "lathe", args: [36], points: sleeve }, pulse: true, material: std(v.color, opacity, { emissive: "#ffffff", roughness: 0.4 }) },
          // the stripe: a strip of the wall on the negative leg's side (this group's +z), with its minus signs
          { node: "mesh", position: [0, 2.4 + (H - 3.1) / 2, 0], noRaycast: true, geometry: { type: "cylinder", args: [r + 0.03, r + 0.03, H - 3.1, 16], arc: [2 * Math.PI - half, 2 * half] }, material: std(v.stripe, opacity, { roughness: 0.45 }) },
          ...[0.3, 0.5, 0.7].map((at): ShapeNode => ({ node: "mesh", position: [0, 2.4 + (H - 3.1) * at, r + 0.05], noRaycast: true, geometry: { type: "box", args: [r * 0.36, 0.28, 0.06] }, material: std("#1c1e21", opacity, { roughness: 0.6 }) })),
          // metal top with its safety score
          { node: "mesh", position: [0, H - 0.02, 0], noRaycast: true, geometry: { type: "cylinder", args: [r * 0.8, r * 0.8, 0.1, 28] }, material: std("#c9cdd3", opacity, METAL) },
          ...[0, Math.PI / 2].map((turn): ShapeNode => ({ node: "mesh", position: [0, H + 0.04, 0], rotation: [0, turn, 0], noRaycast: true, geometry: { type: "box", args: [r * 1.3, 0.03, 0.14] }, material: std("#8e9299", opacity, METAL) })),
        ],
        { rotation: [0, turnTo(plus, minus), 0], hover: true },
      ),
    ],
  };
}

/** A ceramic capacitor: a small disc with thinner edges standing on two legs, its code printed on both faces. */
function discCapacitor(part: ResolvedPart, state: ItemState, v: Spec<"disc-capacitor">): ShapeNode {
  const legs = legsOf(part);
  const a = legs[v.legs[0]]!;
  const b = legs[v.legs[1]]!;
  const center = mid([a, b]);
  const opacity = fade(state);
  const r = v.radius;
  const t = 1.1; // half of the thickness in the middle
  const y = 3 + r;
  const len = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
  const dir: Vec3 = [(b[0] - a[0]) / len, 0, (b[2] - a[2]) / len];
  const lens: [number, number][] = [[0, -t], [r * 0.72, -t], [r * 0.94, -t * 0.55], [r, 0], [r * 0.94, t * 0.55], [r * 0.72, t], [0, t]];
  const reach = Math.min(len / 2, r * 0.55);
  return {
    node: "group",
    children: [
      ...[[a, -1], [b, 1]].map(([hole, side]): ShapeNode => {
        const p = hole as Vec3;
        const s = side as number;
        return { node: "lead", points: [p, [p[0], 2, p[2]], [center[0] + dir[0] * s * reach, y - r * 0.7, center[2] + dir[2] * s * reach]], radius: 0.22, bend: 1, opacity };
      }),
      group(
        [center[0], y, center[2]],
        [
          { node: "mesh", rotation: [0, 0, Math.PI / 2], geometry: { type: "lathe", args: [32], points: lens }, pulse: true, material: std(v.color, opacity, { emissive: "#ffffff", roughness: 0.45 }) },
          ...(v.label ? [-1, 1].map((side): ShapeNode => ({ node: "mesh", position: [side * (t + 0.02), 0.2, 0], rotation: [0, side * (Math.PI / 2), 0], noRaycast: true, geometry: { type: "plane", args: [r * 1.05, r * 0.5] }, material: { kind: "basic", map: { text: v.label!, bg: v.color, fg: "#3a2a12", width: 128, height: 60 }, transparent: true, opacity } })) : []),
        ],
        { rotation: [0, turnTo(a, b), 0], hover: true },
      ),
    ],
  };
}

/**
 * A TO-220 case (a power MOSFET): a flat black body on three legs, and behind it the metal tab that
 * stands above the body with its mounting hole. The name is printed on the front; seen from the
 * front, the first leg is the left one.
 */
function to220(part: ResolvedPart, state: ItemState, v: Spec<"to220">): ShapeNode {
  const legs = legsOf(part);
  const pts = v.legs.map((id) => legs[id]!);
  const center = pts[1]!;
  const opacity = fade(state);
  const baseY = 4;
  const [deep, tall, wide] = [4.5, 9, 10];
  const metal = std(TIN, opacity, METAL);
  return {
    node: "group",
    children: [
      ...pts.map((p): ShapeNode => ({ node: "rod", from: p, to: [p[0], baseY + 0.4, p[2]], opacity })),
      group(
        [center[0], baseY, center[2]],
        [
          // the wider shoulders of the legs just under the body
          ...[-2.54, 0, 2.54].map((z): ShapeNode => ({ node: "mesh", position: [0.6, -0.9, z], noRaycast: true, geometry: { type: "box", args: [0.5, 1.8, 1.3] }, material: metal })),
          { node: "mesh", position: [0, tall / 2, 0], geometry: { type: "roundedBox", args: [deep, tall, wide, 0.3] }, pulse: true, material: std(v.color, opacity, { emissive: "#ffffff", roughness: 0.5 }) },
          // the tab: the metal back of the part, standing above the body, with its hole
          { node: "mesh", position: [deep / 2 - 0.65, tall + 3.2, 0], geometry: { type: "box", args: [1.3, 6.4, wide] }, material: metal },
          { node: "mesh", position: [deep / 2 - 0.65, tall + 3.4, 0], rotation: [0, 0, Math.PI / 2], noRaycast: true, geometry: { type: "cylinder", args: [1.8, 1.8, 1.34, 24] }, material: std("#0b0d12", opacity) },
          ...(v.label ? [{ node: "mesh", position: [-deep / 2 - 0.02, tall * 0.6, 0], rotation: [0, -Math.PI / 2, 0], noRaycast: true, geometry: { type: "plane", args: [7.6, 2] }, material: { kind: "basic", map: { text: v.label, bg: v.color, fg: "#aeb3ba", width: 212, height: 56 }, transparent: true, opacity } } as ShapeNode] : []),
        ],
        { rotation: [0, turnTo(pts[0]!, pts[2]!), 0], hover: true },
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
    case "servo": {
      // A 9 g servo standing on the mat: the case with its two mounting ears, the round gear cover
      // on top, and the white horn on the output shaft.
      const body = std(u.color, opacity * 0.93, { emissive: "#ffffff", roughness: 0.35, transparent: true });
      const white = std("#f1f1ed", opacity, { roughness: 0.45 });
      return {
        half: 16.2,
        ends: Array.from({ length: wires }, (_, i): Vec3 => [-11.2, 2.5, side(i, 1.3)]),
        nodes: [
          { node: "mesh", position: [0, 11.35, 0], geometry: { type: "roundedBox", args: [22.5, 22.7, 11.8, 0.6] }, pulse: true, material: body },
          box([0, 17, 0], [32.3, 2.4, 11.8], u.color, { roughness: 0.35 }),
          ...[-14, 14].map((x) => cyl([x, 18.25, 0], 1.1, 0.1, std("#0b0d12", opacity))),
          cyl([-5.3, 24.7, 0], 5.9, 4, std(u.color, opacity, { roughness: 0.35 })),
          cyl([1.2, 24.2, 0], 2.9, 3, std(u.color, opacity, { roughness: 0.35 })),
          cyl([-5.3, 28.2, 0], 2.4, 3, white),
          cyl([-5.3, 30.4, 0], 3.5, 1.6, white),
          box([-5.3, 30.4, 6.5], [4.6, 1.5, 15], "#f1f1ed", { roughness: 0.45 }),
        ],
      };
    }
    case "dc-motor": {
      // A small toy motor lying on the mat: the metal can, the plastic end cap with its two solder
      // tabs, and the shaft at the other end.
      const turn: Vec3 = [Math.PI / 2, 0, 0];
      return {
        half: 10,
        ends: Array.from({ length: wires }, (_, i): Vec3 => [side(i, 9), 10, 18.4]),
        nodes: [
          cyl([0, 10, 0], 10, 25, std("#c9cdd3", opacity, { emissive: "#ffffff", ...METAL }), turn, true),
          cyl([0, 10, 14.5], 9.6, 4, std("#f1f1ed", opacity, { roughness: 0.5 }), turn),
          cyl([0, 10, -13.5], 3.2, 2, metal, turn),
          cyl([0, 10, -18.5], 1, 9, metal, turn),
          ...[-1, 1].map((s) => box([s * 4.5, 10, 17.4], [1.6, 0.4, 2.4], "#c9a24a", METAL)),
        ],
      };
    }
    case "coin-motor":
      return {
        half: 5,
        ends: Array.from({ length: wires }, (_, i): Vec3 => [-4.6, 1.4, side(i, 1.4)]),
        nodes: [cyl([0, 1.35, 0], 5, 2.7, std("#c9cdd3", opacity, { emissive: "#ffffff", ...METAL }), undefined, true), cyl([0, 2.72, 0], 4.2, 0.05, std("#b5b9c0", opacity, METAL))],
      };
    case "lcd": {
      // A 16x2 character display lying face up: the board with its four holes, the black frame,
      // the lit screen and its two lines of text. The four pins are on the short side by the breadboard.
      const turn = flip ? Math.PI : 0; // keeps the text readable from the front on both sides
      const line = (text: string, z: number): ShapeNode => ({ node: "mesh", position: [0, 9.18, z], rotation: [-Math.PI / 2, 0, turn], noRaycast: true, geometry: { type: "plane", args: [60, 6] }, material: { kind: "basic", map: { text, bg: u.screen, fg: "#f4f8ff", width: 560, height: 56 }, transparent: true, opacity } });
      return {
        half: 40,
        ends: Array.from({ length: wires }, (_, i): Vec3 => [-38.5, 4.5, side(i, 2.54)]),
        nodes: [
          box([0, 0.8, 0], [80, 1.6, 36], u.board, { roughness: 0.55 }, true),
          ...[-1, 1].flatMap((x) => [-1, 1].flatMap((z): ShapeNode[] => [cyl([x * 37.5, 1.63, z * 15.5], 2.2, 0.06, metal), cyl([x * 37.5, 1.65, z * 15.5], 1.4, 0.06, std("#0b0d12", opacity))])),
          box([0, 5.1, 0], [71, 7, 24], "#17181b", { roughness: 0.45 }),
          box([0, 8.62, 0], [64.5, 0.1, 14.5], u.screen, { emissive: u.screen, emissiveIntensity: 0.45, roughness: 0.3 }),
          line(u.lines[0], (flip ? 1 : -1) * 3.3),
          line(u.lines[1], (flip ? -1 : 1) * 3.3),
          // the pin header the wires go to
          box([-38.5, 2.85, 0], [2.5, 2.5, 2.54 * wires], "#1d1f23"),
        ],
      };
    }
    case "stepper": {
      // The driver board (chip, four lamps, the white motor socket, the input pins) and, beyond it,
      // the round geared motor with its offset shaft and the blue cover where its five wires leave.
      const bx = -18;
      const mx = 20;
      const colors = ["#2f6fd6", "#e98aa0", "#f2d21b", "#f07d12", "#d93a3a"];
      return {
        half: 34,
        ends: Array.from({ length: wires }, (_, i): Vec3 => [bx - 13, 6.5, side(i, 2.54)]),
        nodes: [
          box([bx, 0.8, 0], [32, 1.6, 35], u.board, { roughness: 0.55 }),
          box([bx, 3.25, -3], [6.4, 3.3, 19.3], "#17181b"),
          ...[-1, 1].flatMap((s) => Array.from({ length: 8 }, (_, i) => box([bx + s * 3.6, 2.2, -3 + (i - 3.5) * 2.54], [0.9, 1.2, 0.5], TIN, METAL))),
          ...Array.from({ length: 4 }, (_, i) => box([bx + 9, 1.9, -8 + i * 3.4], [1.5, 0.6, 0.9], "#ff4a3d", { emissive: "#ff4a3d", emissiveIntensity: 0.4 })),
          box([bx + 11, 4.6, 9.5], [5.8, 6, 14.9], "#f1efe9", { roughness: 0.45 }),
          box([bx - 13, 2.85, 0], [2.5, 2.5, 2.54 * wires], "#1d1f23"),
          ...Array.from({ length: wires }, (_, i) => box([bx - 13, 5.2, side(i, 2.54)], [0.6, 3, 0.6], TIN, METAL)),
          // the motor
          cyl([mx, 9.5, 0], 14, 19, std("#c9cdd3", opacity, { emissive: "#ffffff", ...METAL }), undefined, true),
          box([mx, 18.6, 0], [7, 0.8, 42], "#c9cdd3", METAL),
          ...[-17.5, 17.5].map((z) => cyl([mx, 19.02, z], 2.1, 0.06, std("#0b0d12", opacity))),
          cyl([mx, 19.75, -8], 4.5, 1.5, metal),
          cyl([mx, 24.5, -8], 2.5, 8, std("#c9a24a", opacity, METAL)),
          box([mx - 15.5, 9.5, 0], [5, 12, 14.6], "#2a5fd0", { roughness: 0.4 }),
          ...colors.map((color, i): ShapeNode => ({ node: "lead", points: [[mx - 17.5, 13, (i - 2) * 1.3], [mx - 22, 16, (i - 2) * 1.3], [bx + 11, 14, 9.5 + (i - 2) * 2.5], [bx + 11, 7.4, 9.5 + (i - 2) * 2.5]], radius: 0.5, bend: 4, opacity, color })),
        ],
      };
    }
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
 * A four-leg RGB LED: a frosted dome like the single LED's, the four legs spreading out to their
 * holes under it, and inside the cup with the red, green and blue chips.
 */
function rgbLed(part: ResolvedPart, state: ItemState, v: Spec<"rgb-led">): ShapeNode {
  const legs = legsOf(part);
  const pts = v.legs.map((id) => legs[id]!);
  const center = mid(pts);
  const opacity = state === "ghost" ? 0.25 : 0.8;
  const metal = fade(state);
  const baseY = 5.2;
  const R = 2.5;
  const straight = 5.1;
  const first = pts[0]!;
  const last = pts[3]!;
  const len = Math.hypot(last[0] - first[0], last[2] - first[2]) || 1;
  const dir: Vec3 = [(last[0] - first[0]) / len, 0, (last[2] - first[2]) / len];
  const dome: [number, number][] = [[R, 0], [R, straight], ...Array.from({ length: 10 }, (_, i): [number, number] => [Math.max(0, R * Math.cos(((i + 1) / 10) * (Math.PI / 2))), straight + R * Math.sin(((i + 1) / 10) * (Math.PI / 2))])];
  const epoxy = { roughness: 0.35, transparent: true, opacity };
  const frame = std("#9aa0a8", metal, METAL);
  return {
    node: "group",
    children: [
      // under the rim the legs are only 1.1 mm apart: each one bends out to its own hole
      ...pts.map((p, i): ShapeNode => ({ node: "lead", points: [p, [p[0], 2.2, p[2]], [center[0] + dir[0] * (i - 1.5) * 1.1, baseY + 0.3, center[2] + dir[2] * (i - 1.5) * 1.1]], radius: 0.25, bend: 1.2, opacity: metal })),
      group(
        [center[0], baseY, center[2]],
        [
          { node: "mesh", position: [0, 0.5, 0], geometry: { type: "cylinder", args: [2.95, 2.95, 1, 32] }, material: { kind: "standard", color: v.body, ...epoxy } },
          { node: "mesh", position: [0, 1, 0], geometry: { type: "lathe", args: [32], points: dome }, pulse: true, material: { kind: "standard", color: v.body, emissive: "#ffffff", ...epoxy } },
          // inside: the cup on the common leg and the three chips in it
          { node: "mesh", position: [0, 2.6, 0], noRaycast: true, geometry: { type: "box", args: [0.5, 3.2, 2.6] }, material: frame },
          { node: "mesh", position: [0, 4.4, 0], noRaycast: true, geometry: { type: "cylinder", args: [1.5, 1.1, 0.6, 20] }, material: frame },
          ...(["#ff3b30", "#35d04f", "#2f7bff"] as const).map((color, i): ShapeNode => ({ node: "mesh", position: [0, 4.85, (i - 1) * 0.8], noRaycast: true, geometry: { type: "box", args: [0.6, 0.3, 0.6] }, material: std(color, metal, { emissive: color, emissiveIntensity: 0.5 }) })),
        ],
        { rotation: [0, turnTo(first, last), 0], hover: true },
      ),
    ],
  };
}

/**
 * One 7-segment digit: a light housing with a dark face, the seven bars and the dot. Its two lines
 * of pins sit on both sides of the centre channel; the digit's bottom is the first pin's line.
 */
function sevenSegment(part: ResolvedPart, state: ItemState, v: Spec<"seven-segment">): ShapeNode {
  const legs = legsOf(part);
  const pts = v.pins.filter((id) => legs[id]).map((id) => legs[id]!);
  const center = mid(pts);
  const opacity = fade(state);
  const [along, across, tall] = v.size;
  const bottom = 1.2;
  const up = Math.sign(center[0] - pts[0]![0]) || 1; // the digit's top, away from pin 1's line
  const high = across * 0.62;
  const wide = along * 0.52;
  const lit = std(v.lit, opacity, { emissive: v.lit, emissiveIntensity: 0.7, roughness: 0.4 });
  const top = tall + 0.1;
  return {
    node: "group",
    children: [
      ...pts.map((p): ShapeNode => ({ node: "rod", from: p, to: [p[0], bottom + 0.4, p[2]], opacity })),
      group(
        [center[0], bottom, center[2]],
        [
          { node: "mesh", position: [0, tall / 2, 0], geometry: { type: "roundedBox", args: [across, tall, along, 0.4] }, pulse: true, material: std(v.body, opacity, { emissive: "#ffffff", roughness: 0.5 }) },
          { node: "mesh", position: [0, tall + 0.03, 0], noRaycast: true, geometry: { type: "box", args: [across - 1, 0.08, along - 1] }, material: std(v.face, opacity, { roughness: 0.35 }) },
          // seen from above with the digit's top at `up`, the reader's right is z * up
          ...segments(wide, high).map((s): ShapeNode => ({ node: "mesh", position: [up * s.y, top, up * (s.x - along * 0.04)], noRaycast: true, geometry: { type: "box", args: [s.h, 0.08, s.w] }, material: lit })),
          { node: "mesh", position: [-up * (high / 2), top, up * (wide / 2 + along * 0.14)], noRaycast: true, geometry: { type: "cylinder", args: [wide * 0.11, wide * 0.11, 0.08, 16] }, material: lit },
        ],
        { hover: true },
      ),
    ],
  };
}

/**
 * A membrane keypad. Its plug stands in the breadboard; the flat cable runs from the plug's top down
 * to the mat and along the keypad's lower edge, and the keypad lies beside the breadboard (on the
 * side away from the centre channel) with its top row at the back, readable from the front.
 */
function keypad(part: ResolvedPart, state: ItemState, v: Spec<"keypad">): ShapeNode {
  const legs = legsOf(part);
  const pts = v.pins.filter((id) => legs[id]).map((id) => legs[id]!);
  const center = mid(pts);
  const opacity = fade(state);
  const [wide, long] = v.size;
  const out = center[0] < 0 ? -1 : 1;
  const mat = -BOARD.height;
  const kx = out * (BOARD.maxX + 6 + wide / 2) - center[0];
  const lower = -14; // the keypad's lower edge, behind the plug's row
  const kz = lower - long / 2;
  const plugTop = 13.5;
  const cable = std("#d6d6d0", opacity, { roughness: 0.6 });
  const ribbon = 2.54 * pts.length * 0.55;
  const rows = v.keys.length;
  const cols = Math.max(...v.keys.map((r) => r.length), 1);
  const padX = (wide - 9) / cols;
  const padZ = (long - 17) / rows;
  const slope: Vec3 = [kx - out * 1.4, mat + 0.3 - plugTop, 0];
  return {
    node: "group",
    children: [
      ...pts.map((p): ShapeNode => ({ node: "rod", from: p, to: [p[0], 3, p[2]], opacity })),
      group(
        [center[0], 0, center[2]],
        [
          // the plug on the cable's end
          { node: "mesh", position: [0, 8, 0], geometry: { type: "box", args: [2.6, 11, 2.54 * pts.length] }, material: std("#1d1f23", opacity, { roughness: 0.6 }) },
          // the cable: down from the plug to the mat, then back along the mat to the keypad's lower edge
          { node: "mesh", position: [out * 1.4 + slope[0] / 2, plugTop + slope[1] / 2, 0], rotation: [0, 0, Math.atan2(slope[1], slope[0])], noRaycast: true, geometry: { type: "box", args: [Math.hypot(slope[0], slope[1]), 0.3, ribbon] }, material: cable },
          { node: "mesh", position: [kx, mat + 0.3, (lower + ribbon / 2) / 2], noRaycast: true, geometry: { type: "box", args: [ribbon, 0.3, ribbon / 2 - lower] }, material: cable },
          { node: "mesh", position: [kx, mat + 0.5, kz], geometry: { type: "box", args: [wide, 1, long] }, pulse: true, material: std(v.body, opacity, { emissive: "#ffffff", roughness: 0.55 }) },
          ...v.keys.flatMap((row, r) =>
            row.flatMap((text, c): ShapeNode[] => {
              const x = kx + (c - (cols - 1) / 2) * padX;
              const z = kz + 3 + (r - (rows - 1) / 2) * padZ;
              const color = /^\d$/.test(text) ? v.key : v.accent;
              return [
                { node: "mesh", position: [x, mat + 1.12, z], noRaycast: true, geometry: { type: "roundedBox", args: [padX * 0.8, 0.5, padZ * 0.74, 0.2] }, material: std(color, opacity, { roughness: 0.5 }) },
                { node: "mesh", position: [x, mat + 1.4, z], rotation: [-Math.PI / 2, 0, 0], noRaycast: true, geometry: { type: "plane", args: [padZ * 0.5, padZ * 0.5] }, material: { kind: "basic", map: { text, bg: color, fg: "#ffffff", width: 64, height: 64 }, transparent: true, opacity } },
              ];
            }),
          ),
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
