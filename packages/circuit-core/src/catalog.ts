// The component catalog: one entry per part pack (parts/<id>/part.json, see packs.ts).
import { PACKS } from "./packs";
import type { ComponentDef } from "./types";

export const CATALOG: Record<string, ComponentDef> = Object.fromEntries(PACKS.map((p) => [p.part.id, p.part]));

export function getComponent(id: string): ComponentDef | undefined {
  return CATALOG[id];
}

export function propValue(def: ComponentDef, props: Record<string, string | number> | undefined, key: string) {
  return props?.[key] ?? def.props?.[key]?.default;
}
