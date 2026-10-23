import type pg from "pg";
import type { Build, BuildStep, CodeCheckReport, CodeIssue, PlacedBlock, PowerMode } from "@breadpilot/circuit-core";
import type { Intake, Plan } from "./schemas";
import type { TokenUsage } from "./llm";

export const LLM_CHOICES = ["local", "openai"] as const;
export type LlmChoice = (typeof LLM_CHOICES)[number];

export type ProjectState = "AWAIT_APPROVAL" | "READY" | "HANDOFF" | "FAILED";

export interface StageEvent {
  stage: "intake" | "plan" | "design" | "steps" | "code";
  status: "ok" | "retry" | "error";
  detail?: string;
  ms: number;
  at: string;
}

export interface ProjectBuild {
  build: Build;
  blocks: PlacedBlock[];
  steps: BuildStep[];
  code?: string;
  codeExplanation?: string;
  codeCheck?: CodeCheckReport;
  codeAttempts: number;
  /** Every code attempt with the checker's findings (used for repair stats and debugging). */
  codeHistory?: { attempt: number; ok: boolean; issues: CodeIssue[]; code: string }[];
  /** Documentation excerpts given to the code stage. */
  citations: string[];
}

export interface Project {
  id: string;
  idea: string;
  board: string;
  title: string;
  state: ProjectState;
  /** Where parts take GND/3V3 from: breadboard rails (default) or straight from Pico pins. */
  power?: PowerMode;
  /** Which language model works on it: the local one (default) or OpenAI's, chosen by the user. */
  llm?: LlmChoice;
  /** Tokens spent on this project so far, over all runs (retries and plan changes included). */
  usage?: TokenUsage & { calls: number };
  intake?: Intake;
  /** Plan versions. `feedback` = the user's change request; `autoFix` = problem fixed automatically. */
  plans: (Plan & { version: number; approved: boolean; feedback?: string; autoFix?: string })[];
  /** Questions the rules raised (ambiguous words, unclear pin numbers) to show with the plan. */
  ruleQuestions?: string[];
  build?: ProjectBuild;
  /** Why the project needs the handoff bundle (unsupported parts, code that kept failing). */
  handoffReason?: string;
  /** Last failure (e.g. the LLM was unreachable); the project can be retried. */
  failure?: string;
  /** The stage to resume from on retry. */
  resumeFrom?: "intake" | "plan" | "build";
  events: StageEvent[];
  createdAt: string;
  updatedAt: string;
}

export const currentPlan = (p: Project) => p.plans.at(-1);

export interface ProjectStore {
  create(p: Project): Promise<void>;
  save(p: Project): Promise<void>;
  get(id: string): Promise<Project | null>;
  list(): Promise<Pick<Project, "id" | "title" | "state" | "idea" | "updatedAt">[]>;
  /** Removes a project for good; false if it didn't exist. */
  delete(id: string): Promise<boolean>;
}

export function memoryStore(): ProjectStore {
  const items = new Map<string, Project>();
  return {
    async create(p) {
      items.set(p.id, structuredClone(p));
    },
    async save(p) {
      items.set(p.id, structuredClone(p));
    },
    async get(id) {
      const p = items.get(id);
      return p ? structuredClone(p) : null;
    },
    async delete(id) {
      return items.delete(id);
    },
    async list() {
      return [...items.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(({ id, title, state, idea, updatedAt }) => ({ id, title, state, idea, updatedAt }));
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function pgStore(pool: pg.Pool): ProjectStore {
  const write = (p: Project) => [p.id, p.title, p.board, p.idea, p.state, JSON.stringify(p), p.updatedAt];
  return {
    async create(p) {
      await pool.query("INSERT INTO projects (id, title, board, idea, state, data, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", write(p));
    },
    async save(p) {
      await pool.query("UPDATE projects SET title = $2, board = $3, idea = $4, state = $5, data = $6, updated_at = $7 WHERE id = $1", write(p));
    },
    async get(id) {
      if (!UUID.test(id)) return null;
      const { rows } = await pool.query<{ data: Project }>("SELECT data FROM projects WHERE id = $1", [id]);
      return rows[0]?.data ?? null;
    },
    async delete(id) {
      if (!UUID.test(id)) return false;
      // Rows that point at the project (messages, old plan/build tables) go with it: ON DELETE CASCADE.
      const { rowCount } = await pool.query("DELETE FROM projects WHERE id = $1", [id]);
      return (rowCount ?? 0) > 0;
    },
    async list() {
      const { rows } = await pool.query<{ id: string; title: string; state: Project["state"]; idea: string; updatedAt: Date }>(
        `SELECT id, title, state, idea, updated_at AS "updatedAt" FROM projects ORDER BY updated_at DESC LIMIT 100`,
      );
      return rows.map((r) => ({ ...r, updatedAt: new Date(r.updatedAt).toISOString() }));
    },
  };
}
