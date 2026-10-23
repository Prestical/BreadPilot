// Turns the verified board JSON into plain sentences for RAG.
// The local LLM reads this text instead of the pinout image. Regenerate with
// `npm run gen:pinout`; a test fails if the committed file is out of date.

import { picoFreeHoles, picoPinHole } from "./breadboard";
import type { Board, BoardPin } from "./types";

const TYPE_TEXT: Record<BoardPin["type"], string> = {
  gpio: "a general-purpose input/output (GPIO) pin",
  ground: "a ground (GND) pin. Use it for the minus (−) side of parts",
  power: "a power pin",
  control: "a control pin",
  reference: "a reference-voltage pin",
};

const prettyFn = (f: string) => f.replace(/_/g, " ").replace("CSN", "CSn");

function pinSentence(p: BoardPin): string {
  const names = [p.name, ...(p.aliases ?? [])];
  const side = p.phys <= 20 ? "left" : "right";
  const h = picoPinHole(p.phys);
  const free = picoFreeHoles(p.phys).map((x) => `${x.row}${x.col}`).join(" or ");
  let s = `Physical pin ${p.phys} is ${names.join(" / ")}. It is ${TYPE_TEXT[p.type]}.`;
  if (p.type === "gpio") {
    s += ` In MicroPython it is Pin(${p.gpio}).`;
    if (p.adc !== undefined) s += ` It can also read analog voltages (ADC${p.adc}, use machine.ADC(${p.gpio})).`;
    const other = (p.functions ?? []).filter((f) => !f.startsWith("ADC"));
    if (other.length) s += ` Other functions: ${other.map(prettyFn).join(", ")}.`;
    else s += " It has no I2C/SPI/UART function, only digital I/O and PWM.";
  }
  if (p.type === "power") {
    s += p.voltageRange ? ` Allowed range: ${p.voltageRange[0]}-${p.voltageRange[1]} V.` : ` Voltage: ${p.voltage} V.`;
  }
  if (p.description) s += ` ${p.description}`;
  s += ` On the breadboard it sits on the ${side} side in hole ${h.row}${h.col}; plug jumpers into hole ${free}.`;
  const src = p.src.map((r) => `${r.doc} p.${r.page}${r.section ? ` §${r.section}` : ""}`).join("; ");
  return `- ${s} (Source: ${src})`;
}

const pinRef = (p: BoardPin) => (p.type === "gpio" ? `${p.name} (pin ${p.phys})` : `pin ${p.phys}`);

/** Grouped facts, so questions like "which pins are ADC?" match one chunk. */
function summaryLines(board: Board): string[] {
  const pins = board.pins;
  const of = (type: BoardPin["type"]) => pins.filter((p) => p.type === type);
  const adc = pins.filter((p) => p.adc !== undefined);
  const gpio = of("gpio");
  const lines = [
    `- Analog input (ADC) pins: ${adc.map((p) => `${p.name} (pin ${p.phys}, ADC${p.adc})`).join(", ")}. No other pin can read analog voltages.`,
    `- Ground (GND) pins: ${of("ground").map((p) => `pin ${p.phys}${p.aliases?.length ? ` (${p.aliases.join("/")})` : ""}`).join(", ")}. All are connected together on the board.`,
    `- Power pins: ${of("power").map((p) => `${p.name} (pin ${p.phys})`).join(", ")}. Use 3V3 (pin 36) to power 3.3 V parts.`,
    `- Control and reference pins: ${[...of("control"), ...of("reference")].map((p) => `${p.name} (pin ${p.phys})`).join(", ")}.`,
    `- GPIO pins on the header: ${gpio.length} in total, ${gpio.map((p) => p.name).join(", ")}.`,
  ];
  const fns = new Map<string, BoardPin[]>();
  for (const p of gpio) for (const f of p.functions ?? []) if (!f.startsWith("ADC")) fns.set(f, [...(fns.get(f) ?? []), p]);
  for (const [fn, list] of [...fns].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`- ${prettyFn(fn)} can be on: ${list.map(pinRef).join(", ")}.`);
  }
  return lines;
}

export function pinoutMarkdown(board: Board): string {
  const lines = [
    `# ${board.name} pinout (generated from verified data, do not edit)`,
    "",
    `Variants: ${board.variants.join(", ")}. GPIO logic level is ${board.electrical.logicVoltage} V. Never connect 5 V to a GPIO.`,
    "Pin numbering: with the USB connector at the top, pin 1 is top-left, pins 1-20 run down the left side and pins 21-40 run up the right side (pin 40 is top-right).",
    "",
    "## Summary",
    ...summaryLines(board),
    "",
    "## Pins",
    ...board.pins.map(pinSentence),
    "",
    "## GPIOs used inside the board (not on any pin)",
    ...board.internalGpio.map((g) => `- ${g.name}: ${g.use}. Do not use it in projects.`),
    "",
  ];
  return lines.join("\n");
}
