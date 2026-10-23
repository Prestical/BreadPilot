// Mirrors the project JSON returned by /api/projects (apps/api/src/agent/project.ts).
// Only the fields the UI reads are listed.
import type { Build, BuildStep, CodeCheckReport, PowerMode } from "@breadpilot/circuit-core";

export type ProjectState = "AWAIT_APPROVAL" | "READY" | "HANDOFF" | "FAILED";
export type Stage = "intake" | "plan" | "design" | "steps" | "code";

export interface StageEvent {
  stage: Stage;
  status: "ok" | "retry" | "error";
  detail?: string;
  ms: number;
  at: string;
}

/** A live event from GET /api/projects/:id/events. */
export interface ProgressEvent {
  type: "stage";
  stage: Stage;
  status: "start" | StageEvent["status"];
  attempt?: number;
  detail?: string;
  ms?: number;
  /** The project's token total after this stage. */
  usage?: TokenUsage;
  at: string;
}

/** A planned part; `kind` is a part pack's plan kind. Extra fields are the pack's plan props (an LED's color). */
export interface PlanPart {
  kind: string;
  purpose: string;
  color?: string;
  pin?: string;
  [field: string]: string | undefined;
}

export interface PlanVersion {
  title: string;
  goal: string;
  behavior: string[];
  parts: PlanPart[];
  questions: string[];
  version: number;
  approved: boolean;
  feedback?: string;
  autoFix?: string;
}

export interface ApiProject {
  id: string;
  idea: string;
  board: string;
  title: string;
  state: ProjectState;
  running: boolean;
  power?: PowerMode;
  /** Which model worked on it (missing = the local one). */
  llm?: AiChoice;
  /** Tokens spent on this project so far (all runs). */
  usage?: TokenUsage;
  plans: PlanVersion[];
  build?: {
    build: Build;
    steps: BuildStep[];
    code?: string;
    codeExplanation?: string;
    codeCheck?: CodeCheckReport;
    codeAttempts: number;
    citations: string[];
  };
  handoffReason?: string;
  failure?: string;
  resumeFrom?: "intake" | "plan" | "build";
  events: StageEvent[];
  createdAt: string;
  updatedAt: string;
  /** Only in the stream snapshot: the stage that is running right now. */
  current?: ProgressEvent;
}

export type ProjectSummary = Pick<ApiProject, "id" | "title" | "state" | "idea" | "updatedAt" | "running">;

/** Tokens as the model server reports them; `reasoning` is the hidden-thinking part of `output`. */
export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
  calls: number;
}

/** "local" = Ollama on this computer (default); "openai" = OpenAI's model through the user's API key. */
export type AiChoice = "local" | "openai";

/** GET /api/llm-options: the models a new project can use. */
export interface LlmOptions {
  local: { model: string };
  openai: { available: true; model: string } | { available: false };
}
