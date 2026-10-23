// Milestone 5: background runs, live progress events and the SSE stream.
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type * as z from "zod/v4";
import { buildApp } from "../src/app";
import { LlmError, type ChatMessage, type LlmClient } from "../src/agent/llm";
import { approvePlan, createProject, isRunning, setPower, type AgentDeps } from "../src/agent/pipeline";
import { progressBus, type ProgressEvent } from "../src/agent/progress";
import { memoryStore } from "../src/agent/project";
import { CodeSchema, IntakeSchema, PlanSchema } from "../src/agent/schemas";

type Stage = "intake" | "plan" | "code";

const INTAKE = { clarity: "clear", title: "Button LED", goal: "Light an LED while a button is pressed.", behaviors: ["Press → light"], missing: [], unsupportedParts: [] };
const PLAN = {
  title: "Button LED",
  goal: "Light an LED while a button is pressed.",
  behavior: ["Pressing the button lights the LED."],
  parts: [
    { kind: "led", purpose: "light", color: "green" },
    { kind: "button", purpose: "switch" },
  ],
  questions: [],
};
const GOOD_CODE = {
  code: "from machine import Pin\nimport time\n\nled = Pin(16, Pin.OUT)\nbutton = Pin(17, Pin.IN, Pin.PULL_UP)\n\nwhile True:\n    led.value(1 if button.value() == 0 else 0)\n    time.sleep(0.01)\n",
  explanation: "The LED is on while you hold the button.",
};
const BAD_CODE = { code: "from machine import Pin\nled = Pin(15, Pin.OUT)\n", explanation: "wrong pin" };

/** Scripted LLM (last reply repeats) that waits for `gate` before every answer. */
function scripted(script: Partial<Record<Stage, unknown[]>>, gate: Promise<void> = Promise.resolve()): LlmClient {
  const n: Record<Stage, number> = { intake: 0, plan: 0, code: 0 };
  return {
    model: "fake",
    async json<T>(schema: z.ZodType<T>, _m: ChatMessage[]) {
      await gate;
      const sc: unknown = schema;
      const stage: Stage = sc === IntakeSchema ? "intake" : sc === PlanSchema ? "plan" : sc === CodeSchema ? "code" : (() => { throw new Error("schema"); })();
      const q = script[stage] ?? [];
      const reply = q[Math.min(++n[stage], q.length) - 1];
      if (reply === undefined) throw new LlmError(`no reply for ${stage}`);
      return { data: schema.parse(reply), ms: 3, attempts: 1, usage: { input: 10, output: 5, reasoning: 0 } };
    },
  };
}

let nextId = 0;
const deps = (llm: LlmClient, extra: Partial<AgentDeps> = {}): AgentDeps => ({
  llm,
  store: memoryStore(),
  progress: progressBus(),
  newId: () => `22222222-2222-4222-8222-${String(++nextId).padStart(12, "0")}`,
  ...extra,
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

/** Resolves with every event up to and including "done". */
function collect(d: AgentDeps, id: string): Promise<ProgressEvent[]> {
  return new Promise((resolve) => {
    const seen: ProgressEvent[] = [];
    const off = d.progress!.subscribe(id, (e) => {
      seen.push(e);
      if (e.type !== "stage") {
        off();
        resolve(seen);
      }
    });
  });
}

/** Parses an SSE body into [event, data] pairs (comments skipped). */
function sse(body: string): [string, any][] {
  return body
    .split("\n\n")
    .filter((b) => b.startsWith("event:"))
    .map((b) => {
      const [ev, data] = b.split("\n");
      return [ev!.slice(7), JSON.parse(data!.slice(6))];
    });
}

describe("background runs", () => {
  it("returns the accepted project at once and reports every stage, then done", async () => {
    const g = gate();
    const d = deps(scripted({ intake: [INTAKE], plan: [PLAN], code: [GOOD_CODE] }, g.promise));
    const accepted = await createProject(d, "LED on while I hold a button", undefined, { background: true });
    expect(accepted.state).toBe("FAILED"); // stored placeholder: retryable if the server dies now
    expect(accepted.resumeFrom).toBe("intake");
    expect(isRunning(accepted.id)).toBe(true);
    expect(d.progress!.latest(accepted.id)).toMatchObject({ stage: "intake", status: "start", attempt: 1 });

    const events = collect(d, accepted.id);
    g.release();
    const seen = await events;
    const last = seen.at(-1)!;
    expect(last.type).toBe("done");
    expect(last.type === "done" && last.project.state).toBe("READY");
    expect(isRunning(accepted.id)).toBe(false);
    expect(d.progress!.latest(accepted.id)).toBeUndefined();
    const stages = seen.filter((e) => e.type === "stage").map((e) => e.type === "stage" && `${e.stage}:${e.status}`);
    // intake:start fired before anyone could subscribe; latest() covers late subscribers.
    expect(stages).toEqual(["intake:ok", "plan:start", "plan:ok", "design:ok", "steps:ok", "code:start", "code:ok"]);
    expect((await d.store.get(accepted.id))!.state).toBe("READY");
  });

  it("numbers repeated LLM calls per stage (code repair → attempt 2)", async () => {
    const d = deps(scripted({ intake: [INTAKE], plan: [PLAN], code: [BAD_CODE, GOOD_CODE] }));
    const events = collect(d, "22222222-2222-4222-8222-" + String(nextId + 1).padStart(12, "0"));
    await createProject(d, "LED on while I hold a button");
    const starts = (await events).filter((e) => e.type === "stage" && e.stage === "code" && e.status === "start");
    expect(starts.map((e) => e.type === "stage" && e.attempt)).toEqual([1, 2]);
    expect((await events).some((e) => e.type === "stage" && e.stage === "code" && e.status === "retry")).toBe(true);
  });

  it("checks that fail the request still fail it in background mode", async () => {
    const d = deps(scripted({ intake: [INTAKE], plan: [PLAN], code: [GOOD_CODE] }));
    const p = await createProject(d, "LED on while I hold a button");
    await expect(approvePlan(d, p.id, undefined, { background: true })).rejects.toMatchObject({ status: 409 });
    expect(isRunning(p.id)).toBe(false); // the lock is released after a refused request
    await expect(createProject(d, "x", undefined, { background: true })).rejects.toMatchObject({ status: 400 });
  });

  it("a crash outside the pipeline's error handling emits an error event and frees the lock", async () => {
    const store = memoryStore();
    const d = deps(scripted({ intake: [INTAKE], plan: [PLAN], code: [GOOD_CODE] }), {
      store: { ...store, save: async () => { throw new Error("database went away"); } },
      log: () => {},
    });
    const id = "22222222-2222-4222-8222-" + String(nextId + 1).padStart(12, "0");
    const events = collect(d, id);
    await createProject(d, "LED on while I hold a button", undefined, { background: true });
    expect((await events).at(-1)).toEqual({ type: "error", message: "database went away" });
    expect(isRunning(id)).toBe(false);
  });
});

describe("project routes (async + SSE)", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });
  const make = (d: AgentDeps) => (app = buildApp({ agent: d, health: { checkDb: async () => ({ status: "ok", detail: "" }), listModels: async () => [], llmModel: "m", embedModel: "e" } }));

  it("?async=1 answers 202 with running=true; GET shows running until done", async () => {
    const g = gate();
    const d = deps(scripted({ intake: [INTAKE], plan: [PLAN], code: [GOOD_CODE] }, g.promise));
    make(d);
    const res = await app.inject({ method: "POST", url: "/api/projects?async=1", payload: { idea: "LED and button" } });
    expect(res.statusCode).toBe(202);
    const id = res.json().id;
    expect(res.json().running).toBe(true);
    expect((await app.inject({ method: "GET", url: `/api/projects/${id}` })).json().running).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/projects" })).json()[0].running).toBe(true);
    const done = collect(d, id);
    g.release();
    await done;
    const final = (await app.inject({ method: "GET", url: `/api/projects/${id}` })).json();
    expect(final).toMatchObject({ state: "READY", running: false });
  });

  it("the events stream sends snapshot, progress and done for a running project", async () => {
    const g = gate();
    const d = deps(scripted({ intake: [INTAKE], plan: [PLAN], code: [GOOD_CODE] }, g.promise));
    make(d);
    const id = (await app.inject({ method: "POST", url: "/api/projects?async=true", payload: { idea: "LED and button" } })).json().id;
    const stream = app.inject({ method: "GET", url: `/api/projects/${id}/events` });
    setTimeout(g.release, 20);
    const res = await stream;
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/event-stream");
    const events = sse(res.body);
    expect(events[0]![0]).toBe("snapshot");
    expect(events[0]![1].running).toBe(true);
    expect(events[0]![1].current).toMatchObject({ stage: "intake", status: "start" });
    expect(events.filter(([e]) => e === "progress").map(([, x]) => `${x.stage}:${x.status}`)).toContain("code:ok");
    expect(events.at(-1)![0]).toBe("done");
    expect(events.at(-1)![1]).toMatchObject({ state: "READY", running: false });
  });

  it("a finished project gets snapshot + done straight away", async () => {
    const d = deps(scripted({ intake: [INTAKE], plan: [PLAN], code: [GOOD_CODE] }));
    make(d);
    const id = (await app.inject({ method: "POST", url: "/api/projects", payload: { idea: "LED and button" } })).json().id;
    const events = sse((await app.inject({ method: "GET", url: `/api/projects/${id}/events` })).body);
    expect(events.map(([e]) => e)).toEqual(["snapshot", "done"]);
    expect(events[1]![1].state).toBe("READY");
  });

  it("approve and retry accept ?async=1; unknown projects are 404 on the stream", async () => {
    const vague = { ...INTAKE, clarity: "vague" };
    const d = deps(scripted({ intake: [vague], plan: [PLAN], code: [GOOD_CODE] }));
    make(d);
    const id = (await app.inject({ method: "POST", url: "/api/projects", payload: { idea: "something with a light and a button" } })).json().id;
    const done = collect(d, id);
    const res = await app.inject({ method: "POST", url: `/api/projects/${id}/approve?async=1`, payload: {} });
    expect(res.statusCode).toBe(202);
    expect(res.json().plans.at(-1).approved).toBe(true);
    const last = (await done).at(-1)!;
    expect(last.type === "done" && last.project.state).toBe("READY");
    expect((await app.inject({ method: "POST", url: `/api/projects/${id}/retry?async=1` })).statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: "/api/projects/nope/events" })).statusCode).toBe(404);
  });

  it("POST /power switches the wiring; bad bodies are 400, unknown projects 404", async () => {
    const d = deps(scripted({ intake: [INTAKE], plan: [PLAN], code: [GOOD_CODE] }));
    make(d);
    const id = (await app.inject({ method: "POST", url: "/api/projects", payload: { idea: "LED and button", power: "direct" } })).json().id;
    expect((await app.inject({ method: "GET", url: `/api/projects/${id}` })).json().power).toBe("direct");
    const res = await app.inject({ method: "POST", url: `/api/projects/${id}/power`, payload: { power: "rails" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ power: "rails", running: false });
    expect((await app.inject({ method: "POST", url: `/api/projects/${id}/power`, payload: { power: "usb" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/projects", payload: { idea: "LED and button", power: "battery" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/projects/33333333-3333-4333-8333-333333333333/power", payload: { power: "direct" } })).statusCode).toBe(404);
  });

  it("DELETE removes a project (204), then it's gone (404); a running project can't be deleted (409)", async () => {
    const g = gate();
    const d = deps(scripted({ intake: [INTAKE], plan: [PLAN], code: [GOOD_CODE] }, g.promise));
    make(d);
    const running = (await app.inject({ method: "POST", url: "/api/projects?async=1", payload: { idea: "LED and button" } })).json().id;
    expect((await app.inject({ method: "DELETE", url: `/api/projects/${running}` })).json()).toMatchObject({ code: "CONFLICT" });
    const done = collect(d, running);
    g.release();
    await done;
    const res = await app.inject({ method: "DELETE", url: `/api/projects/${running}` });
    expect(res.statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/api/projects/${running}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/projects" })).json()).toEqual([]);
    expect((await app.inject({ method: "DELETE", url: `/api/projects/${running}` })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: "/api/projects/not-a-uuid" })).statusCode).toBe(404);
  });

  it("the handoff can be requested as a download", async () => {
    const d = deps(scripted({ intake: [INTAKE], plan: [PLAN], code: [GOOD_CODE] }));
    make(d);
    const id = (await app.inject({ method: "POST", url: "/api/projects", payload: { idea: "LED and button" } })).json().id;
    const res = await app.inject({ method: "GET", url: `/api/projects/${id}/handoff?download=1` });
    expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="handoff-22222222\.md"$/);
  });
});

describe("power modes (breadboard rails ↔ direct to Pico)", () => {
  const usesRails = (p: { build?: { build: { wires: { from: { kind: string }; to: { kind: string } }[] } } }) =>
    p.build!.build.wires.some((w) => w.from.kind === "rail" || w.to.kind === "rail");
  let llmCalls = 0;
  const counting = (llm: LlmClient): LlmClient => ({ model: llm.model, json: (s, m, o) => (llmCalls++, llm.json(s, m, o)) });

  it("a project can start in direct mode", async () => {
    const d = deps(scripted({ intake: [INTAKE], plan: [PLAN], code: [GOOD_CODE] }));
    const p = await createProject(d, "LED on while I hold a button", undefined, { power: "direct" });
    expect(p).toMatchObject({ state: "READY", power: "direct" });
    expect(usesRails(p)).toBe(false);
  });

  it("switching re-lays the power wires without the LLM and keeps the code valid; switching back restores the build", async () => {
    const d = deps(counting(scripted({ intake: [INTAKE], plan: [PLAN], code: [GOOD_CODE] })));
    const p = await createProject(d, "LED on while I hold a button");
    expect(p.power).toBe("rails");
    expect(usesRails(p)).toBe(true);
    const calls = llmCalls;

    const direct = await setPower(d, p.id, "direct");
    expect(llmCalls).toBe(calls);
    expect(direct).toMatchObject({ state: "READY", power: "direct" });
    expect(usesRails(direct)).toBe(false);
    expect(direct.build!.blocks).toEqual(p.build!.blocks);
    expect(direct.build!.code).toBe(p.build!.code);
    expect(direct.build!.codeCheck!.ok).toBe(true);
    expect(direct.build!.steps.length).toBe(p.build!.steps.length - 1); // no "GND pin → rail" wire
    expect(direct.events.at(-1)).toMatchObject({ stage: "design", detail: "power wires moved straight to the Pico's pins" });

    const back = await setPower(d, p.id, "rails");
    expect(back.build!.build).toEqual(p.build!.build);
    expect(back.build!.steps).toEqual(p.build!.steps);
  });

  it("before a build exists the choice is remembered and used when building", async () => {
    const d = deps(scripted({ intake: [{ ...INTAKE, clarity: "vague" }], plan: [PLAN], code: [GOOD_CODE] }));
    const p = await createProject(d, "something with a light and a button");
    expect(p.state).toBe("AWAIT_APPROVAL");
    expect((await setPower(d, p.id, "direct")).power).toBe("direct");
    const built = await approvePlan(d, p.id);
    expect(built.state).toBe("READY");
    expect(usesRails(built)).toBe(false);
  });

  it("three knobs can't go direct (one 3V3 pin): 400, and the project is unchanged", async () => {
    const three = { ...PLAN, title: "Three knobs", parts: [{ kind: "pot", purpose: "a" }, { kind: "pot", purpose: "b" }, { kind: "pot", purpose: "c" }] };
    const code = { code: "from machine import ADC\nimport time\n\na = ADC(26)\nb = ADC(27)\nc = ADC(28)\n\nwhile True:\n    print(a.read_u16(), b.read_u16(), c.read_u16())\n    time.sleep(0.5)\n", explanation: "Prints the three knobs." };
    const d = deps(scripted({ intake: [INTAKE], plan: [three], code: [code] }));
    const p = await createProject(d, "print the values of three knobs");
    expect(p.state).toBe("READY");
    await expect(setPower(d, p.id, "direct")).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/at most 2 parts that need 3.3 V/) });
    const after = (await d.store.get(p.id))!;
    expect(after.power).toBe("rails");
    expect(after.build!.build).toEqual(p.build!.build);
    expect(isRunning(p.id)).toBe(false);
  });
});
