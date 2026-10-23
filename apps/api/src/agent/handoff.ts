// Handoff bundle: everything a stronger assistant needs to finish the
// project, with the validated wiring marked as fixed so it can't be "improved" unsafely.

import { driversFor, formatWire, getBoard, packByKind, type BuildStep } from "@breadpilot/circuit-core";
import { blockVars, fill } from "./packText";
import { currentPlan, type Project } from "./project";

/** Pin-table rows for a part kind no pack knows any more (an old saved project). */
const UNKNOWN_ROWS = ["| {gpio} | {phys} | {refs} | {mode} | `{mode}` |"];

export function handoffMarkdown(p: Project): string {
  const board = getBoard(p.board)!;
  const plan = currentPlan(p);
  const b = p.build;
  const lines: string[] = [];
  const add = (...l: string[]) => lines.push(...l);

  add(`# Project handoff: ${p.title}`, "");
  add(`**Board:** ${board.name} (${board.variants.join(" / ")}), MicroPython, 3.3 V logic. Never put 5 V on a GPIO.`, "");
  if (p.handoffReason) add(`**Why this handoff:** ${p.handoffReason}`, "");
  add("## The idea (user's words)", "", `> ${p.idea.replace(/\n/g, "\n> ")}`, "");

  if (plan) {
    add("## Approved plan", "", `**Goal:** ${plan.goal}`, "", "**Behavior:**", ...plan.behavior.map((x) => `- ${x}`), "");
  } else if (p.intake) {
    add("## What the project should do", "", `**Goal:** ${p.intake.goal}`, "", ...p.intake.behaviors.map((x) => `- ${x}`), "");
    if (p.intake.unsupportedParts.length) add(`**Parts the local builder can't wire yet:** ${p.intake.unsupportedParts.join(", ")}`, "");
  }

  if (b) {
    add("## Parts list", "");
    for (const part of b.build.parts) {
      const props = Object.entries(part.props ?? {}).map(([k, v]) => `${k}: ${v}`).join(", ");
      add(`- ${part.ref}: ${part.type}${props ? ` (${props})` : ""}`);
    }
    add("- Jumper wires, 830-point breadboard, Raspberry Pi Pico 2 W(H), micro-USB cable", "");

    add("## Pin assignments (fixed: the wiring below is already validated, don't change it)", "", "| GPIO | Physical pin | Part | Mode | MicroPython |", "|---|---|---|---|---|");
    // Rows from each part's pack (agent.json code.handoff): one per pin, e.g. SDA and SCL for a display.
    for (const blk of b.blocks) for (const row of packByKind(blk.kind)?.agent?.code.handoff ?? UNKNOWN_ROWS) add(fill(row, blockVars(blk, board)));
    add("", "## Wiring (connection lines, validated: no shorts, every LED has a resistor)", "", "```", ...b.build.wires.map(formatWire), "```", "");
    add("## Build steps", "", ...b.steps.map((s: BuildStep) => `${s.index + 1}. **${s.title}.** ${s.text}`), "");

    if (b.code) {
      add(`## Last code attempt (${b.codeCheck?.ok ? "passed" : "failed"} the pin check after ${b.codeAttempts} tries)`, "", "```python", b.code, "```", "");
      const problems = b.codeCheck?.issues.filter((i) => i.severity === "error") ?? [];
      if (problems.length) add("**Problems found by the checker:**", ...problems.map((i) => `- ${i.code}: ${i.message}`), "");
    }
    if (b.citations.length) add("## Documentation used", "", ...b.citations.map((c) => `- ${c}`), "");
    for (const d of driversFor(b.build.parts.map((x) => x.type))) {
      add(`## Driver file: ${d.file} (save it on the Pico next to main.py; use its API, don't replace it)`, "", "```python", d.source.trimEnd(), "```", "");
    }
  }

  add("## Request", "");
  if (b && !b.codeCheck?.ok) {
    add(
      `Write a complete MicroPython program for the ${board.name} that does what the plan above describes.`,
      "Use exactly the GPIOs and modes in the pin assignment table, and no other pins. Do not change the wiring.",
      "Add short beginner-friendly comments, use a `while True:` loop with a small `time.sleep()`, and explain the program in a few sentences.",
    );
  } else if (b) {
    add("The project is complete. Review the code and suggest beginner-friendly improvements without changing the wiring.");
  } else {
    add(
      `Design this project for the ${board.name}: list the parts, give breadboard wiring that keeps every GPIO at 3.3 V (use level shifting or dividers for 5 V parts, a resistor for every LED, drivers for motors), and write the MicroPython program.`,
    );
  }
  return lines.join("\n") + "\n";
}
