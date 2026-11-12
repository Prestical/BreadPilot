import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { handoffMarkdown } from "./handoff";
import { POWER_MODES, type PowerMode } from "@breadpilot/circuit-core";
import { AgentError, approvePlan, cancelChange, createProject, deleteProject, isRunning, restoreProjectVersion, retryProject, reviseProject, setPower, stopProject, type AgentDeps } from "./pipeline";
import { progressBus, type ProgressEvent } from "./progress";
import { LLM_CHOICES, type Project } from "./project";
import { ensureVersions } from "./versions";
import { catalogEntry } from "../models";

const Power = z.enum(POWER_MODES as [PowerMode, ...PowerMode[]]);
const CreateBody = z.object({ idea: z.string(), board: z.string().max(64).optional(), power: Power.optional(), llm: z.enum(LLM_CHOICES).optional() });
const PowerBody = z.object({ power: Power });
const ApproveBody = z.object({ feedback: z.string().max(1000).optional() });
/** M9: a change to a finished project; `llm` = the prompt bar's model, `baseCode` = the user's edits. */
const ReviseBody = z.object({ request: z.string().max(2000), llm: z.enum(LLM_CHOICES).optional(), baseCode: z.string().max(20_000).optional() });
/** `?async=1`: answer 202 at once and run in the background (progress via the events stream). */
const AsyncQuery = z.object({ async: z.enum(["1", "true", "0", "false"]).optional() });

/** SSE keep-alive: a comment line every 15 s keeps the event stream open while the AI works. */
export const SSE_HEARTBEAT_MS = 15_000;

// Projects made before M9 get their version 1 here, when they're read (saved with the next change).
const withRunning = (p: Project) => ({ ...ensureVersions(p), running: isRunning(p.id) });

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof AgentError) {
    const code = err.status === 404 ? "NOT_FOUND" : err.status === 409 ? "CONFLICT" : "BAD_REQUEST";
    return reply.status(err.status).send({ code, message: err.message });
  }
  throw err;
}

function background(req: FastifyRequest): boolean {
  const q = AsyncQuery.safeParse(req.query ?? {});
  return q.success && (q.data.async === "1" || q.data.async === "true");
}

export function registerAgentRoutes(app: FastifyInstance, deps: AgentDeps) {
  // The events stream needs the pipeline to report progress.
  deps.progress ??= progressBus();

  app.post("/api/projects", async (req, reply) => {
    const body = CreateBody.safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send({ code: "BAD_REQUEST", message: "Send {\"idea\": \"...\"}", details: body.error.issues });
    const bg = background(req);
    try {
      const p = await createProject(deps, body.data.idea, body.data.board, { background: bg, power: body.data.power, llm: body.data.llm });
      return reply.status(bg ? 202 : 201).send(withRunning(p));
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Which models a new project can use (the browser asks the user at the start). */
  app.get("/api/llm-options", async () => ({
    // The model list's name for the prompt bar ("Qwen3 4B Instruct"), else the tag itself.
    local: { model: deps.llm.model, name: catalogEntry(deps.llm.model)?.name ?? deps.llm.model },
    openai: deps.cloudLlm ? { available: true, model: deps.cloudLlm.model } : { available: false },
  }));

  app.get("/api/projects", async () => (await deps.store.list()).map((p) => ({ ...p, running: isRunning(p.id) })));

  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    const p = await deps.store.get(req.params.id);
    return p ? withRunning(p) : reply.status(404).send({ code: "NOT_FOUND", message: "Project not found." });
  });

  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (req, reply) => {
    try {
      await deleteProject(deps, req.params.id);
      return reply.status(204).send();
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/approve", async (req, reply) => {
    const body = ApproveBody.safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send({ code: "BAD_REQUEST", message: "Invalid request body", details: body.error.issues });
    const bg = background(req);
    try {
      const p = await approvePlan(deps, req.params.id, body.data.feedback, { background: bg });
      return reply.status(bg ? 202 : 200).send(withRunning(p));
    } catch (err) {
      return fail(reply, err);
    }
  });

  // M9: change a finished project. Code-only changes are made now; changes that need other parts
  // answer with the new plan waiting for approval (approve builds it, /revise/cancel drops it).
  app.post<{ Params: { id: string } }>("/api/projects/:id/revise", async (req, reply) => {
    const body = ReviseBody.safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send({ code: "BAD_REQUEST", message: 'Send {"request": "what to change"}', details: body.error.issues });
    const bg = background(req);
    try {
      const p = await reviseProject(deps, req.params.id, body.data.request, { background: bg, ...(body.data.llm ? { llm: body.data.llm } : {}), ...(body.data.baseCode !== undefined ? { baseCode: body.data.baseCode } : {}) });
      return reply.status(bg ? 202 : 200).send(withRunning(p));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/revise/cancel", async (req, reply) => {
    try {
      return withRunning(await cancelChange(deps, req.params.id));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/retry", async (req, reply) => {
    const bg = background(req);
    try {
      const p = await retryProject(deps, req.params.id, { background: bg });
      return reply.status(bg ? 202 : 200).send(withRunning(p));
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** Stops a running project at its current model call (202: the run ends as FAILED, Retry continues). */
  app.post<{ Params: { id: string } }>("/api/projects/:id/stop", async (req, reply) => {
    try {
      await stopProject(deps, req.params.id);
      return reply.status(202).send({ stopping: true });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post<{ Params: { id: string } }>("/api/projects/:id/power", async (req, reply) => {
    const body = PowerBody.safeParse(req.body ?? {});
    if (!body.success) return reply.status(400).send({ code: "BAD_REQUEST", message: 'Send {"power": "rails"} or {"power": "direct"}', details: body.error.issues });
    try {
      return withRunning(await setPower(deps, req.params.id, body.data.power));
    } catch (err) {
      return fail(reply, err);
    }
  });

  /** M9: brings back an older version as a new version (nothing is deleted). */
  app.post<{ Params: { id: string; n: string } }>("/api/projects/:id/versions/:n/restore", async (req, reply) => {
    const n = Number(req.params.n);
    if (!Number.isInteger(n) || n < 1) return reply.status(400).send({ code: "BAD_REQUEST", message: "The version must be a number from 1." });
    try {
      return withRunning(await restoreProjectVersion(deps, req.params.id, n));
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Server-sent events: `snapshot` (the stored project + running + `current`, the latest stage
  // event), then `progress` for each
  // stage event, then `done` with the final project (or `failed` if the run crashed), then the
  // stream closes. A project that isn't running gets snapshot + done straight away.
  app.get<{ Params: { id: string } }>("/api/projects/:id/events", async (req, reply) => {
    const id = req.params.id;
    // Subscribe before reading the store so nothing between the two is missed; events that
    // arrive before the snapshot is written are queued.
    const queue: ProgressEvent[] = [];
    let ready = false;
    let closed = false;
    let write: (e: ProgressEvent) => void = (e) => queue.push(e);
    const unsubscribe = deps.progress?.subscribe(id, (e) => (ready ? write(e) : queue.push(e))) ?? (() => {});
    const runningAtStart = isRunning(id);
    let p: Project | null;
    try {
      p = await deps.store.get(id);
    } catch (err) {
      unsubscribe();
      throw err;
    }
    if (!p) {
      unsubscribe();
      return reply.status(404).send({ code: "NOT_FOUND", message: "Project not found." });
    }

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-request-id": String(req.id),
    });
    const send = (event: string, data: unknown) => {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const heartbeat = setInterval(() => !closed && res.write(": ping\n\n"), SSE_HEARTBEAT_MS);
    heartbeat.unref?.();
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    };
    req.raw.on("close", close);

    write = (e) => {
      if (e.type === "stage") send("progress", e);
      else if (e.type === "done") {
        send("done", withRunning(e.project));
        close();
      } else {
        send("failed", { message: e.message });
        close();
      }
    };

    const current = runningAtStart ? deps.progress?.latest(id) : undefined;
    send("snapshot", { ...ensureVersions(p), running: runningAtStart, ...(current ? { current } : {}) });
    ready = true;
    for (const e of queue.splice(0)) write(e);
    // Not running when we subscribed → no "done" will ever come: the snapshot is final.
    if (!runningAtStart) {
      send("done", withRunning(p));
      close();
    }
  });

  app.get<{ Params: { id: string } }>("/api/projects/:id/handoff", async (req, reply) => {
    const p = await deps.store.get(req.params.id);
    if (!p) return reply.status(404).send({ code: "NOT_FOUND", message: "Project not found." });
    const disposition = (req.query as { download?: string } | undefined)?.download ? "attachment" : "inline";
    return reply.type("text/markdown; charset=utf-8").header("content-disposition", `${disposition}; filename="handoff-${p.id.slice(0, 8)}.md"`).send(handoffMarkdown(p));
  });
}
