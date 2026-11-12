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
  | { type: "cylinder"; args: [number, number, number, number] }
  | { type: "sphere"; args: [number, number, number, number, number, number, number] }
  | { type: "capsule"; args: [number, number, number, number] }
  | { type: "plane"; args: [number, number] };

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
  | { node: "light"; color: string; intensity: number; distance: number }
  | { node: "group"; position?: Vec3; rotation?: Vec3; hover?: boolean; children: ShapeNode[] };

const BAND_HEX: Record<string, string> = {
  black: "#111", brown: "#7a4a1d", red: "#d32020", orange: "#f07d12", yellow: "#f2d21b", green: "#2ca53b",
  blue: "#2457d6", violet: "#8a3fd1", grey: "#8c8c8c", white: "#f5f5f5", gold: "#c9a227",
};

const legsOf = (part: ResolvedPart) => Object.fromEntries(Object.entries(part.legs).map(([id, h]) => [id, holePos(h)])) as Record<string, Vec3>;
const mid = (pts: Vec3[]): Vec3 => pts.reduce<Vec3>((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]);
const group = (position: Vec3, children: ShapeNode[], extra: { rotation?: Vec3; hover?: boolean } = {}): ShapeNode => ({ node: "group", position, ...extra, children });

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
    default:
      return generic(part, state);
  }
}

function led(part: ResolvedPart, state: ItemState, lit: boolean, v: Spec<"led-dome">): ShapeNode {
  const legs = legsOf(part);
  const [anode, cathode] = v.legs;
  // An unknown colour shows as the first one listed (red for the LED).
  const color = v.colors[String(part.props[v.colorProp])] ?? Object.values(v.colors)[0]!;
  const center = mid([legs[anode]!, legs[cathode]!]);
  const opacity = state === "ghost" ? 0.25 : 0.85;
  const rod = state === "ghost" ? 0.3 : 1;
  const bodyY = 7;
  return {
    node: "group",
    children: [
      { node: "rod", from: [legs[anode]![0], 0, legs[anode]![2]], to: [legs[anode]![0], bodyY - 2.5, legs[anode]![2]], opacity: rod },
      { node: "rod", from: [legs[cathode]![0], 0, legs[cathode]![2]], to: [legs[cathode]![0], bodyY - 2.5, legs[cathode]![2]], opacity: rod },
      group(
        [center[0], bodyY, center[2]],
        [
          { node: "mesh", geometry: { type: "cylinder", args: [2.5, 2.5, 5, 24] }, pulse: true, material: { kind: "standard", color, emissive: lit ? color : "#ffffff", emissiveIntensity: lit ? 2 : 0, transparent: true, opacity, roughness: 0.2 } },
          { node: "mesh", position: [0, 2.5, 0], geometry: { type: "sphere", args: [2.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2] }, material: { kind: "standard", color, emissive: color, emissiveIntensity: lit ? 2 : 0, transparent: true, opacity, roughness: 0.2 } },
          // rim
          { node: "mesh", position: [0, -2.5, 0], geometry: { type: "cylinder", args: [2.9, 2.9, 0.8, 24] }, material: { kind: "standard", color, transparent: true, opacity } },
          // inside the clear epoxy, like a real LED: the reflector cup holding the chip and the thin post
          { node: "mesh", position: [0.6, -0.4, 0], noRaycast: true, geometry: { type: "box", args: [1.5, 1.4, 0.5] }, material: { kind: "standard", color: "#8d939b", metalness: 0.8, roughness: 0.35, transparent: true, opacity: opacity * 0.9 } },
          { node: "mesh", position: [-0.7, -0.6, 0], noRaycast: true, geometry: { type: "box", args: [0.5, 1, 0.4] }, material: { kind: "standard", color: "#8d939b", metalness: 0.8, roughness: 0.35, transparent: true, opacity: opacity * 0.9 } },
          ...(lit ? [{ node: "light", color, intensity: 40, distance: 30 } as ShapeNode] : []),
        ],
        { hover: true },
      ),
    ],
  };
}

/** A two-legged part lying flat between its legs, with colour bands from a prop (a resistor). */
function axial(part: ResolvedPart, state: ItemState, v: Spec<"axial">): ShapeNode {
  const legs = legsOf(part);
  const a = legs[v.legs[0]]!;
  const b = legs[v.legs[1]]!;
  const y = 2.6;
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dz);
  const angle = Math.atan2(dx, dz);
  const center = mid([a, b]);
  const bodyLen = Math.min(6.3, len * 0.75);
  const bands = resistorBands(Number(part.props[v.bandsProp]));
  const opacity = state === "ghost" ? 0.3 : 1;
  const t = opacity < 1;
  return {
    node: "group",
    children: [
      { node: "rod", from: a, to: [a[0], y, a[2]], opacity },
      { node: "rod", from: b, to: [b[0], y, b[2]], opacity },
      { node: "rod", from: [a[0], y, a[2]], to: [b[0], y, b[2]], opacity },
      group(
        [center[0], y, center[2]],
        [
          { node: "mesh", rotation: [Math.PI / 2, 0, 0], geometry: { type: "capsule", args: [1.1, bodyLen - 2.2, 6, 16] }, pulse: true, material: { kind: "standard", color: v.body, emissive: "#ffffff", transparent: t, opacity } },
          ...bands.map(
            (band, i): ShapeNode => ({
              node: "mesh",
              rotation: [Math.PI / 2, 0, 0],
              position: [0, 0, -bodyLen / 2 + 1.1 + i * ((bodyLen - 1.6) / 4) + (i === 3 ? 0.6 : 0)],
              geometry: { type: "cylinder", args: [1.16, 1.16, 0.45, 16] },
              material: { kind: "standard", color: BAND_HEX[band]!, transparent: t, opacity },
            }),
          ),
        ],
        { rotation: [0, angle, 0], hover: true },
      ),
    ],
  };
}

/** A 6 mm tactile switch: black body, metal top plate with corner tabs, round plunger. */
function button(part: ResolvedPart, state: ItemState, v: Spec<"tact-button">): ShapeNode {
  const legs = legsOf(part);
  const center = mid(Object.values(legs));
  const opacity = state === "ghost" ? 0.3 : 1;
  const t = opacity < 1;
  const plate = v.plate ?? "#c3c8cf";
  const metal = { kind: "standard" as const, color: plate, metalness: 0.85, roughness: 0.3, transparent: t, opacity };
  return {
    node: "group",
    children: [
      ...Object.values(legs).map((p): ShapeNode => ({ node: "rod", from: p, to: [p[0], 1.2, p[2]], opacity })),
      group(
        [center[0], 0, center[2]],
        [
          { node: "mesh", position: [0, 2, 0], geometry: { type: "box", args: [6, 3.4, 6] }, pulse: true, material: { kind: "standard", color: v.body, emissive: "#ffffff", roughness: 0.6, transparent: t, opacity } },
          // metal plate on top, bent down at the four sides like the real part
          { node: "mesh", position: [0, 3.82, 0], geometry: { type: "box", args: [6.2, 0.25, 6.2] }, material: metal },
          ...([[-1, 0], [1, 0], [0, -1], [0, 1]] as const).map(
            ([x, z]): ShapeNode => ({ node: "mesh", position: [x * 3.05, 3.1, z * 3.05], geometry: { type: "box", args: [x ? 0.2 : 2.2, 1.3, z ? 0.2 : 2.2] }, material: metal }),
          ),
          // plunger: a short collar and the round cap you press
          { node: "mesh", position: [0, 4.1, 0], geometry: { type: "cylinder", args: [1.9, 1.9, 0.4, 28] }, material: { kind: "standard", color: v.body, roughness: 0.5, transparent: t, opacity } },
          { node: "mesh", position: [0, 4.85, 0], geometry: { type: "cylinder", args: [1.6, 1.7, 1.3, 28] }, material: { kind: "standard", color: v.cap, roughness: 0.45, transparent: t, opacity } },
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
          ...(v.screen
            ? [
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
