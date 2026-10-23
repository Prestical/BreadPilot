import picoJson from "../../../data/boards/pico-2-w.json";
import type { Board, BoardPin } from "./types";

/** Checks the invariants the safety logic relies on. Throws on bad data. */
export function parseBoard(json: unknown): Board {
  const b = json as Board;
  const fail = (msg: string): never => {
    throw new Error(`Invalid board data (${b?.id ?? "?"}): ${msg}`);
  };
  if (!b || !Array.isArray(b.pins)) fail("missing pins");
  const seen = new Set<number>();
  for (const p of b.pins) {
    if (!Number.isInteger(p.phys) || p.phys < 1) fail(`bad physical pin ${p.phys}`);
    if (seen.has(p.phys)) fail(`duplicate physical pin ${p.phys}`);
    seen.add(p.phys);
    if (!p.src?.length) fail(`pin ${p.phys} has no documentation source`);
    if (p.type === "gpio" && (p.gpio === undefined || p.name !== `GP${p.gpio}`)) fail(`pin ${p.phys} gpio/name mismatch`);
    if (p.type === "power" && typeof p.voltage !== "number") fail(`power pin ${p.phys} has no voltage`);
  }
  for (let i = 1; i <= b.pins.length; i++) if (!seen.has(i)) fail(`physical pin ${i} missing`);
  return b;
}

export const PICO_2_W: Board = parseBoard(picoJson);

const BOARDS: Record<string, Board> = { [PICO_2_W.id]: PICO_2_W };
for (const v of PICO_2_W.variants) BOARDS[v] = PICO_2_W;

export function getBoard(id: string): Board | undefined {
  return BOARDS[id];
}

export function pinByPhys(board: Board, phys: number): BoardPin | undefined {
  return board.pins.find((p) => p.phys === phys);
}

export function pinByGpio(board: Board, gpioName: string): BoardPin | undefined {
  return board.pins.find((p) => p.type === "gpio" && p.name === gpioName);
}

const normalize = (s: string) => s.toUpperCase().replace(/\s+/g, "").replace(/^GPIO(\d+)$/, "GP$1");

/** Names a pin may be called in the DSL: its name, aliases, and GPIOn for GPn. */
export function pinNames(pin: BoardPin): string[] {
  return [pin.name, ...(pin.aliases ?? [])].map(normalize);
}

export function labelMatchesPin(pin: BoardPin, label: string): boolean {
  return pinNames(pin).includes(normalize(label));
}

/** True if a DSL label looks like a Pico pin name (as opposed to a component reference). */
export function isPinLikeLabel(board: Board, label: string): boolean {
  const n = normalize(label);
  if (/^GP\d{1,2}$/.test(n)) return true;
  return board.pins.some((p) => pinNames(p).includes(n));
}

export function isInternalGpio(board: Board, label: string): boolean {
  const n = normalize(label);
  return board.internalGpio.some((g) => g.name === n);
}

/** Display name used in DSL output, e.g. "GND", "3V3", "GP15". */
export function pinDisplayName(pin: BoardPin): string {
  return pin.name;
}
