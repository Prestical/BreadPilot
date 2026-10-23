import type { GpioMode, Part } from "@breadpilot/circuit-core";
import breadboard from "../../../../data/tutorial/01-breadboard.json";
import pinNumbers from "../../../../data/tutorial/02-pin-numbers.json";
import pinNames from "../../../../data/tutorial/03-pin-names.json";
import readingLines from "../../../../data/tutorial/04-reading-lines.json";
import parts from "../../../../data/tutorial/05-parts.json";
import safety from "../../../../data/tutorial/06-safety.json";
import practice from "../../../../data/tutorial/07-practice.json";

export type Expectation =
  | { type: "next" }
  | { type: "click"; accept: string[]; hint: string; success: string }
  | { type: "wire"; from: string[]; to: string[]; hint: string; success: string; mustFail?: string };

export interface TutorialStep {
  text: string;
  /** Target keys the camera frames. */
  focus?: string[];
  highlight?: string[];
  labels?: boolean;
  /** Reveal the chapter's wires on this step. */
  showWires?: boolean;
  expect: Expectation;
}

export interface Chapter {
  id: string;
  title: string;
  summary: string;
  parts?: Part[];
  /** Connection DSL lines. */
  wires?: string[];
  gpioModes?: Record<string, GpioMode>;
  steps: TutorialStep[];
}

export const CHAPTERS = [breadboard, pinNumbers, pinNames, readingLines, parts, safety, practice] as unknown as Chapter[];
