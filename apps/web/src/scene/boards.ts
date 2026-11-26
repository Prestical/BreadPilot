// 3D models of microcontroller boards that BreadPilot doesn't support yet (PLAN §13.9: board packs,
// the ESP32 after the Pico; the other Picos beside the Pico 2 W the workbench already draws; an
// Arduino Nano type board), in the parts' house style: plain data in millimetres, simple geometry,
// no model or image files. Only the look is here. Pin names and what each pin can do are hardware
// facts and come later from the official documents, with the board pack.
// No size here is measured: they are the usual sizes of these boards.
import type { Column } from "@breadpilot/circuit-core";
import { PITCH, colX, rowZ, type Vec3 } from "./coords";
import { METAL, TIN, fade, std, type ItemState, type Material, type ShapeNode } from "./shapes";

/** One thing on a board's top. `at` = [across, along] in mm from the board's middle; the USB end is at -along. */
export type BoardFeature =
  /** A radio module: its own small board, the metal shield with the printed name, and the antenna at the far end. */
  | { type: "module"; at: [number, number]; size: [number, number]; antenna: number; label: string }
  /** A USB socket looking out over the board's edge. */
  | { type: "usb"; at: [number, number]; kind: "micro" | "mini" | "c" }
  /** A small push button. */
  | { type: "button"; at: [number, number] }
  /** A flat black chip, with an optional printed name; `turned` = set at 45 degrees, with legs on all four sides. */
  | { type: "chip"; at: [number, number]; size: [number, number]; label?: string; turned?: boolean }
  /** A voltage regulator with its metal tab. */
  | { type: "regulator"; at: [number, number] }
  | { type: "led"; at: [number, number]; color: string; size?: number }
  /** A small ceramic antenna. */
  | { type: "antenna"; at: [number, number]; color: string }
  /** A metal crystal; `size` = across, along (mm) for a larger one. */
  | { type: "crystal"; at: [number, number]; size?: [number, number] }
  /** A block of pins standing up from the board; `size` = pins across, pins along. */
  | { type: "pins"; at: [number, number]; size: [number, number] }
  /** A small capacitor or resistor. */
  | { type: "passive"; at: [number, number]; color?: string }
  /** The white-and-cream BOOTSEL button of a Pico. */
  | { type: "bootsel"; at: [number, number] }
  /** A white plastic connector; `size` = across, along (mm). */
  | { type: "connector"; at: [number, number]; size: [number, number] }
  /** A flat metal shield over a radio; `size` = across, along (mm). */
  | { type: "shield"; at: [number, number]; size: [number, number] }
  /** Bare gold copper on the board (an antenna, a pad); `size` = across, along (mm). */
  | { type: "trace"; at: [number, number]; size: [number, number] }
  /** Printed text; `size` = how long it is on the board (mm). */
  | { type: "text"; at: [number, number]; text: string; size: number };

export interface BoardModel {
  id: string;
  name: string;
  /** The board: across, along (mm). */
  size: [number, number];
  /** Pins on each long side. */
  pinsPerSide: number;
  /** The breadboard columns its two pin lines stand in. */
  cols: [Column, Column];
  /** From the board's middle to the middle of the pin lines, along the board (mm; negative = toward USB). */
  pinsAt?: number;
  pcb: string;
  /** Plated mounting holes in the four corners. */
  holes?: boolean;
  /** Or: four plated mounting holes this far from the board's middle (across, along; mm). */
  holeAt?: [number, number];
  features: BoardFeature[];
  note: string;
}

const NOTE = "Not measured: the usual size and layout of this board.";
const BLACK = "#1b1d21";
const GOLD = "#d8ae3c";

const GREEN_PCB = "#2f9a4b";

/**
 * A Raspberry Pi Pico in the layout of the workbench's Pico 2 W (scene/Pico.tsx): the same board
 * outline and pin holes for all four; `chip` is the name printed on the processor, and a board
 * with `wireless` has the metal shield, the antenna at the far end and the white debug connector,
 * while one without has three debug pads on the far edge instead.
 */
function pico(id: string, name: string, chip: string, wireless: boolean): BoardModel {
  return {
    id,
    name,
    size: [21, 51],
    pinsPerSide: 20,
    cols: ["c", "h"],
    pcb: GREEN_PCB,
    holeAt: [5.7, 23.5],
    features: [
      { type: "usb", at: [0, -23.3], kind: "micro" },
      { type: "led", at: [wireless ? 6 : -6, -23], color: wireless ? "#f4f1e6" : "#35d04f" },
      { type: "bootsel", at: [-3.6, -11.5] },
      { type: "chip", at: [4, -12.5], size: [2.8, 2.8] },
      { type: "chip", at: [4, -8.2], size: [2.6, 2.6] },
      { type: "passive", at: [0.4, -9.5] },
      { type: "passive", at: [0.4, -7.6] },
      { type: "text", at: [0, -5], text: name.replace("Raspberry Pi ", ""), size: wireless ? 9 : 7 },
      { type: "chip", at: [0, wireless ? -0.5 : 3], size: [7, 7], label: chip },
      { type: "crystal", at: [-5, wireless ? 6.2 : 10] },
      ...(wireless
        ? ([
            { type: "connector", at: [0, 5.4], size: [5.4, 2.6] },
            { type: "shield", at: [0, 13.2], size: [11, 10] },
            { type: "trace", at: [0, 21.4], size: [5, 2.2] },
          ] as BoardFeature[])
        : ([-2.54, 0, 2.54].map((x) => ({ type: "trace", at: [x, 24.3], size: [1.5, 1.5] })) as BoardFeature[])),
    ],
    note: NOTE,
  };
}

export const BOARD_MODELS: BoardModel[] = [
  pico("pico", "Raspberry Pi Pico", "RP2040", false),
  pico("pico-w", "Raspberry Pi Pico W", "RP2040", true),
  pico("pico-2", "Raspberry Pi Pico 2", "RP2350", false),
  {
    // After the shop photo (robotistan.com, product 24304): a blue Nano-type board with the square
    // chip set on its corner, a tall crystal, the reset button, a regulator and the 2 x 3 pin block
    // at the far end. The page says the USB socket is mini-USB or USB-C depending on the batch.
    id: "arduino-nano",
    name: "Arduino Nano V3 type (CH340)",
    size: [18, 45],
    pinsPerSide: 15,
    cols: ["d", "h"],
    pcb: "#1d3c8f",
    features: [
      { type: "usb", at: [0, -18.2], kind: "mini" },
      ...[-4.5, -1.5, 1.5, 4.5].map((x, i): BoardFeature => ({ type: "led", at: [x, -11.5], color: i === 0 ? "#ff4a3d" : i === 3 ? "#35d04f" : "#ffd21f" })),
      { type: "chip", at: [0, -1.5], size: [7, 7], turned: true },
      { type: "regulator", at: [-2.8, 7.2] },
      { type: "crystal", at: [3.6, 9.4], size: [4.4, 10.6] },
      { type: "button", at: [-3, 13.2] },
      { type: "pins", at: [0, 19.6], size: [3, 2] },
    ],
    note: NOTE,
  },
  {
    id: "esp32-devkit-v1",
    name: "ESP32 DevKit V1 (30 pins)",
    size: [28, 51.5],
    pinsPerSide: 15,
    cols: ["a", "i"],
    pinsAt: -4,
    pcb: BLACK,
    holes: true,
    features: [
      { type: "module", at: [0, 13], size: [18, 25.5], antenna: 6.2, label: "ESP32-WROOM-32" },
      { type: "usb", at: [0, -23.2], kind: "micro" },
      { type: "button", at: [-8.5, -21] },
      { type: "button", at: [8.5, -21] },
      { type: "text", at: [-8.5, -17.6], text: "EN", size: 3.4 },
      { type: "text", at: [8.5, -17.6], text: "BOOT", size: 4.6 },
      { type: "chip", at: [0, -13], size: [5, 5] },
      { type: "regulator", at: [-7.5, -9] },
      { type: "led", at: [7, -11.5], color: "#ff4a3d" },
      { type: "led", at: [7, -8.5], color: "#3d8bff" },
      { type: "passive", at: [3.5, -7] },
      { type: "passive", at: [-2.5, -7] },
    ],
    note: NOTE,
  },
  {
    id: "esp32-devkitc-v4",
    name: "ESP32-DevKitC (38 pins)",
    size: [27.9, 54.4],
    pinsPerSide: 19,
    cols: ["a", "i"],
    pinsAt: -2,
    pcb: BLACK,
    features: [
      { type: "module", at: [0, 14.4], size: [18, 25.5], antenna: 6.2, label: "ESP32-WROOM-32E" },
      { type: "usb", at: [0, -24.6], kind: "micro" },
      { type: "button", at: [-8.8, -23] },
      { type: "button", at: [8.8, -23] },
      { type: "text", at: [-8.8, -19.6], text: "EN", size: 3.4 },
      { type: "text", at: [8.8, -19.6], text: "BOOT", size: 4.6 },
      { type: "chip", at: [1.5, -13.5], size: [5, 5] },
      { type: "regulator", at: [-6.5, -10] },
      { type: "led", at: [7.5, -8.5], color: "#ff4a3d" },
      { type: "passive", at: [4, -7.5] },
      { type: "passive", at: [-1, -7.5] },
      { type: "passive", at: [-6, -15.5] },
    ],
    note: NOTE,
  },
  {
    id: "esp32-s3-devkitc-1",
    name: "ESP32-S3-DevKitC-1",
    size: [25.5, 63],
    pinsPerSide: 22,
    cols: ["a", "h"],
    pinsAt: -2.5,
    pcb: BLACK,
    features: [
      { type: "module", at: [0, 18.7], size: [18, 25.5], antenna: 6.2, label: "ESP32-S3-WROOM-1" },
      { type: "usb", at: [-5.6, -27.9], kind: "c" },
      { type: "usb", at: [5.6, -27.9], kind: "c" },
      { type: "text", at: [-5.6, -22.6], text: "USB", size: 4.2 },
      { type: "text", at: [5.6, -22.6], text: "UART", size: 4.8 },
      { type: "button", at: [-7.6, -17.5] },
      { type: "button", at: [7.6, -17.5] },
      { type: "text", at: [-7.6, -14], text: "BOOT", size: 4.6 },
      { type: "text", at: [7.6, -14], text: "RST", size: 3.8 },
      { type: "chip", at: [0, -15.5], size: [4, 4] },
      { type: "regulator", at: [-5.5, -8.5] },
      { type: "led", at: [6.5, -8], color: "#f4f6f8", size: 2 },
      { type: "led", at: [1, -9.5], color: "#35d04f" },
      { type: "passive", at: [1.5, -6.5] },
    ],
    note: NOTE,
  },
  {
    id: "esp32-c3-supermini",
    name: "ESP32-C3 SuperMini",
    size: [18, 22.5],
    pinsPerSide: 8,
    cols: ["d", "h"],
    pcb: BLACK,
    features: [
      { type: "usb", at: [0, -8.4], kind: "c" },
      { type: "chip", at: [0, 2.6], size: [5, 5], label: "ESP32-C3" },
      { type: "antenna", at: [3.6, 9.4], color: "#c8402f" },
      { type: "crystal", at: [-3.8, 8.6] },
      { type: "button", at: [-4.9, -2.2] },
      { type: "button", at: [4.9, -2.2] },
      { type: "led", at: [-5.4, 3.2], color: "#3d8bff" },
      { type: "passive", at: [5.2, 3.6] },
      { type: "passive", at: [-1.5, 7.6] },
    ],
    note: NOTE,
  },
];

const PCB_Y = 3;
const PCB_T = 1.2;
const TOP = PCB_Y + PCB_T / 2;

/** Where the board stands: its middle, and every pin with the hole it is in (pin lines from `firstRow` down). */
export function boardPlace(b: BoardModel, firstRow = 1): { center: Vec3; pins: Vec3[] } {
  const x = b.cols.map(colX) as [number, number];
  const rows = Array.from({ length: b.pinsPerSide }, (_, i) => firstRow + i);
  const pinsZ = (rowZ(rows[0]!) + rowZ(rows.at(-1)!)) / 2;
  return { center: [(x[0] + x[1]) / 2, 0, pinsZ - (b.pinsAt ?? 0)], pins: x.flatMap((px) => rows.map((r): Vec3 => [px, 0, rowZ(r)])) };
}

/** The board as shape nodes, standing in the breadboard with its USB end toward row 1. */
export function boardShapes(b: BoardModel, state: ItemState, firstRow = 1): ShapeNode {
  const opacity = fade(state);
  const { center, pins } = boardPlace(b, firstRow);
  const [wide, long] = b.size;
  const holeAt = b.holeAt ?? (b.holes ? ([wide / 2 - 2.3, long / 2 - 2.3] as [number, number]) : undefined);
  const pinsZ = (pins[0]![2] + pins[b.pinsPerSide - 1]![2]) / 2;
  const metal = std(TIN, opacity, METAL);
  const gold = std(GOLD, opacity, { metalness: 0.9, roughness: 0.3 });
  const part = (at: Vec3, args: [number, number, number], color: string, extra: Partial<Material> = {}): ShapeNode => ({ node: "mesh", position: at, noRaycast: true, geometry: { type: "box", args }, material: std(color, opacity, { roughness: 0.5, ...extra }) });
  const round = (at: Vec3, r: number, h: number, material: Material): ShapeNode => ({ node: "mesh", position: at, noRaycast: true, geometry: { type: "cylinder", args: [r, r, h, 20] }, material });
  /** Text lying on a surface, readable from the front (the far end of the board). */
  const print = (at: Vec3, text: string, size: [number, number], bg: string, fg: string): ShapeNode => ({ node: "mesh", position: at, rotation: [-Math.PI / 2, 0, 0], noRaycast: true, geometry: { type: "plane", args: size }, material: { kind: "basic", map: { text, bg, fg, width: Math.round((size[0] / size[1]) * 56), height: 56 }, transparent: true, opacity } });

  const feature = (f: BoardFeature): ShapeNode[] => {
    const [x, z] = f.at;
    switch (f.type) {
      case "module": {
        const [w, l] = f.size;
        const shield = l - f.antenna - 1.2;
        const shieldZ = z - l / 2 + 0.6 + shield / 2;
        const antZ = z + l / 2 - f.antenna / 2;
        // the antenna: a gold line that snakes across the bare end of the module
        const bars = 4;
        const step = (f.antenna - 1.6) / (bars - 1);
        const aw = w - 4;
        const line = (at: Vec3, args: [number, number, number]) => part(at, args, GOLD, { metalness: 0.8, roughness: 0.35 });
        return [
          part([x, TOP + 0.4, z], [w, 0.8, l], "#17181b"),
          { node: "mesh", position: [x, TOP + 0.8 + 1.15, shieldZ], noRaycast: true, geometry: { type: "roundedBox", args: [w - 2, 2.3, shield, 0.3] }, material: std("#cfd2d7", opacity, METAL) },
          print([x, TOP + 3.12, shieldZ], f.label, [w - 4, (w - 4) / 7], "#cfd2d7", "#3a3d43"),
          // the module's solder pads along both sides
          ...[-1, 1].map((side) => part([x + side * (w / 2 - 0.25), TOP + 0.42, shieldZ], [0.5, 0.82, shield - 2], GOLD, { metalness: 0.9, roughness: 0.3 })),
          ...Array.from({ length: bars }, (_, i) => line([x, TOP + 0.83, antZ - (f.antenna - 1.6) / 2 + i * step], [aw, 0.05, 0.4])),
          ...Array.from({ length: bars - 1 }, (_, i) => line([x + (i % 2 ? -1 : 1) * (aw / 2 - 0.2), TOP + 0.83, antZ - (f.antenna - 1.6) / 2 + (i + 0.5) * step], [0.4, 0.05, step + 0.4])),
        ];
      }
      case "usb":
        return f.kind === "micro"
          ? [part([x, TOP + 1.3, z], [8, 2.6, 5.6], "#c9ccd1", METAL), part([x, TOP + 1.25, z - 2.82], [6.4, 1.3, 0.2], "#15171a")]
          : f.kind === "mini"
            ? [part([x, TOP + 1.95, z], [7.7, 3.9, 9.2], "#c9ccd1", METAL), part([x, TOP + 1.95, z - 4.62], [6.2, 2.3, 0.2], "#15171a")]
            : [
              { node: "mesh", position: [x, TOP + 1.6, z], noRaycast: true, geometry: { type: "roundedBox", args: [8.9, 3.2, 7.3, 1.3] }, material: std("#c9ccd1", opacity, METAL) },
              { node: "mesh", position: [x, TOP + 1.6, z - 3.6], noRaycast: true, geometry: { type: "roundedBox", args: [7.4, 1.7, 0.3, 0.8] }, material: std("#15171a", opacity, { roughness: 0.6 }) },
            ];
      case "button":
        return [part([x, TOP + 0.75, z], [3.2, 1.5, 4.2], "#c9ccd1", METAL), round([x, TOP + 1.75, z], 0.9, 0.6, std("#15171a", opacity, { roughness: 0.5 }))];
      case "chip":
        if (f.turned) {
          // a square chip set on its corner, with a row of legs under each of its four sides
          const turn: Vec3 = [0, Math.PI / 4, 0];
          const legs = (w: number, l: number): ShapeNode => ({ node: "mesh", position: [x, TOP + 0.2, z], rotation: turn, noRaycast: true, geometry: { type: "box", args: [w, 0.4, l] }, material: metal });
          return [legs(f.size[0] + 1.8, f.size[1] - 1.6), legs(f.size[0] - 1.6, f.size[1] + 1.8), { node: "mesh", position: [x, TOP + 0.5, z], rotation: turn, noRaycast: true, geometry: { type: "box", args: [f.size[0], 1, f.size[1]] }, material: std("#1c1e21", opacity, { roughness: 0.5 }) }];
        }
        return [part([x, TOP + 0.45, z], [f.size[0], 0.9, f.size[1]], "#1c1e21"), ...(f.label ? [print([x, TOP + 0.92, z], f.label, [f.size[0] * 0.9, f.size[0] * 0.2], "#1c1e21", "#8f959c")] : [])];
      case "regulator":
        return [part([x, TOP + 0.8, z], [3.6, 1.6, 6.5], "#1c1e21"), part([x - 2.6, TOP + 0.3, z], [1.6, 0.6, 3.2], TIN, METAL), ...[-2.3, 0, 2.3].map((d) => part([x + 2.5, TOP + 0.25, z + d], [1.4, 0.5, 0.8], TIN, METAL))];
      case "led": {
        const s = f.size ?? 1;
        return [part([x, TOP + 0.3 * s, z], [0.9 * s, 0.6 * s, 1.5 * s], f.color, { emissive: f.color, emissiveIntensity: 0.4, roughness: 0.3 })];
      }
      case "antenna":
        return [part([x, TOP + 0.5, z], [5.2, 1, 1.9], f.color), ...[-1, 1].map((side) => part([x + side * 2.75, TOP + 0.5, z], [0.4, 1.02, 1.92], TIN, METAL))];
      case "crystal":
        return f.size
          ? [part([x, TOP + 0.2, z], [f.size[0] + 0.8, 0.4, f.size[1] + 0.8], TIN, METAL), { node: "mesh", position: [x, TOP + 1.9, z], noRaycast: true, geometry: { type: "roundedBox", args: [f.size[0], 3.4, f.size[1], f.size[0] / 2 - 0.1] }, material: metal }]
          : [{ node: "mesh", position: [x, TOP + 0.45, z], noRaycast: true, geometry: { type: "roundedBox", args: [2.6, 0.9, 3.3, 0.3] }, material: metal }];
      case "pins":
        return [
          part([x, TOP + 1.25, z], [f.size[0] * PITCH, 2.5, f.size[1] * PITCH], "#1d1f23"),
          ...Array.from({ length: f.size[0] * f.size[1] }, (_, i) => part([x + ((i % f.size[0]) - (f.size[0] - 1) / 2) * PITCH, TOP + 5.5, z + (Math.floor(i / f.size[0]) - (f.size[1] - 1) / 2) * PITCH], [0.64, 6, 0.64], GOLD, { metalness: 0.9, roughness: 0.3 })),
        ];
      case "passive":
        return [part([x, TOP + 0.3, z], [1.6, 0.6, 0.9], f.color ?? "#c8a46a"), ...[-1, 1].map((side) => part([x + side * 0.75, TOP + 0.3, z], [0.3, 0.62, 0.92], TIN, METAL))];
      case "bootsel":
        return [part([x, TOP + 0.6, z], [3.6, 1.2, 4.2], "#eceae4", { roughness: 0.4 }), round([x, TOP + 1.5, z], 1.25, 0.8, std("#efe3c8", opacity, { roughness: 0.35 }))];
      case "connector":
        return [part([x, TOP + 1.1, z], [f.size[0], 2.2, f.size[1]], "#f1efe9", { roughness: 0.45 })];
      case "shield":
        return [part([x, TOP + 0.7, z], [f.size[0], 1.4, f.size[1]], "#d6d8dc", METAL), part([x, TOP + 1.42, z], [f.size[0] - 1.4, 0.05, f.size[1] - 1.4], "#e4e6e9", METAL)];
      case "trace":
        return [part([x, TOP + 0.03, z], [f.size[0], 0.05, f.size[1]], GOLD, { metalness: 0.9, roughness: 0.3 })];
      case "text":
        return [print([x, TOP + 0.02, z], f.text, [f.size, f.size * 0.36 + 0.5], b.pcb, "#e9ecef")];
    }
  };

  return {
    node: "group",
    children: [
      // black plastic header strips that sit on the breadboard
      ...b.cols.map((col): ShapeNode => ({ node: "mesh", position: [colX(col), 1.25, pinsZ], noRaycast: true, geometry: { type: "box", args: [PITCH, 2.5, PITCH * b.pinsPerSide] }, material: std("#1d1f23", opacity) })),
      // every pin: a gold pad on the board and the soldered pin end
      ...pins.flatMap((p): ShapeNode[] => [round([p[0], TOP + 0.03, p[2]], 0.95, 0.06, gold), { node: "mesh", position: [p[0], TOP + 0.28, p[2]], noRaycast: true, geometry: { type: "cylinder", args: [0.3, 0.45, 0.5, 10] }, material: metal }]),
      {
        node: "group",
        position: [center[0], 0, center[2]],
        hover: true,
        children: [
          { node: "mesh", position: [0, PCB_Y, 0], geometry: { type: "box", args: [wide, PCB_T, long] }, pulse: true, material: std(b.pcb, opacity, { emissive: "#ffffff", roughness: 0.55 }) },
          ...(holeAt ? [-1, 1].flatMap((sx) => [-1, 1].flatMap((sz): ShapeNode[] => [round([sx * holeAt[0], TOP + 0.03, sz * holeAt[1]], 1.9, 0.06, gold), round([sx * holeAt[0], TOP + 0.05, sz * holeAt[1]], 1.1, 0.06, std("#0b0d12", opacity))])) : []),
          ...b.features.flatMap(feature),
        ],
      },
    ],
  };
}
