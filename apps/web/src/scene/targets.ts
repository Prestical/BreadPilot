import type { RailId } from "@breadpilot/circuit-core";

/** Something the user can point at in the scene. */
export type Target =
  | { kind: "hole"; key: string }
  | { kind: "rail"; rail: RailId; row: number }
  | { kind: "pin"; phys: number };

/** Stable string key: "27g", "RR-:12", "pin:20". */
export function targetKey(t: Target): string {
  if (t.kind === "hole") return t.key;
  if (t.kind === "rail") return `${t.rail}:${t.row}`;
  return `pin:${t.phys}`;
}

export function parseTargetKey(key: string): Target | null {
  if (/^\d{1,2}[a-j]$/.test(key)) return { kind: "hole", key };
  const rail = /^(R[LR][+-]):(\d{1,2})$/.exec(key);
  if (rail) return { kind: "rail", rail: rail[1] as RailId, row: Number(rail[2]) };
  const pin = /^pin:(\d{1,2})$/.exec(key);
  if (pin) return { kind: "pin", phys: Number(pin[1]) };
  return null;
}

/** "RR-" matches any row of that rail; otherwise keys must match exactly. */
export function targetMatches(t: Target, accept: string): boolean {
  if (t.kind === "rail" && accept === t.rail) return true;
  return targetKey(t) === accept;
}
