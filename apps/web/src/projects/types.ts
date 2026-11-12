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

/** M9: one finished state of a project (the engine's ProjectVersion). */
export interface ProjectVersion {
  n: number;
  /** The change asked for; missing for version 1. */
  request?: string;
  /** The version it was changed from. */
  parent?: number;
  /** Old data: versions once made by a restore. */
  restoredFrom?: number;
  llm: AiChoice;
  model?: string;
  planVersion: number;
  state: "READY" | "HANDOFF";
  build?: NonNullable<ApiProject["build"]>;
  createdAt: string;
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
    /** M9: after a change, only what changes on the breadboard ([] = only the code changed). */
    changeSteps?: BuildStep[];
    /** M9: the board before that change (the 3D view shows the parts and wires being taken out). */
    changeFrom?: Build;
    code?: string;
    codeExplanation?: string;
    codeCheck?: CodeCheckReport;
    codeAttempts: number;
    citations: string[];
  };
  handoffReason?: string;
  /** M9: every finished state of the project, oldest first (the fields above are the latest). */
  versions?: ProjectVersion[];
  /** M9: the version shown now (after a restore, an older one); missing = the newest. */
  currentVersion?: number;
  /** M9: a change that needs other parts, waiting for approval (its plan is the newest plan). */
  pendingChange?: { request: string; baseCode?: string; planCount: number; before: { state: "READY" | "HANDOFF"; title: string } };
  /** M9: the last change that couldn't be made; the project was left as it was. */
  changeError?: { request: string; message: string; at: string };
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
export type ReasoningEffort = "none" | "low" | "medium" | "high";

/** GET /api/settings: the OpenAI key itself is never sent, only whether it's set and how it ends. */
export interface SettingsView {
  /** keepAliveMin: minutes Ollama keeps the model in memory after a request. */
  local: { baseUrl: string; model: string; embedModel: string; numCtx: number; keepAliveMin: number };
  openai: { model: string; reasoningEffort: ReasoningEffort; keySet: boolean; keyHint: string | null; /** Why no key can be saved on this computer. */ keyRefused?: string | null };
  /** The desktop app's operating system ("darwin", "win32", "linux"); null for the development server. */
  dataHome?: string | null;
  browserAccess: { enabled: boolean; port: number; url: string | null; pairingUrl: string | null; error: string | null };
  /** The first-run setup was finished or skipped. */
  setupDone: boolean;
  /** The guided tour was finished or skipped. */
  tourDone: boolean;
}

export interface SettingsPatch {
  local?: Partial<SettingsView["local"]>;
  openai?: Partial<Pick<SettingsView["openai"], "model" | "reasoningEffort">>;
  browserAccess?: Partial<Pick<SettingsView["browserAccess"], "enabled" | "port">>;
  setupDone?: boolean;
  tourDone?: boolean;
}

/** An Ollama model download started from the app (GET /api/ollama/pulls). */
export interface PullState {
  model: string;
  status: "pulling" | "done" | "error";
  completed: number;
  total: number;
  message: string;
}

export interface KeyCheck {
  ok: boolean;
  message: string;
}

/** One model's sizes as Ollama lists them, built into BreadPilot's model list (bytes). */
export interface BuiltInSizes {
  downloadBytes: number;
  weightsBytes: number;
  visionBytes: number;
  draftBytes: number;
  parameters: string | null;
  quantization: string | null;
}

/** What Ollama measured on this computer after loading the model once. */
export interface Measured {
  bytes: number;
  numCtx: number;
  at: string;
}

export type FitKind = "fits" | "tight" | "too-big" | "unknown";
export type Tier = "small" | "medium" | "large";

/** One row of GET /api/models/local. */
export interface LocalModel {
  tag: string;
  name: string;
  family: string | null;
  note: string | null;
  default: boolean;
  inCatalog: boolean;
  installed: boolean;
  installedBytes: number | null;
  sizes: BuiltInSizes | null;
  parameters: string | null;
  quantization: string | null;
  tier: Tier | null;
  measured: Measured | null;
  fit: { kind: FitKind; reason: string };
  selected: boolean;
}

/** GET /api/models/local: BreadPilot's model list merged with the local Ollama. */
export interface LocalModelsView {
  totalMemoryBytes: number;
  numCtx: number;
  selected: string;
  ollamaError: string | null;
  models: LocalModel[];
  others: LocalModel[];
}

export interface LlmOptions {
  /** name: the model list's name for the tag (else the tag itself). */
  local: { model: string; name?: string };
  openai: { available: true; model: string } | { available: false };
}
