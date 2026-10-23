// World coordinates for the 3D scene. 1 unit = 1 mm.
// x: across the breadboard (columns), z: along it (rows, row 1 at the back), y: up.

import { BREADBOARD, picoPinHole, type Column, type Hole, type RailId } from "@breadpilot/circuit-core";

export const PITCH = BREADBOARD.pitchMm;
export const ROWS = BREADBOARD.rows;

/** Column index in pitches: a-e = 0-4, the channel is 3 pitches wide, f-j = 7-11. */
const COL_INDEX: Record<Column, number> = { a: 0, b: 1, c: 2, d: 3, e: 4, f: 7, g: 8, h: 9, i: 10, j: 11 };
const CENTER = 5.5;
const RAIL_INDEX: Record<RailId, number> = { "RL-": -3.5, "RL+": -2.5, "RR+": 13.5, "RR-": 14.5 };

export const colX = (col: Column) => (COL_INDEX[col] - CENTER) * PITCH;
export const rowZ = (row: number) => (row - (ROWS + 1) / 2) * PITCH;
export const railX = (rail: RailId) => (RAIL_INDEX[rail] - CENTER) * PITCH;

export type Vec3 = [number, number, number];

export const holePos = (h: Hole, y = 0): Vec3 => [colX(h.col), y, rowZ(h.row)];
export const railPos = (rail: RailId, row: number, y = 0): Vec3 => [railX(rail), y, rowZ(row)];

export const BOARD = {
  minX: (-4.6 - CENTER) * PITCH,
  maxX: (15.6 - CENTER) * PITCH,
  minZ: rowZ(0.2),
  maxZ: rowZ(ROWS + 0.8),
  height: 8.5,
};

/** Pico PCB placement (pins in rows 1-20, columns c and h). */
export const PICO = {
  pcbY: 3.0,
  pcbThickness: 1,
  width: 21,
  length: 51,
  centerZ: (rowZ(1) + rowZ(20)) / 2,
  pinPos: (phys: number) => holePos(picoPinHole(phys)),
};

/** Parses "27g" or "RR-:12" style target keys. */
export function parseHoleKey(key: string): Hole | null {
  const m = /^(\d{1,2})([a-j])$/.exec(key);
  return m ? { row: Number(m[1]), col: m[2] as Column } : null;
}
