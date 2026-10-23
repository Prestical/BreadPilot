// Milestone 5: progress timeline, browser-side safety re-check, and the store's project flow
// (fetch and EventSource are faked; no DOM needed).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSteps, layoutProject, parseConnections, type Build } from "@breadpilot/circuit-core";
import { describeEvent, timeline } from "../src/projects/progress";
import type { ApiProject, ProgressEvent } from "../src/projects/types";
import { emptyResolved, projectView } from "../src/projects/view";
import { DEMOS, loadProject } from "../src/demos";

const at = "2026-10-18T10:00:00Z";
const ev = (stage: ProgressEvent["stage"], status: ProgressEvent["status"], extra: Partial<ProgressEvent> = {}): ProgressEvent => ({ type: "stage", stage, status, at, ...extra });

const safeBuild = layoutProject([{ kind: "led" }, { kind: "button" }]).build;
const project = (extra: Partial<ApiProject> = {}): ApiProject => ({
  id: "p1",
  idea: "LED and button",
  board: "pico-2-w",
  title: "Button LED",
  state: "READY",
  running: false,
  plans: [{ title: "Button LED", goal: "g", behavior: ["b"], parts: [{ kind: "led", purpose: "x" }], questions: [], version: 1, approved: true }],
  build: { build: safeBuild, steps: buildSteps(safeBuild), code: "print(1)", codeAttempts: 1, citations: [] },
  events: [],
  createdAt: at,
  updatedAt: at,
  ...extra,
});

describe("progress timeline", () => {
  it("replaces a running row with its result and keeps retries visible", () => {
    const rows = timeline([
      ev("intake", "start", { attempt: 1 }),
      ev("intake", "ok"),
      ev("plan", "start", { attempt: 1 }),
      ev("plan", "ok"),
      ev("design", "ok", { detail: "2 parts on GP16, GP17" }),
      ev("steps", "ok", { detail: "11 steps" }),
      ev("code", "start", { attempt: 1 }),
      ev("code", "retry", { detail: "GP15 is not wired" }),
      ev("code", "start", { attempt: 2 }),
    ]);
    expect(rows.map((r) => [r.stage, r.tone])).toEqual([
      ["intake", "ok"],
      ["plan", "ok"],
      ["design", "ok"],
      ["steps", "ok"],
      ["code", "warn"],
      ["code", "busy"],
    ]);
    expect(rows.at(-1)!.text).toBe("Writing MicroPython (try 2)…");
    expect(rows[4]!.detail).toBe("GP15 is not wired");
  });

  it("names a plan repair and errors in plain English", () => {
    expect(describeEvent(ev("plan", "start", { attempt: 2 })).text).toBe("Revising the plan (try 2)…");
    expect(describeEvent(ev("design", "retry", { detail: "missing knob" }))).toMatchObject({ tone: "warn", detail: "missing knob" });
    expect(describeEvent(ev("plan", "error", { detail: "LLM unreachable" }))).toMatchObject({ tone: "bad", text: "Something went wrong" });
  });
});

describe("browser-side safety check", () => {
  it("plays a validated build", () => {
    const v = projectView(project());
    expect(v.kind).toBe("build");
    expect(v.kind === "build" && v.view.steps.length).toBeGreaterThan(5);
  });

  it("refuses to show steps for a build the validator rejects", () => {
    // A wire from 3V3 (pin 36) to the GND rail: a short, even though the server sent steps.
    const shorted: Build = { ...safeBuild, wires: [...safeBuild.wires, ...parseConnections("#36(3V3(OUT)) -> #RR-(GND)").wires] };
    const v = projectView(project({ id: "p2", build: { ...project().build!, build: shorted } }));
    expect(v.kind).toBe("unsafe");
    expect(v.kind === "unsafe" && v.message).toMatch(/Short circuit/);
  });

  it("no build yet → nothing to show; the empty bench still resolves", () => {
    expect(projectView(project({ id: "p3", state: "AWAIT_APPROVAL", build: undefined })).kind).toBe("none");
    expect(emptyResolved().parts).toEqual([]);
  });
});

// ---------------------------------------------------------------- store flow

class FakeEventSource {
  static last: FakeEventSource | null = null;
  static CLOSED = 2;
  readyState = 1;
  onerror: (() => void) | null = null;
  private handlers = new Map<string, (e: { data: string }) => void>();
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(type: string, fn: (e: { data: string }) => void) {
    this.handlers.set(type, fn);
  }
  close() {
    this.readyState = 2;
  }
  fire(type: string, data: unknown) {
    this.handlers.get(type)?.({ data: JSON.stringify(data) });
  }
}

describe("store: idea → progress → plan approval → build", () => {
  let responses: Record<string, unknown>;
  const calls: string[] = [];
  beforeEach(() => {
    calls.length = 0;
    responses = {};
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      calls.push(key + (init?.body ? ` ${init.body}` : ""));
      const body = responses[key];
      if (body === undefined) return new Response(JSON.stringify({ code: "NOT_FOUND", message: "Project not found." }), { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("follows a background run, shows the plan, then builds after approval", async () => {
    const { useApp, activeBuild } = await import("../src/store");
    const running = project({ state: "FAILED", running: true, build: undefined, plans: [] });
    responses["POST /api/projects?async=1"] = running;
    responses["GET /api/projects"] = [];

    await useApp.getState().startIdea("LED and button");
    let s = useApp.getState();
    expect(s.source).toEqual({ kind: "agent", id: "p1" });
    expect(s.agent.busy).toBe(true);
    expect(FakeEventSource.last!.url).toBe("/api/projects/p1/events");

    const es = FakeEventSource.last!;
    es.fire("snapshot", { ...running, current: ev("intake", "start", { attempt: 1 }) });
    es.fire("progress", ev("intake", "ok"));
    expect(timeline(useApp.getState().agent.events).map((r) => r.tone)).toEqual(["ok"]);

    const waiting = project({ state: "AWAIT_APPROVAL", build: undefined, updatedAt: "2026-10-18T10:00:05Z" });
    es.fire("done", waiting);
    s = useApp.getState();
    expect(s.agent.busy).toBe(false);
    expect(s.agent.project!.state).toBe("AWAIT_APPROVAL");
    expect(es.readyState).toBe(2);
    expect(activeBuild(s)).toBeNull(); // nothing to build before approval

    responses["POST /api/projects/p1/approve?async=1"] = { ...waiting, running: true };
    await useApp.getState().approve("use a green LED");
    expect(calls).toContain('POST /api/projects/p1/approve?async=1 {"feedback":"use a green LED"}');
    const es2 = FakeEventSource.last!;
    expect(es2).not.toBe(es);
    es2.fire("done", project({ updatedAt: "2026-10-18T10:00:30Z" }));
    s = useApp.getState();
    expect(s.agent.project!.state).toBe("READY");
    expect(activeBuild(s)!.steps.length).toBeGreaterThan(5);

    useApp.getState().setStep(999);
    expect(useApp.getState().stepIndex).toBe(activeBuild(useApp.getState())!.steps.length - 1);
    // Opening the Code panel, then moving to another step closes it (it would cover the pop-up).
    useApp.getState().setCodeOpen(true);
    useApp.getState().setStep(999);
    expect(useApp.getState().codeOpen).toBe(true);
    useApp.getState().setStep(2);
    expect(useApp.getState()).toMatchObject({ stepIndex: 2, codeOpen: false });
  });

  it("shows API errors and keeps the form usable", async () => {
    const { useApp } = await import("../src/store");
    useApp.getState().newProject();
    await useApp.getState().startIdea("LED and button");
    const s = useApp.getState();
    expect(s.agent.busy).toBe(false);
    expect(s.agent.error).toBe("Project not found.");
  });

  it("a lost stream reloads the stored project", async () => {
    const { useApp } = await import("../src/store");
    responses["GET /api/projects/p1"] = { ...project(), running: true };
    await useApp.getState().openProject("p1");
    const es = FakeEventSource.last!;
    responses["GET /api/projects/p1"] = project({ updatedAt: "2026-10-18T10:01:00Z" });
    es.readyState = 2;
    es.onerror!();
    await vi.waitFor(() => expect(useApp.getState().agent.project!.updatedAt).toBe("2026-10-18T10:01:00Z"));
    expect(useApp.getState().agent.error).toBe("Lost the connection to the API.");
    expect(useApp.getState().agent.busy).toBe(false);
  });
});

describe("power wiring (breadboard rails ↔ direct to Pico)", () => {
  const railWires = (b: Build) => b.wires.filter((w) => w.from.kind === "rail" || w.to.kind === "rail").length;

  it("every example has a safe build in both modes; direct mode uses no rails", () => {
    for (const d of DEMOS) {
      const rails = loadProject(d.id, "rails");
      const direct = loadProject(d.id, "direct");
      expect(railWires(rails.build), d.id).toBeGreaterThan(0);
      expect(railWires(direct.build), d.id).toBe(0);
      expect(direct.build.parts, d.id).toEqual(rails.build.parts);
      expect(direct.steps.length, d.id).toBeGreaterThan(0); // buildSteps throws for unsafe builds
    }
  });

  it("the hand-written LED + button matches the layout engine's direct wiring", () => {
    const hand = loadProject("led-button", "direct").build.wires.map((w) => [w.from, w.to]);
    const auto = layoutProject([{ kind: "led" }, { kind: "button" }], undefined, { power: "direct" }).build.wires.map((w) => [w.from, w.to]);
    expect(JSON.stringify(hand).replace(/"label":"[^"]*",?/g, "")).toBe(JSON.stringify(auto).replace(/"label":"[^"]*",?/g, ""));
  });

  it("store: switching on an example changes the shown build; on a project it asks the API", async () => {
    const calls: string[] = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
      calls.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`.trim());
      if (url.endsWith("/power")) return new Response(JSON.stringify({ ...project(), power: JSON.parse(init!.body!).power }), { status: 200 });
      return new Response(JSON.stringify(project()), { status: 200 });
    });
    try {
      const { useApp, activeBuild, currentPower } = await import("../src/store");
      useApp.getState().openDemo("led-button");
      await useApp.getState().setPower("direct");
      expect(currentPower(useApp.getState())).toBe("direct");
      expect(railWires(activeBuild(useApp.getState())!.build)).toBe(0);
      expect(calls).toEqual([]); // examples switch locally

      await useApp.getState().openProject("p1");
      expect(currentPower(useApp.getState())).toBe("rails"); // the project keeps its own choice
      await useApp.getState().setPower("direct");
      expect(calls).toContain('POST /api/projects/p1/power {"power":"direct"}');
      expect(useApp.getState().agent.project!.power).toBe("direct");
      expect(currentPower(useApp.getState())).toBe("direct");

      useApp.getState().newProject();
      await useApp.getState().startIdea("LED and button");
      expect(calls.find((c) => c.startsWith("POST /api/projects?async=1"))).toContain('"power":"direct"');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("store: new layout behaviour", () => {
  it("a finished build keeps the Code panel closed (it would cover the steps); starting an idea switches to build mode", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", async (url: string) =>
      new Response(JSON.stringify(url.startsWith("/api/projects?async") ? project({ state: "FAILED", running: true, build: undefined }) : []), { status: 200 }),
    );
    try {
      const { useApp } = await import("../src/store");
      useApp.setState({ mode: "tutorial", codeOpen: false });
      useApp.getState().setDraft("LED and button");
      expect(useApp.getState().draft).toBe("LED and button");
      await useApp.getState().startIdea("LED and button");
      expect(useApp.getState().mode).toBe("build");
      FakeEventSource.last!.fire("done", project({ updatedAt: "2026-10-20T10:00:00Z" }));
      expect(useApp.getState().codeOpen).toBe(false);
      expect(useApp.getState().stepIndex).toBe(0);
      // The last step's "Put it on your Pico" opens it.
      useApp.getState().setCodeOpen(true);
      expect(useApp.getState().codeOpen).toBe(true);
      useApp.getState().setCodeOpen(false);
      useApp.getState().dismissError();
      expect(useApp.getState().codeOpen).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("store: deleting projects", () => {
  it("deleting the open project sends DELETE, shows the new-idea screen and drops it from the list", async () => {
    const calls: string[] = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", async (url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (url === "/api/projects") return new Response(JSON.stringify([]), { status: 200 });
      return new Response(JSON.stringify(project()), { status: 200 });
    });
    try {
      const { useApp } = await import("../src/store");
      await useApp.getState().openProject("p1");
      useApp.setState((s) => ({ agent: { ...s.agent, list: [{ id: "p1", title: "Button LED", state: "READY", idea: "x", updatedAt: "a", running: false }] } }));
      await useApp.getState().removeProject("p1");
      const s = useApp.getState();
      expect(calls).toContain("DELETE /api/projects/p1");
      expect(s.source).toEqual({ kind: "agent", id: "" });
      expect(s.agent.project).toBeNull();
      expect(s.agent.list).toEqual([]);
      expect(s.agent.error).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
