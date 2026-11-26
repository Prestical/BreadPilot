// The examples in the sidebar: projects built in BreadPilot and exported. For the v0.4.0 beta they are
// the "needs testing" projects (user, 26/11/2026): ready-made projects with the parts not yet tried on
// a real Pico, so testers can build them and send a hardware report without spending AI tokens.
// examples.json keeps what each needs (its parts and pins, plan and code, from the exported project
// files); the wiring comes from the layout engine for either power mode, the same as the original
// project's. (The earlier easy, medium and hard examples are kept outside the repo for the full release.)
import { buildSteps, layoutProject, resolveBuild, type BlockRequest, type Build, type BuildStep, type PowerMode, type Resolved } from "@breadpilot/circuit-core";
import type { ApiProject, PlanPart } from "./projects/types";
import RAW_EXAMPLES from "./examples/examples.json";

export interface Demo {
  id: string;
  title: string;
  description: string;
  /** The tag beside the title: a difficulty, or "Needs testing" for parts not yet tried on a real Pico. */
  level: "Easy" | "Medium" | "Hard" | "Needs testing";
  idea: string;
  goal: string;
  behavior: string[];
  /** The plan's parts (kind, purpose, colour), as the plan shows them. */
  parts: PlanPart[];
  code: string;
  explanation: string;
  /** The build for each power mode (breadboard rails or straight to the Pico's pins). */
  build: (power: PowerMode) => Build;
}

export interface Project extends Omit<Demo, "build"> {
  build: Build;
  steps: BuildStep[];
  resolved: Resolved;
}

/** One entry of examples.json. */
interface ExampleFile extends Omit<Demo, "build"> {
  requests: BlockRequest[];
}

export const DEMOS: Demo[] = (RAW_EXAMPLES as unknown as ExampleFile[]).map(({ requests, ...e }) => ({
  ...e,
  build: (power: PowerMode) => layoutProject(requests, undefined, { power }).build,
}));

const cache = new Map<string, Project>();
const directOk = new Map<string, boolean>();

/**
 * Whether an example can be wired straight to the Pico: the Pico's 3V3 pin has room for two wires, so
 * an example with more powered parts (the sound board) is shown on the breadboard rails only.
 */
export function canWireDirect(id: string): boolean {
  const hit = directOk.get(id);
  if (hit !== undefined) return hit;
  const demo = DEMOS.find((d) => d.id === id);
  let ok = false;
  try {
    if (demo) buildSteps(demo.build("direct"));
    ok = !!demo;
  } catch {
    ok = false;
  }
  directOk.set(id, ok);
  return ok;
}

/** The power wiring an example is shown with: the chosen one, or the rails when it can't be direct. */
export const examplePower = (id: string, power: PowerMode): PowerMode => (power === "direct" && !canWireDirect(id) ? "rails" : power);

export function loadProject(id: string, chosen: PowerMode = "rails"): Project {
  const power = examplePower(id, chosen);
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

/** An example's id in the Code view (edits are kept per example, like per project). */
export const EXAMPLE_PREFIX = "example:";

const asProject = new Map<string, ApiProject>();

/**
 * An example as the Code view takes a project: its code, explanation and plan, ready, so the Code
 * button, Try it, Edit and Build for Pico work as for a project the AI made. It has no project in
 * the engine (no handoff bundle, no versions).
 */
export function exampleAsProject(id: string, chosen: PowerMode = "rails"): ApiProject | null {
  const demo = DEMOS.find((d) => d.id === id);
  if (!demo) return null;
  const power = examplePower(id, chosen);
  const key = `${id}:${power}`;
  const hit = asProject.get(key);
  if (hit) return hit;
  const p = loadProject(id, power);
  const project: ApiProject = {
    id: `${EXAMPLE_PREFIX}${id}`,
    idea: demo.idea,
    board: p.build.boardId,
    title: demo.title,
    state: "READY",
    running: false,
    power,
    plans: [{ title: demo.title, goal: demo.goal, behavior: demo.behavior, parts: demo.parts, questions: [], version: 1, approved: true }],
    build: { build: p.build, steps: p.steps, code: demo.code, codeExplanation: demo.explanation, codeAttempts: 1, citations: [] },
    events: [],
    createdAt: "",
    updatedAt: "",
  };
  asProject.set(key, project);
  return project;
}
