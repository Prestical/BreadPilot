// M11 11.6: a project saved to a file and opened again (on this computer or another one).
//
// Export: the whole project as JSON, in an envelope that says what the file is.
// Import: nothing in the file is trusted. Its fields are checked by shape, every board in it (the
// current one, the old board of a change, every version's) goes through the same safety validator
// as a new build, and what BreadPilot derives from a board is made again from the checked board
// rather than read from the file: the build steps, the change steps and the code check. A file
// that doesn't pass is refused as a whole; the imported project gets a new id.

import { buildSteps, changeSteps, checkMicroPython, getBoard, POWER_MODES, StepsError, validateBuild, type Build, type PowerMode } from "@breadpilot/circuit-core";
import * as z from "zod/v4";
import { LLM_CHOICES, type Project, type ProjectBuild } from "./project";
import { IntakeSchema, PlanSchema } from "./schemas";
import type { ProjectVersion } from "./versions";

export const EXPORT_FORMAT = "breadpilot-project";
export const EXPORT_VERSION = 1;
/** The biggest file accepted (a project with a long change history is well under 1 MB). */
export const IMPORT_LIMIT_BYTES = 5 * 1024 * 1024;

export interface ProjectFile {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  /** The BreadPilot version that wrote it (desktop app), for reading old files later. */
  app?: string;
  project: Project;
}

export function exportFile(p: Project, now: string, appVersion?: string | null): ProjectFile {
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: now, ...(appVersion ? { app: appVersion } : {}), project: p };
}

/** "Plant watering timer" → "plant-watering-timer.breadpilot.json". */
export function exportFileName(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "-")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${slug || "project"}.breadpilot.json`;
}

export class ImportError extends Error {}

const text = (max: number) => z.string().max(max);
const at = text(40);

const BuildShape = z.object({
  boardId: text(64),
  parts: z
    .array(z.object({ ref: text(32), type: text(64), legs: z.record(text(16), text(8)), props: z.record(z.string().max(64), z.union([text(200), z.number()])).optional() }).passthrough())
    .max(100),
  wires: z.array(z.object({ from: z.unknown(), to: z.unknown(), color: text(32).optional() }).passthrough()).max(300),
  gpioModes: z.record(text(8), text(16)),
});

const CodeIssueShape = z.object({ code: text(16), severity: z.enum(["error", "warning"]), message: text(2000) }).passthrough();

const ProjectBuildShape = z.object({
  build: BuildShape,
  blocks: z.array(z.record(z.string(), z.unknown())).max(100),
  changeFrom: BuildShape.optional(),
  changeSteps: z.array(z.unknown()).optional(),
  code: text(100_000).optional(),
  codeExplanation: text(20_000).optional(),
  codeAttempts: z.number().int().min(0).max(100),
  codeHistory: z.array(z.object({ attempt: z.number().int(), ok: z.boolean(), issues: z.array(CodeIssueShape).max(200), code: text(100_000) })).max(50).optional(),
  citations: z.array(text(2000)).max(50),
});

const StoredPlan = PlanSchema.extend({ version: z.number().int().min(1), approved: z.boolean(), feedback: text(2000).optional(), autoFix: text(2000).optional() });

const VersionShape = z.object({
  n: z.number().int().min(1),
  request: text(2000).optional(),
  parent: z.number().int().min(1).optional(),
  restoredFrom: z.number().int().min(1).optional(),
  llm: z.enum(LLM_CHOICES),
  model: text(200).optional(),
  planVersion: z.number().int().min(1),
  state: z.enum(["READY", "HANDOFF"]),
  handoffReason: text(4000).optional(),
  build: ProjectBuildShape.omit({ codeHistory: true }).optional(),
  createdAt: at,
});

const ProjectShape = z.object({
  idea: text(4000),
  board: text(64),
  title: z.string().trim().min(1).max(200),
  state: z.enum(["AWAIT_APPROVAL", "READY", "HANDOFF", "FAILED"]),
  power: z.enum(POWER_MODES as [PowerMode, ...PowerMode[]]).optional(),
  llm: z.enum(LLM_CHOICES).optional(),
  usage: z.object({ input: z.number().min(0), output: z.number().min(0), reasoning: z.number().min(0), calls: z.number().int().min(0) }).optional(),
  intake: IntakeSchema.optional(),
  plans: z.array(StoredPlan).min(1).max(200),
  ruleQuestions: z.array(text(2000)).max(50).optional(),
  build: ProjectBuildShape.optional(),
  handoffReason: text(4000).optional(),
  versions: z.array(VersionShape).max(500).optional(),
  currentVersion: z.number().int().min(1).optional(),
  pendingChange: z
    .object({
      request: text(2000),
      baseCode: text(100_000).optional(),
      planCount: z.number().int().min(1),
      before: z.object({ state: z.enum(["READY", "HANDOFF"]), title: text(200), handoffReason: text(4000).optional() }),
    })
    .optional(),
  changeError: z.object({ request: text(2000), message: text(4000), at }).optional(),
  failure: text(4000).optional(),
  resumeFrom: z.enum(["intake", "plan", "build"]).optional(),
  events: z
    .array(z.object({ stage: z.enum(["intake", "plan", "design", "steps", "code"]), status: z.enum(["ok", "retry", "error"]), detail: text(4000).optional(), ms: z.number().min(0), at }))
    .max(5000)
    .default([]),
  createdAt: at,
});

const FileShape = z.object({ format: z.literal(EXPORT_FORMAT), version: z.number().int(), project: z.unknown() });

/** Refuses a board that the safety validator doesn't pass; `where` says which board it was. */
function checkBoard(build: Build, where: string): void {
  let report: ReturnType<typeof validateBuild>;
  try {
    report = validateBuild(build);
  } catch {
    throw new ImportError(`The wiring of ${where} couldn't be read.`);
  }
  const first = report.issues.find((i) => i.severity === "error");
  if (first) throw new ImportError(`The wiring of ${where} didn't pass BreadPilot's safety check: ${first.message}`);
}

/** The build with everything derived from its board made again from the checked board. */
function rebuild(pb: z.infer<typeof ProjectBuildShape> | z.infer<typeof VersionShape>["build"], where: string, boardOk: (id: string) => boolean): ProjectBuild | undefined {
  if (!pb) return undefined;
  const build = pb.build as unknown as Build;
  if (!boardOk(build.boardId)) throw new ImportError(`The wiring of ${where} is for a board BreadPilot doesn't know ("${build.boardId}").`);
  checkBoard(build, where);
  const from = pb.changeFrom as unknown as Build | undefined;
  if (from) checkBoard(from, `${where} (before its change)`);
  let steps;
  let change;
  try {
    steps = buildSteps(build);
    // Only the changes after a change; [] = only the code changed; missing = a first build.
    change = from ? changeSteps(from, build) : pb.changeSteps?.length === 0 ? [] : undefined;
  } catch (err) {
    if (err instanceof StepsError) throw new ImportError(`The steps for ${where} couldn't be made: ${err.message}`);
    throw err;
  }
  const board = getBoard(build.boardId)!;
  const { changeSteps: _stored, ...rest } = pb as typeof pb & { changeSteps?: unknown };
  return {
    ...(rest as unknown as Omit<ProjectBuild, "steps" | "changeSteps" | "codeCheck">),
    steps,
    ...(change ? { changeSteps: change } : {}),
    ...(pb.code ? { codeCheck: checkMicroPython(pb.code, build, board) } : {}),
  };
}

/** Checks an exported file and turns it into a new project (new id, saved now). */
export function importProject(raw: unknown, opts: { id: string; now: string }): Project {
  const file = FileShape.safeParse(raw);
  if (!file.success) throw new ImportError("This isn't a BreadPilot project file (export one with Export in a project).");
  if (file.data.version > EXPORT_VERSION) throw new ImportError("This project was saved by a newer BreadPilot. Update BreadPilot, then open it again.");
  const parsed = ProjectShape.safeParse(file.data.project);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ImportError(`The project file is damaged or was changed by hand (${issue?.path.join(".") || "project"}: ${issue?.message}).`);
  }
  const p = parsed.data;
  if (!getBoard(p.board)) throw new ImportError(`This project is for a board BreadPilot doesn't know ("${p.board}").`);
  const boardOk = (id: string) => id === p.board;

  const versions = p.versions?.map((v) => ({ ...v, build: rebuild(v.build, `version ${v.n}`, boardOk) }) as ProjectVersion);
  const numbers = new Set(versions?.map((v) => v.n));
  if (versions && numbers.size !== versions.length) throw new ImportError("The project file lists the same version twice.");
  if (p.currentVersion !== undefined && !numbers.has(p.currentVersion)) throw new ImportError("The project file's current version isn't in its version list.");
  if (p.pendingChange && p.pendingChange.planCount > p.plans.length) throw new ImportError("The project file's waiting change points at a plan it doesn't have.");

  return {
    ...p,
    id: opts.id,
    build: rebuild(p.build, "the project", boardOk),
    ...(versions ? { versions } : {}),
    updatedAt: opts.now,
  } as Project;
}
