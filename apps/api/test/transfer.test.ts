// M11 11.6: project export → import. A real (scripted-AI) project goes out and comes back the
// same; a file changed by hand is checked like a new build and refused when it isn't safe.
import { describe, expect, it } from "vitest";
import type * as z from "zod/v4";
import { canonicalJson, changeSteps, type Build } from "@breadpilot/circuit-core";
import { buildApp } from "../src/app";
import { LlmError, type ChatMessage, type LlmClient } from "../src/agent/llm";
import { createProject, reviseProject, type AgentDeps } from "../src/agent/pipeline";
import { memoryStore, type Project } from "../src/agent/project";
import { CodeSchema, IntakeSchema, PlanSchema } from "../src/agent/schemas";
import { exportFile, exportFileName, ImportError, importProject } from "../src/agent/transfer";
import { ensureVersions } from "../src/agent/versions";

type Stage = "intake" | "plan" | "code";
function fakeLlm(script: Partial<Record<Stage, unknown[]>>): LlmClient {
  const count: Record<string, number> = {};
  return {
    model: "fake",
    async json<T>(schema: z.ZodType<T>, _messages: ChatMessage[]) {
      const which: unknown = schema;
      const stage: Stage = which === IntakeSchema ? "intake" : which === PlanSchema ? "plan" : which === CodeSchema ? "code" : (() => { throw new Error("unknown schema"); })();
      count[stage] = (count[stage] ?? 0) + 1;
      const queue = script[stage] ?? [];
      const reply = queue[Math.min(count[stage]!, queue.length) - 1];
      if (reply === undefined) throw new LlmError(`no scripted reply for ${stage}`);
      return { data: schema.parse(reply), ms: 5, attempts: 1, usage: { input: 100, output: 20, reasoning: 0 } };
    },
  };
}

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
const CODE = (sleep: string) => ({
  code: `from machine import Pin\nimport time\n\n# LED on GP16\nled = Pin(16, Pin.OUT)\n# button on GP18\nbutton = Pin(18, Pin.IN, Pin.PULL_UP)\n\nwhile True:\n    led.value(1 if button.value() == 0 else 0)\n    time.sleep(${sleep})\n`,
  explanation: "The LED is on while you hold the button.",
});
const INTAKE = { clarity: "clear", title: "Button LED", goal: "Light an LED while a button is pressed.", behaviors: ["Pressing lights it."], missing: [], unsupportedParts: [] };
const ID = "11111111-1111-4111-8111-111111111111";
const NEW_ID = "22222222-2222-4222-8222-222222222222";

/** A finished project with two versions (a code-only change), like one made in the app. */
async function madeProject(): Promise<{ p: Project; deps: AgentDeps }> {
  const llm = fakeLlm({ intake: [INTAKE], plan: [PLAN], code: [CODE("0.01"), CODE("0.02")] });
  const deps: AgentDeps = { llm, store: memoryStore(), newId: () => ID, now: () => new Date("2026-11-11T10:00:00Z") };
  await createProject(deps, "LED on while I hold a button");
  const p = await reviseProject(deps, ID, "check the button a bit less often");
  expect(p.state).toBe("READY");
  expect(p.versions).toHaveLength(2);
  return { p, deps };
}

/** What an export file looks like after a trip through the disk. */
const onDisk = (p: Project) => JSON.parse(JSON.stringify(exportFile(p, "2026-11-11T11:00:00Z", "0.2.0")));
const same = (a: Project, b: Project) => {
  const strip = ({ id: _id, updatedAt: _u, ...rest }: Project) => rest;
  expect(canonicalJson(strip(b))).toBe(canonicalJson(strip(a)));
};

describe("export → import", () => {
  it("gives back the same project under a new id", async () => {
    const { p } = await madeProject();
    const back = importProject(onDisk(p), { id: NEW_ID, now: "2026-11-12T09:00:00Z" });
    expect(back.id).toBe(NEW_ID);
    expect(back.updatedAt).toBe("2026-11-12T09:00:00Z");
    same(p, back);
  });

  it("keeps a wiring change's old board and makes its change steps again", async () => {
    const { p } = await madeProject();
    // The board before the change had no button.
    const from: Build = { ...p.build!.build, parts: p.build!.build.parts.filter((x) => !x.ref.startsWith("BTN")), wires: p.build!.build.wires.slice(0, 2) };
    p.build!.changeFrom = from;
    p.build!.changeSteps = changeSteps(from, p.build!.build);
    expect(p.build!.changeSteps.length).toBeGreaterThan(0);
    same(p, importProject(onDisk(p), { id: NEW_ID, now: p.updatedAt }));
  });

  it("an exported project's name becomes the file name", () => {
    expect(exportFileName("Plant Watering Timer!")).toBe("plant-watering-timer.breadpilot.json");
    expect(exportFileName("Ünïcode: déjà vu")).toBe("unicode-deja-vu.breadpilot.json");
    expect(exportFileName("???")).toBe("project.breadpilot.json");
  });
});

describe("a file changed by hand", () => {
  const refused = (file: unknown) => {
    try {
      importProject(file, { id: NEW_ID, now: "2026-11-12T09:00:00Z" });
    } catch (err) {
      expect(err).toBeInstanceOf(ImportError);
      return (err as Error).message;
    }
    throw new Error("the file was accepted");
  };

  it("unsafe wiring (3V3 straight to GND) is refused, in the current build and in an old version", async () => {
    const { p } = await madeProject();
    const short = { from: { kind: "pico", phys: 36, label: "3V3(OUT)" }, to: { kind: "pico", phys: 38, label: "GND" } };
    const a = onDisk(p);
    a.project.build.build.wires.push(short);
    expect(refused(a)).toMatch(/^The wiring of the project didn't pass BreadPilot's safety check: /);
    const b = onDisk(p);
    b.project.versions[0].build.build.wires.push(short);
    expect(refused(b)).toMatch(/^The wiring of version 1 didn't pass/);
  });

  it("steps and the code check come from the checked board, not from the file", async () => {
    const { p } = await madeProject();
    const file = onDisk(p);
    file.project.build.steps[1].text = "Plug the LED straight into 5 V.";
    file.project.build.code = "print('hello')\n";
    file.project.build.codeCheck = { ok: true, issues: [] };
    const back = importProject(file, { id: NEW_ID, now: p.updatedAt });
    expect(back.build!.steps).toEqual(p.build!.steps);
    expect(back.build!.codeCheck!.ok).toBe(false); // the LED and button are never used
  });

  it("not a project file, a newer format, damaged fields and broken references are refused with a reason", async () => {
    const { p } = await madeProject();
    expect(refused({ hello: 1 })).toMatch(/isn't a BreadPilot project file/);
    expect(refused({ ...onDisk(p), version: 2 })).toMatch(/newer BreadPilot/);
    const noTitle = onDisk(p);
    noTitle.project.title = "";
    expect(refused(noTitle)).toMatch(/damaged or was changed by hand \(title:/);
    const board = onDisk(p);
    board.project.board = "esp32";
    expect(refused(board)).toMatch(/board BreadPilot doesn't know/);
    const current = onDisk(p);
    current.project.currentVersion = 9;
    expect(refused(current)).toMatch(/current version isn't in its version list/);
    const twice = onDisk(p);
    twice.project.versions[1].n = 1;
    expect(refused(twice)).toMatch(/same version twice/);
  });

  it("a project made before versions existed still imports (it gets its version 1 on export)", async () => {
    const { p } = await madeProject();
    const old = structuredClone(p);
    delete old.versions;
    delete old.currentVersion;
    const back = importProject(onDisk(ensureVersions(old)), { id: NEW_ID, now: p.updatedAt });
    expect(back.versions).toHaveLength(1);
  });
});

describe("routes", () => {
  const health = { checkDb: async () => ({ status: "ok" as const, detail: "" }), listModels: async () => [], llmModel: "m", embedModel: "e" };

  it("GET /export downloads the file; POST /import adds it as a new project; a bad file is a 400", async () => {
    const { deps } = await madeProject();
    let next = 0;
    const ids = [NEW_ID];
    const app = buildApp({ agent: { ...deps, newId: () => ids[next++]!, appVersion: "0.2.0" }, health });
    const res = await app.inject({ method: "GET", url: `/api/projects/${ID}/export` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toBe('attachment; filename="button-led.breadpilot.json"');
    const file = res.json();
    expect(file).toMatchObject({ format: "breadpilot-project", version: 1, app: "0.2.0", project: { id: ID } });

    const imported = await app.inject({ method: "POST", url: "/api/projects/import", payload: file });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().id).toBe(NEW_ID);
    expect((await app.inject({ method: "GET", url: "/api/projects" })).json().map((x: { id: string }) => x.id).sort()).toEqual([ID, NEW_ID]);

    const bad = await app.inject({ method: "POST", url: "/api/projects/import", payload: { format: "something-else" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("BAD_PROJECT_FILE");
    expect((await app.inject({ method: "GET", url: "/api/projects/33333333-3333-4333-8333-333333333333/export" })).statusCode).toBe(404);
    await app.close();
  });
});
