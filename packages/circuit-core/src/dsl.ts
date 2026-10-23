// Connection DSL:
//   #<pico_pin>(<pin_name>)            Pico physical pin, e.g. #33(GND), #20(GP15)
//   #<row><col>[(<label>)]             breadboard hole, e.g. #26a(R1.a)
//   #<row>(<component>[.<leg>])        breadboard row; the column is picked automatically
//   #RL+ / #RL- / #RR+ / #RR-[(label)] power rails (left/right, + or −)
// A line is "<endpoint> -> <endpoint>". "//" starts a comment.
//
// The parser only checks syntax. Whether pin 33 really is GND, whether the hole
// exists and is free, etc. is checked by the validator (codes E006, E010, E013).

import { isPinLikeLabel, PICO_2_W } from "./board";
import { isRailId } from "./breadboard";
import type { Board, Column, Endpoint, RailId, Wire } from "./types";

export interface ParseError {
  line: number;
  text: string;
  message: string;
}

export interface ParseResult {
  wires: Wire[];
  /** 1-based source line for each wire, same order as `wires`. */
  lines: number[];
  errors: ParseError[];
}

const RAIL_RE = /^#(R[LR][+-])(?::(\d{1,2}))?(?:\((.*)\))?$/i;
const POINT_RE = /^#(\d{1,2})([a-jA-J])?(?:\((.*)\))?$/;

export function parseEndpoint(token: string, board: Board = PICO_2_W): Endpoint | string {
  const t = token.trim();

  const rail = RAIL_RE.exec(t);
  if (rail) {
    const id = rail[1]!.toUpperCase();
    if (!isRailId(id)) return `Unknown rail "${rail[1]}". Use RL+, RL-, RR+ or RR-.`;
    const ep: Endpoint = { kind: "rail", rail: id as RailId };
    if (rail[2]) ep.row = Number(rail[2]);
    if (rail[3]) ep.label = rail[3].trim();
    return ep;
  }

  const m = POINT_RE.exec(t);
  if (!m) {
    return `Can't read "${t}". Examples: #33(GND), #24j(LED1.anode), #RR-(GND).`;
  }
  const num = Number(m[1]);
  const col = m[2]?.toLowerCase() as Column | undefined;
  const label = m[3]?.trim() || undefined;

  if (col) return label ? { kind: "hole", row: num, col, label } : { kind: "hole", row: num, col };
  if (!label) {
    return `"${t}" is ambiguous. Write #${num}(GND) style for a Pico pin, or #${num}a style for a breadboard hole.`;
  }
  if (isPinLikeLabel(board, label)) return { kind: "pico", phys: num, label };
  return { kind: "hole", row: num, label };
}

export function parseConnection(line: string, board: Board = PICO_2_W): Wire | string {
  const parts = line.split("->");
  if (parts.length !== 2) return `Each connection needs exactly one "->", e.g. #33(GND) -> #10(LED1.cathode).`;
  const from = parseEndpoint(parts[0]!, board);
  if (typeof from === "string") return from;
  const to = parseEndpoint(parts[1]!, board);
  if (typeof to === "string") return to;
  return { from, to };
}

export function parseConnections(text: string, board: Board = PICO_2_W): ParseResult {
  const result: ParseResult = { wires: [], lines: [], errors: [] };
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) return;
    const parsed = parseConnection(line, board);
    if (typeof parsed === "string") result.errors.push({ line: i + 1, text: raw, message: parsed });
    else {
      result.wires.push(parsed);
      result.lines.push(i + 1);
    }
  });
  return result;
}

export function formatEndpoint(ep: Endpoint): string {
  switch (ep.kind) {
    case "pico":
      return `#${ep.phys}(${ep.label})`;
    case "hole":
      return `#${ep.row}${ep.col ?? ""}${ep.label ? `(${ep.label})` : ""}`;
    case "rail":
      return `#${ep.rail}${ep.label ? `(${ep.label})` : ""}`;
  }
}

export function formatWire(w: Wire): string {
  return `${formatEndpoint(w.from)} -> ${formatEndpoint(w.to)}`;
}
