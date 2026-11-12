// Surfaces drawn on a canvas at run time (no image files, works offline): the breadboard's printed
// top, the desk's wood and the cutting mat. The layout numbers are plain functions (`boardPrint`,
// `matLines`) so they can be tested without a canvas.
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import { BREADBOARD, RAIL_IDS, type Column } from "@breadpilot/circuit-core";
import { BOARD, colX, PITCH, railX, ROWS, rowZ } from "./coords";

const COLUMNS = BREADBOARD.columns as Column[];

/** Small repeatable random numbers (the same wood every time). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BoardPrint {
  /** Row numbers and column letters, in board millimetres (x across, z along). */
  texts: { text: string; x: number; z: number; align: "left" | "right" | "center"; color: string }[];
  /** Rail lines and the seams between the rail strips and the main area. */
  lines: { x: number; z0: number; z1: number; width: number; color: string }[];
}

export const PRINT = { ink: "#5d6470", red: "#d93a3a", blue: "#2f6fd6", seam: "#d5d1c5" };

/** What is printed on a real 830-point board: row numbers every 5 rows, a-j, rail lines, + and −. */
export function boardPrint(): BoardPrint {
  const texts: BoardPrint["texts"] = [];
  const lines: BoardPrint["lines"] = [];
  const numbered = Array.from({ length: ROWS }, (_, i) => i + 1).filter((r) => r === 1 || r % 5 === 0);
  for (const row of numbered) {
    texts.push({ text: String(row), x: colX("a") - PITCH * 0.62, z: rowZ(row), align: "right", color: PRINT.ink });
    texts.push({ text: String(row), x: colX("j") + PITCH * 0.62, z: rowZ(row), align: "left", color: PRINT.ink });
  }
  for (const col of COLUMNS) for (const z of [rowZ(0) + PITCH * 0.12, rowZ(ROWS + 1) - PITCH * 0.12]) texts.push({ text: col, x: colX(col), z, align: "center", color: PRINT.ink });
  for (const rail of RAIL_IDS) {
    // Coloured line on the outer side of the outer rail and the inner side of the inner rail.
    const left = rail.startsWith("RL");
    const plus = rail.endsWith("+");
    const color = plus ? PRINT.red : PRINT.blue;
    lines.push({ x: railX(rail) + PITCH * 0.5 * (left ? (plus ? 1 : -1) : plus ? -1 : 1), z0: rowZ(1) - PITCH * 0.4, z1: rowZ(ROWS) + PITCH * 0.4, width: 0.4, color });
    for (const z of [rowZ(0) + PITCH * 0.12, rowZ(ROWS + 1) - PITCH * 0.12]) texts.push({ text: plus ? "+" : "−", x: railX(rail), z, align: "center", color });
  }
  // The rail strips are separate pieces: a fine seam on each side of the main area.
  for (const x of [colX("a") - PITCH * 1.75, colX("j") + PITCH * 1.75]) lines.push({ x, z0: BOARD.minZ, z1: BOARD.maxZ, width: 0.18, color: PRINT.seam });
  return { texts, lines };
}

let boardTop: CanvasTexture | undefined;

/** The breadboard's top face: plastic colour, print, and the sloped rim around every hole. */
export function boardTopTexture(): CanvasTexture {
  if (boardTop) return boardTop;
  const s = 20; // pixels per millimetre
  const w = BOARD.maxX - BOARD.minX;
  const d = BOARD.maxZ - BOARD.minZ;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * s);
  canvas.height = Math.round(d * s);
  const ctx = canvas.getContext("2d")!;
  const px = (x: number) => (x - BOARD.minX) * s;
  const pz = (z: number) => (z - BOARD.minZ) * s;
  ctx.fillStyle = "#f3f1ea";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const print = boardPrint();
  for (const l of print.lines) {
    ctx.fillStyle = l.color;
    ctx.fillRect(px(l.x) - (l.width * s) / 2, pz(l.z0), l.width * s, (l.z1 - l.z0) * s);
  }
  // The funnel-shaped rim of each hole: a slightly darker square with a lighter lower-right edge.
  const rim = 0.95 * s;
  const spots: [number, number][] = [];
  for (let row = 1; row <= ROWS; row++) {
    for (const col of COLUMNS) spots.push([colX(col), rowZ(row)]);
    for (const rail of RAIL_IDS) spots.push([railX(rail), rowZ(row)]);
  }
  for (const [x, z] of spots) {
    ctx.fillStyle = "#d9d6cc";
    ctx.fillRect(px(x) - rim, pz(z) - rim, rim * 2, rim * 2);
    ctx.fillStyle = "#e9e6dd";
    ctx.fillRect(px(x) - rim, pz(z) + rim * 0.55, rim * 2, rim * 0.45);
    ctx.fillRect(px(x) + rim * 0.55, pz(z) - rim, rim * 0.45, rim * 2);
  }
  ctx.textBaseline = "middle";
  ctx.font = `600 ${Math.round(1.55 * s)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  for (const t of print.texts) {
    ctx.fillStyle = t.color;
    ctx.textAlign = t.align;
    ctx.fillText(t.text, px(t.x), pz(t.z) + 1);
  }
  boardTop = new CanvasTexture(canvas);
  boardTop.colorSpace = SRGBColorSpace;
  boardTop.anisotropy = 8;
  return boardTop;
}

const woods = new Map<boolean, CanvasTexture>();

/** Desk top: wooden planks with grain. Light oak, or dark walnut for the dark theme. */
export function woodTexture(dark: boolean): CanvasTexture {
  const hit = woods.get(dark);
  if (hit) return hit;
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rnd = seeded(dark ? 7 : 3);
  const base = dark ? [74, 52, 38] : [203, 166, 120];
  const grain = dark ? "24, 14, 8" : "120, 82, 44";
  const planks = 5;
  const ph = size / planks;
  for (let p = 0; p < planks; p++) {
    const tone = 0.9 + rnd() * 0.2;
    ctx.fillStyle = `rgb(${base.map((c) => Math.round(c * tone)).join(",")})`;
    ctx.fillRect(0, p * ph, size, ph);
    // long, slightly wavy grain lines
    for (let i = 0; i < 150; i++) {
      const y = p * ph + rnd() * ph;
      const x0 = rnd() * size - 200;
      const length = 250 + rnd() * 900;
      const wave = 2 + rnd() * 5;
      const phase = rnd() * 6.28;
      ctx.strokeStyle = `rgba(${grain}, ${0.05 + rnd() * 0.11})`;
      ctx.lineWidth = 0.6 + rnd() * 1.8;
      ctx.beginPath();
      for (let x = 0; x <= length; x += 24) {
        const yy = Math.min((p + 1) * ph - 1, Math.max(p * ph + 1, y + Math.sin(x / 130 + phase) * wave));
        if (x === 0) ctx.moveTo(x0 + x, yy);
        else ctx.lineTo(x0 + x, yy);
      }
      ctx.stroke();
    }
    // the joint between two planks
    ctx.fillStyle = `rgba(${grain}, 0.55)`;
    ctx.fillRect(0, p * ph, size, 2);
  }
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 8;
  woods.set(dark, tex);
  return tex;
}

/** Cutting mat size in mm (x across, z toward the user) and its grid. */
export const MAT = { width: 320, depth: 270, thickness: 2, margin: 10, grid: 10, bold: 50 };

/** Grid lines of the mat, in mm from its top-left corner: every 10 mm, bolder every 50 mm. */
export function matLines(): { vertical: { at: number; bold: boolean }[]; horizontal: { at: number; bold: boolean }[] } {
  const along = (length: number) => Array.from({ length: Math.floor((length - 2 * MAT.margin) / MAT.grid) + 1 }, (_, i) => ({ at: MAT.margin + i * MAT.grid, bold: (i * MAT.grid) % MAT.bold === 0 }));
  return { vertical: along(MAT.width), horizontal: along(MAT.depth) };
}

let mat: CanvasTexture | undefined;

/** A green self-healing cutting mat: centimetre grid, bolder every 5 cm, numbers along two edges. */
export function matTexture(): CanvasTexture {
  if (mat) return mat;
  const s = 6;
  const canvas = document.createElement("canvas");
  canvas.width = MAT.width * s;
  canvas.height = MAT.depth * s;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#2c6e55";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // slightly uneven surface, as on a used mat
  const rnd = seeded(11);
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = `rgba(${rnd() < 0.5 ? "255,255,255" : "0,0,0"}, ${0.012 + rnd() * 0.02})`;
    ctx.fillRect(rnd() * canvas.width, rnd() * canvas.height, 6 + rnd() * 50, 1 + rnd() * 2);
  }
  const { vertical, horizontal } = matLines();
  const x0 = MAT.margin * s;
  const x1 = vertical.at(-1)!.at * s;
  const z0 = MAT.margin * s;
  const z1 = horizontal.at(-1)!.at * s;
  const line = (bold: boolean) => {
    ctx.strokeStyle = bold ? "rgba(236, 244, 214, 0.75)" : "rgba(236, 244, 214, 0.3)";
    ctx.lineWidth = bold ? 2.2 : 1;
  };
  for (const v of vertical) {
    line(v.bold);
    ctx.beginPath();
    ctx.moveTo(v.at * s, z0);
    ctx.lineTo(v.at * s, z1);
    ctx.stroke();
  }
  for (const h of horizontal) {
    line(h.bold);
    ctx.beginPath();
    ctx.moveTo(x0, h.at * s);
    ctx.lineTo(x1, h.at * s);
    ctx.stroke();
  }
  // 45° guide lines from the near-left corner, as on a real mat
  line(false);
  ctx.beginPath();
  ctx.moveTo(x0, z1);
  ctx.lineTo(x0 + (z1 - z0), z0);
  ctx.moveTo(x1, z1);
  ctx.lineTo(x1 - (z1 - z0), z0);
  ctx.stroke();
  // centimetre numbers along the near and left edges
  ctx.fillStyle = "rgba(236, 244, 214, 0.85)";
  ctx.font = `600 ${Math.round(4.2 * s)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const v of vertical) if (v.bold) ctx.fillText(String((v.at - MAT.margin) / 10), v.at * s, z1 + (MAT.margin * s) / 2);
  for (const h of horizontal) if (h.bold) ctx.fillText(String((horizontal.at(-1)!.at - h.at) / 10), x0 / 2, h.at * s);
  mat = new CanvasTexture(canvas);
  mat.colorSpace = SRGBColorSpace;
  mat.anisotropy = 8;
  return mat;
}
