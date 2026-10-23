import { buildSteps, layoutProject, parseConnections, resolveBuild, type Build, type BuildStep, type PowerMode, type Resolved } from "@breadpilot/circuit-core";

export interface Demo {
  id: string;
  title: string;
  description: string;
  /** The build for each power mode (breadboard rails or straight to the Pico's pins). */
  build: (power: PowerMode) => Build;
}

export interface Project extends Omit<Demo, "build"> {
  build: Build;
  steps: BuildStep[];
  resolved: Resolved;
}

/** Written by hand in the connection DSL (Milestone 2 acceptance: plays step by step in 3D). */
function ledButtonByHand(power: PowerMode): Build {
  const rails = `
    #23(GND) -> #RR-(GND)
    #21(GP16) -> #24j(R1.a)            // signal to the resistor
    #28j(LED1.cathode) -> #RR-(GND)
    #22(GP17) -> #30j(BTN1.1b)         // button input
    #32j(BTN1.2b) -> #RR-(GND)
  `;
  // Direct to the Pico: no rails, both GND wires go to pin 23 (it has two free holes).
  const direct = `
    #21(GP16) -> #24j(R1.a)
    #23(GND) -> #28j(LED1.cathode)
    #22(GP17) -> #30j(BTN1.1b)
    #23(GND) -> #32j(BTN1.2b)
  `;
  const { wires, errors } = parseConnections(power === "direct" ? direct : rails);
  if (errors.length) throw new Error(errors[0]!.message);
  const colors = power === "direct" ? ["yellow", "black", "green", "black"] : ["black", "yellow", "black", "green", "black"];
  return {
    boardId: "pico-2-w",
    parts: [
      { ref: "R1", type: "resistor", legs: { a: "24h", b: "27h" }, props: { ohms: 330 } },
      { ref: "LED1", type: "led-5mm", legs: { anode: "27g", cathode: "28g" }, props: { color: "red" } },
      { ref: "BTN1", type: "button-6mm", legs: { "1a": "30e", "1b": "30f", "2a": "32e", "2b": "32f" } },
    ],
    wires: wires.map((w, i) => ({ ...w, color: colors[i]! })),
    gpioModes: { GP16: "out", GP17: "in_pullup" },
  };
}

export const DEMOS: Demo[] = [
  { id: "led-button", title: "LED + button", description: "Light an LED while a button is pressed.", build: ledButtonByHand },
  { id: "blink", title: "Blinking LED", description: "The classic first project: one LED on GP16.", build: (power) => layoutProject([{ kind: "led" }], undefined, { power }).build },
  {
    id: "dimmer",
    title: "Knob-controlled LED",
    description: "Read a potentiometer and set the LED brightness.",
    build: (power) => layoutProject([{ kind: "pot" }, { kind: "led", props: { color: "green" } }], undefined, { power }).build,
  },
  {
    id: "oled",
    title: "OLED display + button",
    description: "Wire the 1.3\" I2C OLED (SH1106) and a button, e.g. to show a press counter.",
    build: (power) => layoutProject([{ kind: "oled" }, { kind: "button" }], undefined, { power }).build,
  },
];

const cache = new Map<string, Project>();

export function loadProject(id: string, power: PowerMode = "rails"): Project {
  const key = `${id}:${power}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const demo = DEMOS.find((d) => d.id === id) ?? DEMOS[0]!;
  const build = demo.build(power);
  const steps = buildSteps(build); // throws for unsafe builds: they can never be shown
  const { resolved } = resolveBuild(build);
  const project = { ...demo, build, steps, resolved: resolved! };
  cache.set(key, project);
  return project;
}
