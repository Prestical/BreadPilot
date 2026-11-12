// Agent pipeline: a state machine where the LLM does language work and
// code does everything electrical.
//
//   intake ─┬─ unsupported parts (rules) ──────────────────────────────▶ HANDOFF
//           ├─ minimum parts don't fit (rules) ────────────────────────▶ HANDOFF
//           └─ plan ─┬─ vague / ambiguous / too short ─▶ AWAIT_APPROVAL ─(approve | feedback)─┐
//                    └─ clear (auto-approved) ──────────────────────────────────────────────┤
//   build:  design ⟲ (missing parts or layout errors → re-plan, ≤3 repairs) → validate gate
//           → steps (code-written) → code ⟲ (checker errors → repair, ≤3 repairs) ─┬─▶ READY
//                                                                                 └─▶ HANDOFF
// Failures (LLM unreachable, time budget used up) → FAILED, resumable from the failed stage.
// Every loop is bounded; a project never runs longer than the time budget.

import { randomUUID } from "node:crypto";
import {
  buildSteps,
  checkMicroPython,
  getBoard,
  layoutProject,
  LayoutError,
  packByKind,
  stableRequests,
  changeSteps,
  canonicalJson,
  validateBuild,
  type BlockRequest,
  type Board,
  type CodeIssue,
  type Layout,
  type PowerMode,
} from "@breadpilot/circuit-core";
import { addUsage, LlmError, type LlmCallOptions, type LlmClient, type LlmResult, type TokenUsage } from "./llm";
import { AGENT_PACKS, agentOf, joinList } from "./packText";
import type { ProgressBus } from "./progress";
import { currentPlan, type LlmChoice, type Project, type ProjectBuild, type ProjectStore, type StageEvent } from "./project";
import { codeMessages, importBlock, intakeMessages, needsNetwork, pinTable, planMessages, type CodeChange } from "./prompts";
import { repairProblems } from "./repair";
import { addVersion, currentVersionOf, ensureVersions, restoreVersion, RestoreError, syncCurrent } from "./versions";
import { analyzeIdea, mergeRequirements, minimumParts, planProblems, unsupportedMessage, type Requirements } from "./requirements";
import { CodeSchema, IntakeSchema, normalizeIntake, normalizePlan, PlanSchema, type Plan } from "./schemas";

export const MAX_REPAIRS = 3;
/** Output caps per stage (tokens), so a looping model stops early. */
export const MAX_TOKENS = { intake: 600, plan: 1200, code: 2500 } as const;
/** Whole-project time budget: a longer run stops as FAILED (it can be resumed), so the page always gets an answer. */
export const PROJECT_BUDGET_MS = 240_000;
const MIN_CALL_MS = 5_000;

export interface Reference {
  content: string;
  citation: string;
}

export interface AgentDeps {
  /** The local model (Ollama): the default for every project. */
  llm: LlmClient;
  /** OpenAI's model, only when an API key is set up; projects with llm "openai" use it. */
  cloudLlm?: LlmClient;
  store: ProjectStore;
  /** Documentation search for the code stage (optional: the pipeline works without RAG). */
  search?: (query: string) => Promise<Reference[]>;
  log?: (msg: string) => void;
  now?: () => Date;
  newId?: () => string;
  budgetMs?: number;
  /** Live stage events for the SSE route (optional). */
  progress?: ProgressBus;
}

/** `background`: return as soon as the request is accepted; the run continues and reports
 * through `deps.progress` (Milestone 5: the browser shows progress instead of waiting 20-60 s). */
export interface RunOptions {
  background?: boolean;
}

export interface CreateOptions extends RunOptions {
  /** Breadboard rails (default) or direct-to-Pico power wiring. */
  power?: PowerMode;
  /** Which model works on the project (default: the local one). */
  llm?: LlmChoice;
}

const powerOf = (p: Project): PowerMode => p.power ?? "rails";

const OPENAI_MISSING = "OpenAI isn't set up yet: add your OpenAI API key in Settings (⚙), or use the local model.";

/** The model a project uses; an OpenAI project fails clearly when the key has been removed since. */
function clientFor(deps: AgentDeps, p: Project): LlmClient {
  if ((p.llm ?? "local") === "local") return deps.llm;
  if (!deps.cloudLlm) throw new AgentError(OPENAI_MISSING, 400);
  return deps.cloudLlm;
}

export class AgentError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

class BudgetExceeded extends Error {}

/** The user pressed Stop: the run ends as FAILED and can be retried from the same stage. */
export class Stopped extends Error {}

export const STOPPED_MESSAGE = "Stopped by you. Retry to continue: finished stages are kept.";


type Stage = StageEvent["stage"];
type Resume = NonNullable<Project["resumeFrom"]>;

/** One project is worked on by one request at a time (single API process). */
const busy = new Set<string>();
/** The Stop switch of each running project. */
const stops = new Map<string, AbortController>();

export const isRunning = (id: string) => busy.has(id);

interface Work {
  project: Project;
  run: () => Promise<Project>;
}

/**
 * Locks the project, runs `prepare` (checks that must fail the request itself, e.g. 409/400),
 * then the long work. In the background the accepted project is returned at once. The lock is
 * released BEFORE "done" is emitted, so a listener that sees "done" never sees the project busy.
 */
async function schedule(deps: AgentDeps, id: string, prepare: () => Promise<Work>, opts: RunOptions = {}): Promise<Project> {
  if (busy.has(id)) throw new AgentError("This project is already being worked on. Wait for it to finish.", 409);
  busy.add(id);
  stops.set(id, new AbortController());
  let work: Work;
  try {
    work = await prepare();
  } catch (err) {
    busy.delete(id);
    stops.delete(id);
    throw err;
  }
  const accepted = structuredClone(work.project);
  const done = work.run().then(
    (p) => {
      busy.delete(id);
      stops.delete(id);
      deps.progress?.emit(id, { type: "done", project: p });
      return p;
    },
    (err: unknown) => {
      busy.delete(id);
      stops.delete(id);
      deps.progress?.emit(id, { type: "error", message: (err as Error).message });
      throw err;
    },
  );
  if (!opts.background) return done;
  done.catch((err: unknown) => deps.log?.(`agent[${id.slice(0, 8)}] background run crashed: ${(err as Error).message}`));
  return accepted;
}

class Run {
  private started = performance.now();
  /** LLM calls per stage in this run, so the UI can say "attempt 2". */
  private calls: Partial<Record<Stage, number>> = {};
  constructor(
    readonly deps: AgentDeps,
    public p: Project,
  ) {}

  readonly now = () => (this.deps.now?.() ?? new Date()).toISOString();

  event(stage: Stage, status: StageEvent["status"], ms: number, detail?: string) {
    const at = this.now();
    this.p.events.push({ stage, status, ms, at, ...(detail ? { detail } : {}) });
    this.deps.progress?.emit(this.p.id, { type: "stage", stage, status, ms, at, ...(detail ? { detail } : {}), ...(this.p.usage ? { usage: this.p.usage } : {}) });
    this.deps.log?.(`agent[${this.p.id.slice(0, 8)}] ${stage} ${status}${detail ? `: ${detail}` : ""} (${ms} ms)`);
  }

  /** Runs one LLM call within what's left of the time budget. */
  async llm<T>(stage: Stage, call: (opts: Pick<LlmCallOptions, "timeoutMs" | "signal">) => Promise<LlmResult<T>>): Promise<T> {
    const left = (this.deps.budgetMs ?? PROJECT_BUDGET_MS) - (performance.now() - this.started);
    if (left < MIN_CALL_MS) throw new BudgetExceeded(`This took longer than ${Math.round((this.deps.budgetMs ?? PROJECT_BUDGET_MS) / 1000)} s, so it was stopped. Retry to continue; finished stages are kept.`);
    const stop = stops.get(this.p.id)?.signal;
    if (stop?.aborted) throw new Stopped(STOPPED_MESSAGE);
    const attempt = (this.calls[stage] = (this.calls[stage] ?? 0) + 1);
    this.deps.progress?.emit(this.p.id, { type: "stage", stage, status: "start", attempt, at: this.now() });
    let r: LlmResult<T>;
    try {
      r = await call({ timeoutMs: Math.round(left), signal: stop });
    } catch (err) {
      if (err instanceof LlmError) this.count(err.usage);
      if (stop?.aborted) throw new Stopped(STOPPED_MESSAGE);
      throw err;
    }
    this.count(r.usage);
    this.event(stage, "ok", r.ms, r.attempts > 1 ? `valid JSON after ${r.attempts} attempts` : undefined);
    return r.data;
  }

  /** Adds a call's tokens to the project's total (kept even when the run fails later). */
  private count(usage: TokenUsage) {
    const u = this.p.usage ?? { input: 0, output: 0, reasoning: 0, calls: 0 };
    this.p.usage = { ...addUsage(u, usage), calls: u.calls + 1 };
  }

  async save() {
    this.p.updatedAt = this.now();
    await this.deps.store.save(this.p);
  }
}

// ---------------------------------------------------------------- requirements

/** The idea, overridden by each piece of user feedback in order (automatic fixes don't count). */
export function requirementsOf(p: Project, board: Board): Requirements {
  return p.plans.reduce((req, plan) => (plan.feedback ? mergeRequirements(req, analyzeIdea(plan.feedback, board)) : req), analyzeIdea(p.idea, board));
}


/** Detects requests that can never fit (e.g. 10 LEDs, 4 knobs) before spending LLM calls on repairs. */
function impossibleRequest(req: Requirements, board: Board, power: PowerMode): string | null {
  const needed = minimumParts(req);
  if (!needed.length) return null;
  try {
    layoutProject(needed, board, { power });
    return null;
  } catch (err) {
    if (!(err instanceof LayoutError)) throw err;
    const list = Object.entries(req.parts).map(([k, n]) => `${n.min} ${agentOf(k).names.count[n.min === 1 ? 0 : 1]}`).join(", ");
    return `This needs at least ${list}, which can't be built: ${err.message}`;
  }
}

// ---------------------------------------------------------------- public API

export async function createProject(deps: AgentDeps, idea: string, board = "pico-2-w", opts: CreateOptions = {}): Promise<Project> {
  const text = idea.trim();
  if (text.length < 3) throw new AgentError("Describe your project idea in a few words.", 400);
  if (text.length > 2000) throw new AgentError("Please keep the idea under 2000 characters.", 400);
  const canonical = getBoard(board)?.id;
  if (!canonical) throw new AgentError(`Unknown board "${board}".`, 400);
  if (opts.llm === "openai" && !deps.cloudLlm) throw new AgentError(OPENAI_MISSING, 400);
  const at = (deps.now?.() ?? new Date()).toISOString();
  // Stored as FAILED + resumeFrom until the first stage finishes, so a crash mid-run leaves a
  // project that can simply be retried.
  const p: Project = {
    id: deps.newId?.() ?? randomUUID(),
    idea: text,
    board: canonical,
    title: text.slice(0, 60),
    state: "FAILED",
    power: opts.power ?? "rails",
    llm: opts.llm ?? "local",
    plans: [],
    events: [],
    resumeFrom: "intake",
    createdAt: at,
    updatedAt: at,
  };
  return schedule(
    deps,
    p.id,
    async () => {
      await deps.store.create(p);
      return { project: p, run: () => runFrom(deps, p, "intake") };
    },
    opts,
  );
}

export async function approvePlan(deps: AgentDeps, id: string, feedback?: string, opts: RunOptions = {}): Promise<Project> {
  return schedule(
    deps,
    id,
    async () => {
      const p = await load(deps, id);
      if (p.state !== "AWAIT_APPROVAL") throw new AgentError(`This project is ${p.state}; only a plan waiting for approval can be approved.`, 409);
      const board = getBoard(p.board)!;
      const change = feedback?.trim();
      if (!change) {
        // M9: the plan of a change that needs other parts: build it on top of the old layout.
        if (p.pendingChange) return { project: p, run: () => applyChange(deps, p) };
        currentPlan(p)!.approved = true;
        return { project: p, run: () => runFrom(deps, p, "build") };
      }
      const found = analyzeIdea(change, board).unsupported;
      if (found.length) throw new AgentError(unsupportedMessage(found), 400);
      const revise = async () => {
        const run = new Run(deps, p);
        try {
          const req = mergeRequirements(requirementsOf(p, board), analyzeIdea(change, board));
          const plan = normalizePlan(
            await run.llm("plan", (o) => clientFor(deps, p).json(PlanSchema, planMessages(p.idea, p.intake!, { feedback: change, previous: currentPlan(p) }), { ...o, maxTokens: MAX_TOKENS.plan })),
            req.pins,
          );
          p.plans.push({ ...plan, version: p.plans.length + 1, approved: false, feedback: change });
          p.title = plan.title;
          p.state = "AWAIT_APPROVAL";
          return finish(run);
        } catch (err) {
          // M9: adjusting a waiting change that fails leaves the project as it was before the change.
          const pc = p.pendingChange;
          if (pc) {
            revertChange(run, { plans: p.plans.slice(0, pc.planCount), build: p.build, ...pc.before }, pc.request, `The change was stopped: ${(err as Error).message}`);
            return finish(run);
          }
          return fail(run, err, "plan");
        }
      };
      return { project: p, run: revise };
    },
    opts,
  );
}

/** Stops a running project at its current LLM call; it ends as FAILED and can be retried. */
export async function stopProject(deps: AgentDeps, id: string): Promise<void> {
  const stop = stops.get(id);
  if (!stop) {
    if (!(await deps.store.get(id))) throw new AgentError("Project not found.", 404);
    throw new AgentError("This project isn't running.", 409);
  }
  stop.abort();
}

export async function retryProject(deps: AgentDeps, id: string, opts: RunOptions = {}): Promise<Project> {
  return schedule(
    deps,
    id,
    async () => {
      const p = await load(deps, id);
      if (p.state !== "FAILED") throw new AgentError(`Only a failed project can be retried (this one is ${p.state}).`, 409);
      return { project: p, run: () => runFrom(deps, p, p.resumeFrom ?? "intake") };
    },
    opts,
  );
}

/**
 * Switches between breadboard-rail and direct-to-Pico power. Code only, no LLM: the same plan is
 * laid out again (same GPIOs and part positions, only the GND/3V3 wires change), validated, the
 * steps rebuilt and the existing code re-checked against the new wiring. A project without a
 * build just remembers the choice for when it's built.
 */
export async function setPower(deps: AgentDeps, id: string, power: PowerMode): Promise<Project> {
  return schedule(deps, id, async () => {
    const p = await load(deps, id);
    const run = new Run(deps, p);
    const relayout = async () => {
      if (powerOf(p) === power) return p;
      const pb = p.build;
      const plan = currentPlan(p);
      if (pb && plan) {
        const board = getBoard(p.board)!;
        const start = performance.now();
        let layout: Layout;
        try {
          layout = layoutProject(planToRequests(plan), board, { power });
        } catch (err) {
          if (err instanceof LayoutError) throw new AgentError(err.message, 400);
          throw err;
        }
        // The code was written for these GPIOs; a different allocation would invalidate it.
        // Key order doesn't count: stored blocks come back from JSONB with their keys re-ordered.
        if (canonicalJson(layout.blocks) !== canonicalJson(pb.blocks)) throw new AgentError("Switching the power wiring would change the parts' pins, so it was not applied.", 409);
        const report = validateBuild(layout.build);
        if (!report.ok) throw new Error(`Internal error: the ${power} layout failed validation (${report.issues[0]?.message}).`);
        const check = pb.code ? checkMicroPython(pb.code, layout.build, board) : undefined;
        if (pb.codeCheck?.ok && check && !check.ok) throw new AgentError("The code doesn't match the new wiring, so the switch was not applied.", 409);
        pb.build = layout.build;
        pb.steps = buildSteps(layout.build);
        if (check) pb.codeCheck = check;
        syncCurrent(p); // the same version, wired for the other power mode
        run.event("design", "ok", Math.round(performance.now() - start), power === "direct" ? "power wires moved straight to the Pico's pins" : "power wires moved to the breadboard rails");
      }
      p.power = power;
      await run.save();
      return p;
    };
    // Layout problems must fail the request itself (400), so the switch runs in `prepare`.
    const updated = await relayout();
    return { project: updated, run: async () => updated };
  });
}

// ---------------------------------------------------------------- M9: changing a finished project

export interface ReviseOptions extends RunOptions {
  /** The model for this change (the prompt bar's choice at the time); the project keeps it afterwards. */
  llm?: LlmChoice;
  /** The user's own edited code to start from ("Start from my edited code"); else the generated code. */
  baseCode?: string;
}

/** What a plan asks the layout for (kind, pin, settings), order ignored: equal = the same parts. */
const partsKey = (plan: Plan) => JSON.stringify(planToRequests(plan).map((r) => canonicalJson(r)).sort());

/** The finished state a change starts from, to go back to when the change can't be made. */
interface Before {
  plans: Project["plans"];
  build?: ProjectBuild;
  state: "READY" | "HANDOFF";
  title: string;
  handoffReason?: string;
}

const HANDOFF_TAIL = / The handoff bundle describes the project for a stronger assistant\.$/;

/** A change that couldn't be made leaves the project exactly as it was, with the reason. */
function revertChange(run: Run, before: Before, request: string, message: string) {
  const p = run.p;
  p.plans = before.plans;
  p.build = before.build;
  p.state = before.state;
  p.title = before.title;
  if (before.handoffReason) p.handoffReason = before.handoffReason;
  else delete p.handoffReason;
  delete p.pendingChange;
  p.changeError = { request, message: message.replace(HANDOFF_TAIL, ""), at: run.now() };
  run.event("code", "error", 0, `change not made: ${p.changeError.message}`);
}

/** A change that worked becomes the project's new version, made from the version that was current. */
function keepChange(run: Run, request: string) {
  delete run.p.changeError;
  delete run.p.pendingChange;
  const parent = currentVersionOf(run.p);
  addVersion(run.p, run.now(), { request, model: clientFor(run.deps, run.p).model, ...(parent ? { parent } : {}) });
}

const CODE_CHANGE_FAILED = `BreadPilot couldn't write code for this change that passes the checks after ${MAX_REPAIRS + 1} tries, so your project was left as it was.`;

/**
 * M9: a change to a finished project ("make it blink faster", "add a buzzer"). The rules check the
 * request; one plan call turns the old plan + the request into the new plan. The same parts → the
 * code is changed now (a new version). Other parts → the new plan waits for the user's approval
 * (AWAIT_APPROVAL; approvePlan builds it on the old layout, cancelChange drops it). A change that
 * can't be made leaves the project as it was (changeError says why).
 */
export async function reviseProject(deps: AgentDeps, id: string, request: string, opts: ReviseOptions = {}): Promise<Project> {
  return schedule(
    deps,
    id,
    async () => {
      const p = await load(deps, id);
      if (p.state !== "READY" && p.state !== "HANDOFF") throw new AgentError(`Only a finished project can be changed (this one is ${p.state === "AWAIT_APPROVAL" ? "waiting for its plan to be approved" : p.state}).`, 409);
      const plan = currentPlan(p);
      if (!plan || !p.build || !p.intake) throw new AgentError("This project has no build to change yet. Start a new project instead.", 409);
      const change = request.trim();
      if (change.length < 3) throw new AgentError("Describe the change in a few words.", 400);
      if (change.length > 2000) throw new AgentError("Please keep the change under 2000 characters.", 400);
      if (opts.baseCode !== undefined && opts.baseCode.length > 20_000) throw new AgentError("The edited code is too long to start from.", 400);
      const board = getBoard(p.board)!;
      const found = analyzeIdea(change, board).unsupported;
      if (found.length) throw new AgentError(unsupportedMessage(found), 400);
      if (opts.llm === "openai" && !deps.cloudLlm) throw new AgentError(OPENAI_MISSING, 400);
      if (opts.llm) p.llm = opts.llm;
      const base = opts.baseCode?.trim() ? opts.baseCode : p.build.code;
      const state = p.state;
      const before: Before = structuredClone({ plans: p.plans, build: p.build, state, title: p.title, ...(p.handoffReason ? { handoffReason: p.handoffReason } : {}) });
      const run = async () => {
        const r = new Run(deps, p);
        try {
          const req = mergeRequirements(requirementsOf(p, board), analyzeIdea(change, board));
          const next = normalizePlan(await r.llm("plan", (o) => clientFor(deps, p).json(PlanSchema, planMessages(p.idea, p.intake!, { feedback: change, previous: plan }), { ...o, maxTokens: MAX_TOKENS.plan })), req.pins);
          const planCount = p.plans.length;
          const sameParts = partsKey(next) === partsKey(plan);
          p.plans.push({ ...next, version: planCount + 1, approved: sameParts, feedback: change });
          if (!sameParts) {
            p.pendingChange = { request: change, ...(opts.baseCode?.trim() ? { baseCode: opts.baseCode } : {}), planCount, before: { state, title: p.title, ...(p.handoffReason ? { handoffReason: p.handoffReason } : {}) } };
            p.title = next.title;
            p.state = "AWAIT_APPROVAL";
            r.event("design", "ok", 0, "the change needs other parts: waiting for your approval");
            return finish(r);
          }
          p.title = next.title;
          r.event("design", "ok", 0, "same parts and wiring: only the code changes");
          const pb = p.build!;
          pb.changeSteps = []; // nothing to rebuild on the breadboard
          delete pb.changeFrom;
          await generateCode(r, deps, { build: pb.build, blocks: pb.blocks }, board, base ? { code: base, request: change, rewired: false } : undefined);
          if (p.state === "READY") keepChange(r, change);
          else revertChange(r, before, change, CODE_CHANGE_FAILED);
        } catch (err) {
          revertChange(r, before, change, `The change was stopped: ${(err as Error).message}`);
        }
        return finish(r);
      };
      return { project: p, run };
    },
    opts,
  );
}

/** M9: the approved plan of a change: built on the old layout (kept parts stay), then the code changed. */
async function applyChange(deps: AgentDeps, p: Project): Promise<Project> {
  const run = new Run(deps, p);
  const board = getBoard(p.board)!;
  const pc = p.pendingChange!;
  const before: Before = { plans: structuredClone(p.plans.slice(0, pc.planCount)), build: structuredClone(p.build), ...pc.before };
  try {
    currentPlan(p)!.approved = true;
    const old: Layout | undefined = p.build ? { build: p.build.build, blocks: p.build.blocks } : undefined;
    const base = pc.baseCode ?? p.build?.code;
    if (!old) throw new Error("this project has no earlier build to change");
    await build(run, deps, board, { stable: old, ...(base ? { code: { code: base, request: pc.request, rewired: true } } : {}) });
    if (p.state === "READY") {
      p.build!.changeSteps = changeSteps(old.build, p.build!.build); // only what changes on the breadboard
      p.build!.changeFrom = old.build; // the 3D view shows what's taken out
      keepChange(run, pc.request);
    }
    else revertChange(run, before, pc.request, p.handoffReason ? p.handoffReason : CODE_CHANGE_FAILED);
  } catch (err) {
    revertChange(run, before, pc.request, `The change was stopped: ${(err as Error).message}`);
  }
  return finish(run);
}

/** M9: drops a change that waits for approval; the project goes back to how it was. */
export async function cancelChange(deps: AgentDeps, id: string): Promise<Project> {
  return schedule(deps, id, async () => {
    const p = await load(deps, id);
    const pc = p.pendingChange;
    if (p.state !== "AWAIT_APPROVAL" || !pc) throw new AgentError("There's no change waiting for approval.", 409);
    p.plans = p.plans.slice(0, pc.planCount);
    p.state = pc.before.state;
    p.title = pc.before.title;
    if (pc.before.handoffReason) p.handoffReason = pc.before.handoffReason;
    else delete p.handoffReason;
    delete p.pendingChange;
    p.updatedAt = (deps.now?.() ?? new Date()).toISOString();
    await deps.store.save(p);
    return { project: p, run: async () => p };
  });
}

/** M9: brings back version n as a new version. Code only, no LLM; refused while the project runs. */
export async function restoreProjectVersion(deps: AgentDeps, id: string, n: number): Promise<Project> {
  return schedule(deps, id, async () => {
    const p = await load(deps, id);
    try {
      restoreVersion(p, n, (deps.now?.() ?? new Date()).toISOString());
    } catch (err) {
      if (err instanceof RestoreError) throw new AgentError(err.message, err.status);
      throw err;
    }
    await deps.store.save(p);
    return { project: p, run: async () => p };
  });
}

/** Deletes a project for good. A project that is still being worked on can't be deleted (409). */
export async function deleteProject(deps: AgentDeps, id: string): Promise<void> {
  if (busy.has(id)) throw new AgentError("This project is still being worked on. Wait for it to finish, then delete it.", 409);
  if (!(await deps.store.delete(id))) throw new AgentError("Project not found.", 404);
  deps.log?.(`agent[${id.slice(0, 8)}] deleted`);
}

// ---------------------------------------------------------------- internals

async function load(deps: AgentDeps, id: string): Promise<Project> {
  const p = await deps.store.get(id);
  if (!p) throw new AgentError("Project not found.", 404);
  return ensureVersions(p); // projects made before M9 get their version 1
}

async function finish(run: Run): Promise<Project> {
  delete run.p.failure;
  delete run.p.resumeFrom;
  // A project's first finished build becomes version 1 (M9).
  ensureVersions(run.p, clientFor(run.deps, run.p).model, run.now());
  await run.save();
  return run.p;
}

async function fail(run: Run, err: unknown, resume: Resume): Promise<Project> {
  run.p.state = "FAILED";
  run.p.failure = (err as Error).message;
  run.p.resumeFrom = resume;
  run.event(resume === "build" ? "design" : resume, "error", 0, run.p.failure);
  await run.save();
  return run.p;
}

function handoff(p: Project, reason: string) {
  p.state = "HANDOFF";
  p.handoffReason = `${reason} The handoff bundle describes the project for a stronger assistant.`;
}

async function runFrom(deps: AgentDeps, p: Project, from: Resume): Promise<Project> {
  const run = new Run(deps, p);
  const board = getBoard(p.board)!;
  let stage: Resume = from;
  try {
    if (stage === "intake") {
      const req = analyzeIdea(p.idea, board);
      const intake = normalizeIntake(await run.llm("intake", (o) => clientFor(deps, p).json(IntakeSchema, intakeMessages(p.idea), { ...o, maxTokens: MAX_TOKENS.intake })));
      const questions: string[] = [...req.ambiguous];
      if (req.unsupported.length) {
        Object.assign(intake, { clarity: "unsupported", unsupportedParts: req.unsupported });
      } else if (intake.clarity === "unsupported") {
        // The rules found nothing unsupported but the model thinks so: don't block, ask.
        const parts = intake.unsupportedParts.length ? intake.unsupportedParts.join(", ") : "parts that aren't supported";
        questions.push(`This might need ${parts}. Can it be done with ${joinList(AGENT_PACKS.flatMap((x) => (x.agent!.names.short ? [x.agent!.names.short[1]] : [])), "and")} instead? If not, ask for the handoff bundle.`);
        intake.clarity = "vague";
      }
      if (intake.clarity !== "unsupported" && (req.tooShort || questions.length)) intake.clarity = "vague";
      p.ruleQuestions = questions;
      p.intake = intake;
      p.title = intake.title;

      if (intake.clarity === "unsupported") {
        handoff(p, unsupportedMessage(intake.unsupportedParts.length ? intake.unsupportedParts : ["parts that aren't supported yet"]));
        return finish(run);
      }
      const impossible = impossibleRequest(req, board, powerOf(p));
      if (impossible) {
        handoff(p, impossible);
        return finish(run);
      }
      stage = "plan";
    }

    if (stage === "plan") {
      const req = requirementsOf(p, board);
      const plan = normalizePlan(await run.llm("plan", (o) => clientFor(deps, p).json(PlanSchema, planMessages(p.idea, p.intake!), { ...o, maxTokens: MAX_TOKENS.plan })), req.pins);
      // Questions raised by the rules come first, so the user sees them.
      plan.questions = [...new Set([...(p.ruleQuestions ?? []), ...plan.questions])].slice(0, 4);
      const clear = p.intake!.clarity === "clear";
      p.plans.push({ ...plan, version: p.plans.length + 1, approved: clear });
      p.title = plan.title;
      if (!clear) {
        p.state = "AWAIT_APPROVAL";
        return finish(run);
      }
      stage = "build";
    }

    await build(run, deps, board);
    return finish(run);
  } catch (err) {
    return fail(run, err, stage);
  }
}

/** Plan fields the part's layout asks for (agent.json plan.props), with the layout's default. */
function planProps(part: Plan["parts"][number]): Pick<BlockRequest, "props"> {
  const fields = Object.entries(agentOf(part.kind).plan.props ?? {});
  if (!fields.length) return {};
  const layout = packByKind(part.kind)!.layout!;
  const fallback = (request: string) => layout.parts.flatMap((x) => Object.values(x.props ?? {})).find((v) => v.request === request)!.default;
  return { props: Object.fromEntries(fields.map(([field, request]) => [request, part[field] ?? fallback(request)])) };
}

export function planToRequests(plan: Plan): BlockRequest[] {
  return plan.parts.map((part) => ({
    kind: part.kind,
    ...(part.pin ? { pin: part.pin } : {}),
    ...planProps(part),
  }));
}

/** M9: build on top of an old layout (kept parts stay where they are) and change its code. */
interface BuildChange {
  stable: Layout;
  code?: CodeChange;
}

async function build(run: Run, deps: AgentDeps, board: Board, change?: BuildChange): Promise<void> {
  const p = run.p;
  const req = requirementsOf(p, board);
  const impossible = impossibleRequest(req, board, powerOf(p));
  if (impossible) return handoff(p, impossible);

  // Design: the plan must cover the request (checked in code), then the layout engine places
  // parts and wires. Either kind of problem goes back to the LLM as a plan fix (bounded).
  let layout: Layout | null = null;
  for (let attempt = 0; ; attempt++) {
    const plan = currentPlan(p)!;
    const start = performance.now();
    let problem = planProblems(plan, req).join(" ");
    if (!problem) {
      try {
        layout = change
          ? layoutProject(stableRequests(change.stable, planToRequests(plan)), board, { power: powerOf(p), reservedRefs: change.stable.build.parts.map((x) => x.ref) })
          : layoutProject(planToRequests(plan), board, { power: powerOf(p) });
      } catch (err) {
        if (!(err instanceof LayoutError)) throw err;
        problem = err.message;
      }
    }
    if (layout) {
      run.event("design", "ok", Math.round(performance.now() - start), layout.blocks.length ? `${layout.blocks.length} parts on ${layout.blocks.map((b) => b.gpio).join(", ")}` : "on-board LED only");
      break;
    }
    run.event("design", attempt < MAX_REPAIRS ? "retry" : "error", Math.round(performance.now() - start), problem);
    if (attempt >= MAX_REPAIRS) {
      return handoff(p, `The plan couldn't be turned into a breadboard layout that matches the request (${problem}).`);
    }
    const fixed = normalizePlan(
      await run.llm("plan", (o) => clientFor(deps, p).json(PlanSchema, planMessages(p.idea, p.intake!, { previous: plan, fixError: problem }), { ...o, maxTokens: MAX_TOKENS.plan })),
      req.pins,
    );
    p.plans.push({ ...fixed, version: p.plans.length + 1, approved: true, autoFix: problem });
  }

  // Safety gate: never continue with a build the validator rejects.
  const report = validateBuild(layout.build);
  if (!report.ok) throw new Error(`Internal error: the generated layout failed validation (${report.issues[0]?.message}).`);

  const steps = buildSteps(layout.build);
  run.event("steps", "ok", 0, `${steps.length} steps`);
  p.build = { build: layout.build, blocks: layout.blocks, steps, codeAttempts: 0, citations: [] };

  await generateCode(run, deps, layout, board, change?.code);
}

async function references(deps: AgentDeps, layout: Layout): Promise<Reference[]> {
  if (!deps.search) return [];
  const kinds = [...new Set(layout.blocks.map((b) => b.kind))];
  const seen = new Set<string>();
  const refs: Reference[] = [];
  for (const kind of kinds) {
    try {
      for (const r of await deps.search(agentOf(kind).code.ragQuery)) {
        if (seen.has(r.citation + r.content) || refs.length >= 5) continue;
        seen.add(r.citation + r.content);
        refs.push({ content: r.content.length > 700 ? `${r.content.slice(0, 700)}…` : r.content, citation: r.citation });
      }
    } catch {
      /* documentation search is optional */
    }
  }
  return refs;
}

async function generateCode(run: Run, deps: AgentDeps, layout: Layout, board: Board, change?: CodeChange): Promise<void> {
  const p = run.p;
  const pb = p.build!;
  const plan = currentPlan(p)!;
  // Part colours for the pin table (parts with a "color" prop, e.g. LEDs).
  const colors = Object.fromEntries(layout.build.parts.filter((x) => x.props?.color !== undefined).map((x) => [x.ref, String(x.props!.color)]));
  const refs = await references(deps, layout);
  pb.citations = [...new Set(refs.map((r) => r.citation))];
  const refText = refs.map((r) => `[${r.citation}]\n${r.content}`).join("\n\n");
  const pins = pinTable(layout.blocks, colors);
  const network = needsNetwork([p.idea, plan.goal, ...plan.behavior, ...p.plans.map((x) => x.feedback ?? "")].join(" "));

  let fix: { code: string; problems: string[] } | undefined;
  let previous: CodeIssue[] = [];
  for (let attempt = 0; attempt <= MAX_REPAIRS; attempt++) {
    const out = await run.llm("code", (o) => clientFor(deps, p).json(CodeSchema, codeMessages(plan, pins, refText, fix, network, importBlock(layout.blocks, network), change), { ...o, maxTokens: MAX_TOKENS.code }));
    const check = checkMicroPython(out.code, layout.build, board);
    pb.code = out.code;
    pb.codeExplanation = out.explanation;
    pb.codeCheck = check;
    pb.codeAttempts = attempt + 1;
    (pb.codeHistory ??= []).push({ attempt: attempt + 1, ok: check.ok, issues: check.issues, code: out.code });
    if (check.ok) {
      p.state = "READY";
      return;
    }
    const problems = check.issues.filter((i) => i.severity === "error").map((i) => i.message);
    run.event("code", attempt < MAX_REPAIRS ? "retry" : "error", 0, problems.join(" | "));
    // The model gets its own wrong lines, the corrected lines and imports, and which mistakes repeat.
    fix = { code: out.code, problems: repairProblems(out.code, check.issues, previous) };
    previous = check.issues;
  }
  handoff(p, `The wiring and build steps are ready and checked, but the local model couldn't write code that matches the wiring after ${MAX_REPAIRS + 1} tries.`);
}

export { BudgetExceeded };
