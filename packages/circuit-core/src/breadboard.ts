import bbJson from "../../../data/breadboards/bb-830.json";
import type { Column, Hole, RailId, Side } from "./types";

export const BREADBOARD = bbJson as {
  id: string;
  rows: number;
  pitchMm: number;
  columns: Column[];
  strips: Record<Side, Column[]>;
  rails: { id: RailId; side: "left" | "right"; polarity: "+" | "-"; label: string }[];
  picoPlacement: {
    firstRow: number;
    leftColumn: Column;
    rightColumn: Column;
    coveredColumns: Column[];
    freeLeft: Column[];
    freeRight: Column[];
  };
};

const PICO = BREADBOARD.picoPlacement;
const PICO_PINS_PER_SIDE = 20;
export const PICO_LAST_ROW = PICO.firstRow + PICO_PINS_PER_SIDE - 1;
export const RAIL_IDS = BREADBOARD.rails.map((r) => r.id);

export function sideOf(col: Column): Side {
  return BREADBOARD.strips.L.includes(col) ? "L" : "R";
}

export function parseHole(text: string): Hole | null {
  const m = /^(\d{1,2})([a-jA-J])$/.exec(text.trim());
  if (!m) return null;
  const row = Number(m[1]);
  if (row < 1 || row > BREADBOARD.rows) return null;
  return { row, col: m[2]!.toLowerCase() as Column };
}

export function isValidRow(row: number): boolean {
  return Number.isInteger(row) && row >= 1 && row <= BREADBOARD.rows;
}

export function holeKey(h: Hole): string {
  return `${h.row}${h.col}`;
}

/** Electrical node id of the 5-hole strip a hole belongs to. */
export function stripId(row: number, side: Side): string {
  return `S:${row}:${side}`;
}

export function stripOfHole(h: Hole): string {
  return stripId(h.row, sideOf(h.col));
}

export function railNode(rail: RailId): string {
  return `RAIL:${rail}`;
}

export function isRailId(s: string): s is RailId {
  return (RAIL_IDS as string[]).includes(s);
}

/** Hole where a Pico physical pin sits (pins 1-20 left column, 40-21 right column). */
export function picoPinHole(phys: number): Hole {
  if (phys <= PICO_PINS_PER_SIDE) return { row: PICO.firstRow + phys - 1, col: PICO.leftColumn };
  return { row: PICO.firstRow + (2 * PICO_PINS_PER_SIDE - phys), col: PICO.rightColumn };
}

/** Free holes next to a Pico pin for jumpers, in preference order. */
export function picoFreeHoles(phys: number): Hole[] {
  const { row } = picoPinHole(phys);
  const cols = phys <= PICO_PINS_PER_SIDE ? PICO.freeLeft : PICO.freeRight;
  return cols.map((col) => ({ row, col }));
}

/** Holes under the Pico (its pins or its PCB) can't take a part leg or wire. */
export function isBlockedByPico(h: Hole): boolean {
  return h.row >= PICO.firstRow && h.row <= PICO_LAST_ROW && PICO.coveredColumns.includes(h.col);
}

/** Free holes of a strip, outermost first (a→e on the left, j→f on the right). */
export function stripHolesOuterFirst(row: number, side: Side): Hole[] {
  const cols = side === "L" ? BREADBOARD.strips.L : [...BREADBOARD.strips.R].reverse();
  return cols.map((col) => ({ row, col }));
}
