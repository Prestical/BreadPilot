import { picoPinHole, type BuildStep, type Resolved, type ResolvedEnd, type ResolvedPart, type Wire } from "@breadpilot/circuit-core";
import { BOARD, holePos, parseHoleKey, railPos, type Vec3 } from "./coords";
import type { JumperState } from "./Jumper";
import type { ItemState } from "./shapes";

export interface SceneWire {
  id: string;
  from: Vec3;
  to: Vec3;
  color: string;
  state: JumperState;
}

export interface ScenePart {
  part: ResolvedPart;
  state: ItemState;
  lit?: boolean;
}

/** Everything the 3D view draws. Built by pure functions so the scene stays a dumb renderer. */
export interface SceneModel {
  pico: "hidden" | "ghost" | "done";
  parts: ScenePart[];
  wires: SceneWire[];
  /** Target keys to glow ("27g", "RR-:12", "pin:20"). */
  highlights: string[];
  /** Points the camera should frame; null = keep the current view. */
  focus: Vec3[] | null;
  showLabels: boolean;
}

export const EMPTY_SCENE: SceneModel = { pico: "done", parts: [], wires: [], highlights: [], focus: null, showLabels: false };

const endRow = (e: ResolvedEnd) => (e.kind === "hole" ? e.hole.row : e.row);

export function endPos(end: ResolvedEnd, other: ResolvedEnd): Vec3 {
  if (end.kind === "hole") return holePos(end.hole);
  return railPos(end.rail, end.row ?? endRow(other) ?? 32);
}

export function resolvedWires(resolved: Resolved, wires: Wire[], state: (index: number) => JumperState | null): SceneWire[] {
  return resolved.wires.flatMap((w) => {
    const s = state(w.index);
    if (!s) return [];
    const [a, b] = w.ends;
    return [{ id: `w${w.index}`, from: endPos(a, b), to: endPos(b, a), color: wires[w.index]?.color ?? "yellow", state: s }];
  });
}

/** Key → world position, for camera framing. Rails without a row are skipped. */
export function keyPos(key: string): Vec3 | null {
  const hole = parseHoleKey(key);
  if (hole) return holePos(hole);
  const rail = /^(R[LR][+-]):(\d+)$/.exec(key);
  if (rail) return railPos(rail[1] as never, Number(rail[2]));
  const pin = /^pin:(\d+)$/.exec(key);
  if (pin) return holePos(picoPinHole(Number(pin[1])));
  return null;
}

/** Guided build: steps up to the current one are shown, later ones are hidden. */
export function buildScene(resolved: Resolved, wires: Wire[], steps: BuildStep[], current: number, showLabels: boolean): SceneModel {
  const step = steps[current];
  const stepOfPart = new Map(steps.filter((s) => s.partRef).map((s) => [s.partRef!, s.index]));
  const stepOfWire = new Map(steps.filter((s) => s.wireIndex !== undefined).map((s) => [s.wireIndex!, s.index]));
  const picoStep = steps.find((s) => s.kind === "place-pico")?.index ?? 0;
  const stateAt = (i: number | undefined): ItemState | null => (i === undefined || i > current ? null : i === current ? "current" : "done");

  const parts = resolved.parts.flatMap((part) => {
    const s = stateAt(stepOfPart.get(part.ref));
    return s ? [{ part, state: s }] : [];
  });
  const sceneWires = resolvedWires(resolved, wires, (i) => stateAt(stepOfWire.get(i)));

  let focus: Vec3[] | null = null;
  const highlights: string[] = [];
  if (step) {
    // Intro/Pico/USB steps only move the camera; part and wire steps also light up their holes.
    if (step.kind === "place-part" || step.kind === "wire") highlights.push(...step.focus.holes);
    const pts = step.focus.holes.map((k) => keyPos(k)).filter((p): p is Vec3 => !!p);
    const current = sceneWires.find((w) => w.id === `w${step.wireIndex}`);
    if (current) pts.push(current.from, current.to);
    focus = pts.length ? pts : null;
  }

  return {
    pico: current >= picoStep ? "done" : "ghost",
    parts,
    wires: sceneWires,
    highlights,
    focus,
    showLabels,
  };
}

/**
 * Where the step pop-up is pinned: just past the board's right edge, level with the step's focus
 * points, so the card never covers the holes, pins or parts the step is about.
 */
export function popupAnchor(focus: SceneModel["focus"]): [number, number, number] | null {
  if (!focus?.length) return null;
  const sum = focus.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
  return [BOARD.maxX + 3, sum[1] / focus.length + 2, sum[2] / focus.length];
}

/** Step pop-up size in px (matches .step-pop in styles.css) and the stage areas it must avoid. */
export const POPUP = { width: 340, offset: 30, top: 190, bottom: 260, margin: 16 };

/**
 * Keeps the pop-up inside the stage: clear of the tool buttons at the top and the step strip +
 * prompt at the bottom. When the board's edge leaves the screen (zoomed in), the card stays at the
 * right edge instead of disappearing. (x, y) is the anchor's screen position; the card's left edge
 * is POPUP.offset to its right and it is centered on y.
 */
export function clampPopup(x: number, y: number, size: { width: number; height: number }): [number, number] {
  const maxX = size.width - POPUP.width - POPUP.offset - POPUP.margin;
  const maxY = Math.max(POPUP.top, size.height - POPUP.bottom);
  const cx = Number.isFinite(x) ? x : maxX;
  const cy = Number.isFinite(y) ? y : POPUP.top;
  return [Math.max(POPUP.margin, Math.min(maxX, cx)), Math.max(POPUP.top, Math.min(maxY, cy))];
}
