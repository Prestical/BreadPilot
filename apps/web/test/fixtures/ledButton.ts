// The hand-written "LED + button" build (Milestone 2: written in the connection DSL, plays step by
// step in 3D). It was the first example; since the examples came from real projects (25/11/2026)
// it is a test fixture for the 3D scene and the power modes.
import { buildSteps, parseConnections, resolveBuild, type Build, type PowerMode } from "@breadpilot/circuit-core";
import type { Project } from "../../src/demos";

/** Written by hand in the connection DSL (Milestone 2 acceptance: plays step by step in 3D). */
export function ledButtonByHand(power: PowerMode): Build {
  // GND from pin 38 at the top; the button on GP18 so its wire isn't in the row next to GP16's.
  const rails = `
    #38(GND) -> #RR-(GND)
    #21(GP16) -> #24j(R1.a)            // signal to the resistor
    #28j(LED1.cathode) -> #RR-(GND)
    #24(GP18) -> #30j(BTN1.1b)         // button input
    #32j(BTN1.2b) -> #RR-(GND)
  `;
  // Direct to the Pico: no rails; each GND wire on its own GND pin (28 and 23).
  const direct = `
    #21(GP16) -> #24j(R1.a)
    #28(GND) -> #28j(LED1.cathode)
    #24(GP18) -> #30j(BTN1.1b)
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
    gpioModes: { GP16: "out", GP18: "in_pullup" },
  };
}


/** The fixture as the 3D scene takes a project. */
export function ledButtonProject(power: PowerMode = "rails"): Project {
  const build = ledButtonByHand(power);
  return { id: "led-button", title: "LED + button", description: "Light an LED while a button is pressed.", level: "Easy", idea: "", goal: "", behavior: [], parts: [], code: "", explanation: "", build, steps: buildSteps(build), resolved: resolveBuild(build).resolved! };
}
