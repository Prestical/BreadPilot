// "What you need" for a build: the board, the breadboard, every part and the jumper wires, counted
// from the validated build itself (pure, unit-tested).
import { fillTemplate, getComponent, getPack, propVars, type Build } from "@breadpilot/circuit-core";

export interface NeedItem {
  count: number;
  name: string;
  /** Extra detail, e.g. the wire colors. */
  detail?: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);


export function partsNeeded(build: Build): NeedItem[] {
  const items: NeedItem[] = [
    { count: 1, name: "Raspberry Pi Pico 2 W (with headers)" },
    { count: 1, name: "830-point breadboard" },
  ];
  // Group by type and the property that matters when buying (pack text names.shopBy: LED color,
  // resistor value). Short names come from the pack (names.shop), else the catalog name.
  const groups = new Map<string, { type: string; label?: string; count: number }>();
  for (const p of build.parts) {
    const def = getComponent(p.type);
    const shopBy = getPack(p.type)?.text?.names?.shopBy;
    const label = shopBy && def ? fillTemplate(shopBy, propVars(def, p.props)) : undefined;
    const key = `${p.type}|${label ?? ""}`;
    const g = groups.get(key) ?? { type: p.type, label, count: 0 };
    g.count++;
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    const [one, many] = getPack(g.type)?.text?.names?.shop ?? [getComponent(g.type)?.name ?? g.type, getComponent(g.type)?.name ?? g.type];
    const name = g.label !== undefined ? `${g.label} ${plural(g.count, one, many)}` : plural(g.count, one, many);
    items.push({ count: g.count, name });
  }
  if (build.wires.length) {
    const colors = new Map<string, number>();
    for (const w of build.wires) colors.set(w.color ?? "any color", (colors.get(w.color ?? "any color") ?? 0) + 1);
    const detail = [...colors].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${n} ${c}`).join(", ");
    items.push({ count: build.wires.length, name: `${plural(build.wires.length, "jumper wire", "jumper wires")} (male-male)`, detail });
  }
  items.push({ count: 1, name: "USB data cable for the Pico" });
  return items;
}
