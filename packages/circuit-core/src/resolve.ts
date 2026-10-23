// Physical resolution: turns a Build (parts + DSL wires) into concrete holes,
// checking that every pin, hole and label is real and every hole is used once.

import { getBoard, isInternalGpio, isPinLikeLabel, labelMatchesPin, pinByPhys } from "./board";
import {
  holeKey,
  isBlockedByPico,
  isValidRow,
  parseHole,
  picoFreeHoles,
  picoPinHole,
  sideOf,
  stripHolesOuterFirst,
  stripOfHole,
} from "./breadboard";
import { getComponent } from "./catalog";
import { formatEndpoint } from "./dsl";
import type { Board, Build, ComponentDef, Endpoint, Hole, Issue, LegDef, RailId } from "./types";

export interface ResolvedPart {
  ref: string;
  def: ComponentDef;
  legs: Record<string, Hole>;
  props: Record<string, string | number>;
}

export type ResolvedEnd =
  | { kind: "hole"; hole: Hole; picoPin?: number }
  | { kind: "rail"; rail: RailId; row?: number };

export interface ResolvedWire {
  index: number;
  ends: [ResolvedEnd, ResolvedEnd];
}

export interface Resolved {
  board: Board;
  parts: ResolvedPart[];
  wires: ResolvedWire[];
}

const err = (code: string, message: string, extra: Partial<Issue> = {}): Issue => ({
  code,
  severity: "error",
  message,
  ...extra,
});

export function legLabel(part: ResolvedPart | { ref: string; def: ComponentDef }, leg: LegDef): string {
  return `${part.ref} ${leg.label}`;
}

export function resolveBuild(build: Build): { resolved: Resolved | null; issues: Issue[] } {
  const issues: Issue[] = [];
  const board = getBoard(build.boardId);
  if (!board) return { resolved: null, issues: [err("E006", `Unknown board "${build.boardId}".`)] };

  const occupied = new Map<string, string>(); // hole key → what is in it
  const occupy = (h: Hole, what: string, extra: Partial<Issue>): boolean => {
    const key = holeKey(h);
    if (isBlockedByPico(h)) {
      issues.push(err("E013", `Hole ${key} is under the Pico board, so ${what} can't go there.`, extra));
      return false;
    }
    const current = occupied.get(key);
    if (current) {
      issues.push(err("E013", `Hole ${key} already holds ${current}; ${what} needs its own hole.`, extra));
      return false;
    }
    occupied.set(key, what);
    return true;
  };

  // ---- Parts ----
  const parts: ResolvedPart[] = [];
  const refs = new Set<string>();
  for (const p of build.parts) {
    const def = getComponent(p.type);
    if (!def) {
      issues.push(err("E006", `${p.ref}: unknown component type "${p.type}".`, { parts: [p.ref] }));
      continue;
    }
    if (refs.has(p.ref)) {
      issues.push(err("E006", `Two parts are called ${p.ref}; each part needs its own name.`, { parts: [p.ref] }));
      continue;
    }
    refs.add(p.ref);
    const legs: Record<string, Hole> = {};
    for (const legId of Object.keys(p.legs)) {
      if (!def.legs.some((l) => l.id === legId)) {
        issues.push(err("E006", `${p.ref} has no leg called "${legId}".`, { parts: [p.ref] }));
      }
    }
    for (const leg of def.legs) {
      const text = p.legs[leg.id];
      if (!text) {
        issues.push(err("E006", `${legLabel({ ref: p.ref, def }, leg)} isn't placed on the breadboard.`, { parts: [p.ref] }));
        continue;
      }
      const hole = parseHole(text);
      if (!hole) {
        issues.push(err("E013", `Hole "${text}" for ${legLabel({ ref: p.ref, def }, leg)} doesn't exist (rows 1-63, columns a-j).`, { parts: [p.ref] }));
        continue;
      }
      if (occupy(hole, legLabel({ ref: p.ref, def }, leg), { parts: [p.ref] })) legs[leg.id] = hole;
    }
    const props: Record<string, string | number> = {};
    for (const [k, spec] of Object.entries(def.props ?? {})) props[k] = p.props?.[k] ?? spec.default;
    parts.push({ ref: p.ref, def, legs, props });
  }
  const partByRef = new Map(parts.map((p) => [p.ref, p]));

  // ---- Labels on breadboard endpoints ----
  // Returns the strip a label points at ("LED1.cathode" → strip of that leg), or an error message.
  const labelTarget = (label: string): { strip: string; hole: Hole } | string | null => {
    if (isPinLikeLabel(board, label)) return null;
    const [ref, legId] = label.split(".");
    const part = partByRef.get(ref!);
    if (!part) return `There's no part called "${ref}".`;
    if (legId) {
      const leg = part.def.legs.find((l) => l.id === legId);
      if (!leg) return `${part.ref} has no leg "${legId}" (legs: ${part.def.legs.map((l) => l.id).join(", ")}).`;
      const hole = part.legs[legId];
      if (!hole) return null; // leg placement error already reported
      return { strip: stripOfHole(hole), hole };
    }
    return null;
  };

  const checkHoleLabel = (ep: Extract<Endpoint, { kind: "hole" }>, hole: Hole, wireIdx: number) => {
    if (!ep.label) return;
    const extra = { wires: [wireIdx] };
    if (isPinLikeLabel(board, ep.label)) {
      const pinHere = board.pins.find((p) => stripOfHole(picoPinHole(p.phys)) === stripOfHole(hole));
      if (!pinHere || !labelMatchesPin(pinHere, ep.label)) {
        issues.push(err("E006", `${formatEndpoint(ep)}: hole ${holeKey(hole)} isn't connected to ${ep.label}.`, extra));
      }
      return;
    }
    const [ref, legId] = ep.label.split(".");
    const target = labelTarget(ep.label);
    if (typeof target === "string") {
      issues.push(err("E006", `${formatEndpoint(ep)}: ${target}`, extra));
      return;
    }
    const part = partByRef.get(ref!);
    if (!part) return;
    const strip = stripOfHole(hole);
    if (legId) {
      if (target && target.strip !== strip) {
        const leg = part.def.legs.find((l) => l.id === legId)!;
        issues.push(
          err("E006", `${formatEndpoint(ep)}: ${legLabel(part, leg)} is in row ${target.hole.row}, not in the strip of hole ${holeKey(hole)}.`, extra),
        );
      }
    } else if (!Object.values(part.legs).some((h) => stripOfHole(h) === strip)) {
      issues.push(err("E006", `${formatEndpoint(ep)}: no leg of ${part.ref} is in the strip of hole ${holeKey(hole)}.`, extra));
    }
  };

  // ---- Wires: explicit holes first, then auto-picked ones, so auto picks never steal a named hole ----
  const ends: (ResolvedEnd | null)[][] = build.wires.map(() => [null, null]);
  const resolvePass = (auto: boolean) => {
    build.wires.forEach((w, wi) => {
      [w.from, w.to].forEach((ep, ei) => {
        const extra = { wires: [wi] };
        const isAuto = ep.kind === "pico" || (ep.kind === "hole" && !ep.col);
        if (isAuto !== auto) return;
        const what = `wire ${wi + 1} (${formatEndpoint(ep)})`;

        if (ep.kind === "rail") {
          if (ep.row !== undefined && !isValidRow(ep.row)) {
            issues.push(err("E013", `${formatEndpoint(ep)}: rail row ${ep.row} doesn't exist (1-63).`, extra));
            return;
          }
          ends[wi]![ei] = ep.row !== undefined ? { kind: "rail", rail: ep.rail, row: ep.row } : { kind: "rail", rail: ep.rail };
          return;
        }

        if (ep.kind === "pico") {
          const pin = pinByPhys(board, ep.phys);
          if (!pin) {
            issues.push(err("E006", `${formatEndpoint(ep)}: the Pico has pins 1-${board.pins.length}; there is no pin ${ep.phys}.`, extra));
            return;
          }
          if (isInternalGpio(board, ep.label)) {
            const use = board.internalGpio.find((g) => g.name === ep.label.toUpperCase())?.use;
            issues.push(err("E010", `${ep.label} is used inside the Pico 2 W (${use}) and isn't on any pin. Pick another GPIO.`, { ...extra, pins: [ep.label.toUpperCase()] }));
            return;
          }
          if (!labelMatchesPin(pin, ep.label)) {
            issues.push(err("E006", `${formatEndpoint(ep)}: pin ${pin.phys} is ${pin.name}, not ${ep.label}.`, { ...extra, pins: [pin.name] }));
            return;
          }
          const free = picoFreeHoles(pin.phys).find((h) => !occupied.has(holeKey(h)));
          if (!free) {
            issues.push(err("E013", `Both free holes next to pin ${pin.phys} (${pin.name}) are already used.`, extra));
            return;
          }
          occupy(free, what, extra);
          ends[wi]![ei] = { kind: "hole", hole: free, picoPin: pin.phys };
          return;
        }

        // breadboard hole
        if (!isValidRow(ep.row)) {
          issues.push(err("E013", `${formatEndpoint(ep)}: row ${ep.row} doesn't exist (1-63).`, extra));
          return;
        }
        if (ep.col) {
          const hole = { row: ep.row, col: ep.col };
          if (!occupy(hole, what, extra)) return;
          checkHoleLabel(ep, hole, wi);
          ends[wi]![ei] = { kind: "hole", hole };
          return;
        }
        // No column: use the label to find which side of the channel is meant.
        const target = ep.label ? labelTarget(ep.label) : null;
        const sideHole =
          target && typeof target !== "string"
            ? target.hole
            : (() => {
                const part = ep.label ? partByRef.get(ep.label.split(".")[0]!) : undefined;
                return part ? Object.values(part.legs).find((h) => h.row === ep.row) : undefined;
              })();
        if (typeof target === "string") {
          issues.push(err("E006", `${formatEndpoint(ep)}: ${target}`, extra));
          return;
        }
        if (target && target.hole.row !== ep.row) {
          issues.push(err("E006", `${formatEndpoint(ep)}: ${ep.label} is in row ${target.hole.row}, not row ${ep.row}.`, extra));
          return;
        }
        if (!sideHole || sideHole.row !== ep.row) {
          issues.push(
            err("E006", `${formatEndpoint(ep)}: can't tell which hole in row ${ep.row} is meant. Add a column, e.g. #${ep.row}a or #${ep.row}j.`, extra),
          );
          return;
        }
        const free = stripHolesOuterFirst(ep.row, sideOf(sideHole.col)).find(
          (h) => !occupied.has(holeKey(h)) && !isBlockedByPico(h),
        );
        if (!free) {
          issues.push(err("E013", `${formatEndpoint(ep)}: every hole in that strip of row ${ep.row} is already used.`, extra));
          return;
        }
        occupy(free, what, extra);
        ends[wi]![ei] = { kind: "hole", hole: free };
      });
    });
  };
  resolvePass(false);
  resolvePass(true);

  const wires: ResolvedWire[] = [];
  ends.forEach((pair, index) => {
    if (pair[0] && pair[1]) wires.push({ index, ends: [pair[0], pair[1]] });
  });

  return { resolved: { board, parts, wires }, issues };
}
