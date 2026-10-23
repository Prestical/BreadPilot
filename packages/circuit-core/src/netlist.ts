// Electrical nets: groups of nodes joined with (practically) zero resistance.
// Joined by: breadboard strips, rails, wires, Pico pins in their strips, the
// Pico's internal ground plane, part legs in their holes, and a part's internal
// "short" and closed "switch" elements.

import { picoPinHole, railNode, stripOfHole } from "./breadboard";
import type { Resolved, ResolvedEnd, ResolvedPart } from "./resolve";
import type { BoardPin, ElementDef, LegDef } from "./types";

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    let p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      return x;
    }
    while (p !== x) {
      const gp = this.parent.get(p)!;
      this.parent.set(x, gp);
      x = p;
      p = this.parent.get(x)!;
    }
    return x;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface PartElement {
  part: ResolvedPart;
  el: ElementDef;
  /** Stable id, e.g. "BTN1#2". */
  id: string;
}

export interface LegRef {
  part: ResolvedPart;
  leg: LegDef;
}

export interface Net {
  id: string;
  pins: BoardPin[];
  legs: LegRef[];
  wires: number[];
}

export interface Nets {
  netOf(node: string): Net;
  legNet(part: ResolvedPart, legId: string): Net;
  pinNet(phys: number): Net;
  all: Net[];
}

export const legNode = (ref: string, legId: string) => `LEG:${ref}:${legId}`;
export const pinNode = (phys: number) => `PIN:${phys}`;

const endNode = (end: ResolvedEnd) => (end.kind === "rail" ? railNode(end.rail) : stripOfHole(end.hole));

export function partElements(resolved: Resolved): PartElement[] {
  return resolved.parts.flatMap((part) => part.def.elements.map((el, i) => ({ part, el, id: `${part.ref}#${i}` })));
}

/** Builds nets with the given switch elements closed (by PartElement id). */
export function buildNets(resolved: Resolved, closedSwitches: ReadonlySet<string> = new Set()): Nets {
  const uf = new UnionFind();
  const { board } = resolved;

  for (const pin of board.pins) uf.union(pinNode(pin.phys), stripOfHole(picoPinHole(pin.phys)));
  // All ground pins share the Pico's ground plane.
  const grounds = board.pins.filter((p) => p.type === "ground");
  for (const g of grounds.slice(1)) uf.union(pinNode(grounds[0]!.phys), pinNode(g.phys));

  for (const part of resolved.parts) {
    for (const [legId, hole] of Object.entries(part.legs)) uf.union(legNode(part.ref, legId), stripOfHole(hole));
  }
  for (const pe of partElements(resolved)) {
    const joined = pe.el.kind === "short" || (pe.el.kind === "switch" && closedSwitches.has(pe.id));
    if (joined) uf.union(legNode(pe.part.ref, pe.el.a), legNode(pe.part.ref, pe.el.b));
  }
  for (const w of resolved.wires) uf.union(endNode(w.ends[0]), endNode(w.ends[1]));

  const nets = new Map<string, Net>();
  const get = (node: string): Net => {
    const id = uf.find(node);
    let net = nets.get(id);
    if (!net) {
      net = { id, pins: [], legs: [], wires: [] };
      nets.set(id, net);
    }
    return net;
  };
  for (const pin of board.pins) get(pinNode(pin.phys)).pins.push(pin);
  for (const part of resolved.parts) {
    for (const leg of part.def.legs) if (part.legs[leg.id]) get(legNode(part.ref, leg.id)).legs.push({ part, leg });
  }
  for (const w of resolved.wires) {
    const net = get(endNode(w.ends[0]));
    if (!net.wires.includes(w.index)) net.wires.push(w.index);
  }

  return {
    netOf: get,
    legNet: (part, legId) => get(legNode(part.ref, legId)),
    pinNet: (phys) => get(pinNode(phys)),
    all: [...nets.values()],
  };
}
