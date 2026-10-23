import { fillTemplate, packOfPart, PICO_2_W, picoPinHole, propVars, stripOfHole, type Resolved } from "@breadpilot/circuit-core";
import { parseHoleKey } from "./coords";
import type { Target } from "./targets";

const RAIL_NAMES: Record<string, string> = {
  "RL+": "Left + rail (red line)",
  "RL-": "Left − rail (blue line)",
  "RR+": "Right + rail (red line)",
  "RR-": "Right − rail (blue line)",
};

/** Tooltip lines for whatever the pointer is on. */
export function describeTarget(t: Target, resolved: Resolved | null): string[] {
  if (t.kind === "pin") {
    const pin = PICO_2_W.pins.find((p) => p.phys === t.phys)!;
    const lines = [`Pin ${pin.phys} · ${[pin.name, ...(pin.aliases ?? [])].slice(0, 2).join(" / ")}`];
    if (pin.type === "gpio") {
      lines.push(`GPIO ${pin.gpio}${pin.adc !== undefined ? ` · analog ADC${pin.adc}` : ""} · code: Pin(${pin.gpio})`);
      const other = (pin.functions ?? []).filter((f) => !f.startsWith("ADC")).map((f) => f.replace(/_/g, " "));
      if (other.length) lines.push(other.join(", "));
    } else if (pin.description) lines.push(pin.description);
    const h = picoPinHole(pin.phys);
    lines.push(`Plug jumpers into row ${h.row}, column ${pin.phys <= 20 ? "a or b" : "i or j"}.`);
    return lines;
  }
  if (t.kind === "rail") return [`${RAIL_NAMES[t.rail]}, row ${t.row}`, "Every hole along this line is connected."];

  const hole = parseHoleKey(t.key)!;
  const left = "abcde".includes(hole.col);
  const lines = [`Hole ${t.key}`, `Connected to ${hole.row}${left ? "a-e" : "f-j"} (same row, same side of the channel).`];
  const strip = stripOfHole(hole);
  const pin = PICO_2_W.pins.find((p) => stripOfHole(picoPinHole(p.phys)) === strip);
  if (pin) lines.push(`Same row as Pico pin ${pin.phys} (${pin.name}).`);
  for (const part of resolved?.parts ?? []) {
    for (const leg of part.def.legs) {
      const h = part.legs[leg.id];
      if (h && stripOfHole(h) === strip) lines.push(`${part.ref} ${leg.label}${h.row === hole.row && h.col === hole.col ? " is in this hole" : " is in this row"}.`);
    }
  }
  return lines;
}

export function describePart(ref: string, resolved: Resolved | null): string[] {
  const part = resolved?.parts.find((p) => p.ref === ref);
  if (!part) return [ref];
  const hover = packOfPart(part.def)?.text?.names?.hover;
  const extra = hover ? fillTemplate(hover, propVars(part.def, part.props)) : "";
  return [`${part.ref} · ${part.def.name}${extra}`, ...part.def.legs.map((l) => `${l.label}: hole ${part.legs[l.id]?.row}${part.legs[l.id]?.col}`)];
}
