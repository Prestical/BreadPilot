// Part pack texts for the agent (parts/<id>/agent.json), and the lists built from them.
import { PACKS, packByKind, type AgentInfo, type Board, type PlacedBlock } from "@breadpilot/circuit-core";

/** Packs the model may pick, in pack order. */
export const AGENT_PACKS = PACKS.filter((p) => p.meta.kind && p.agent);

export function agentOf(kind: string): AgentInfo {
  const a = packByKind(kind)?.agent;
  if (!a) throw new Error(`No part pack for kind "${kind}".`);
  return a;
}

/** Fills {placeholders}; unknown ones stay as written. */
export function fill(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{([^}]*)\}/g, (m, key: string) => (vars[key] === undefined ? m : String(vars[key])));
}

/** "a, b and c" / "a, b or c". */
export function joinList(items: string[], last: "and" | "or"): string {
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} ${last} ${items.at(-1)}` : (items[0] ?? "");
}

/** Placeholders for a placed block: {ref} {refs} {gpio} {g} {phys} {mode} {bus} {scl} {sclG} {sclPhys} {n} {color}. */
export function blockVars(b: PlacedBlock, board: Board | undefined, extra: { n?: string; color?: string } = {}): Record<string, string | number | undefined> {
  const pin = board?.pins.find((x) => x.name === b.gpio);
  const scl = b.scl ? board?.pins.find((x) => x.name === b.scl) : undefined;
  return {
    ref: b.ref,
    refs: b.refs.join(" + "),
    gpio: b.gpio,
    g: Number(b.gpio.slice(2)),
    phys: pin?.phys,
    mode: b.mode,
    bus: b.bus,
    scl: b.scl,
    sclG: b.scl ? Number(b.scl.slice(2)) : undefined,
    sclPhys: scl?.phys,
    ...extra,
  };
}
