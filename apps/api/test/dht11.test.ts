// M15: the DHT11 from idea to finished project with a scripted AI: the rules ask for the sensor, the
// plan names it, the layout adds its pull-up, the code prompt explains the dht module, and code that
// reads it every 2 seconds passes the checks.
import { describe, expect, it } from "vitest";
import type * as z from "zod/v4";
import { LlmError, type ChatMessage, type LlmClient } from "../src/agent/llm";
import { createProject, type AgentDeps } from "../src/agent/pipeline";
import { memoryStore } from "../src/agent/project";
import { planMessages } from "../src/agent/prompts";
import { CodeSchema, IntakeSchema, PlanSchema } from "../src/agent/schemas";

type Stage = "intake" | "plan" | "code";
function fakeLlm(script: Partial<Record<Stage, unknown[]>>) {
  const calls: { stage: Stage; messages: ChatMessage[] }[] = [];
  const llm: LlmClient = {
    model: "fake",
    async json<T>(schema: z.ZodType<T>, messages: ChatMessage[]) {
      const which: unknown = schema;
      const stage: Stage = which === IntakeSchema ? "intake" : which === PlanSchema ? "plan" : which === CodeSchema ? "code" : (() => { throw new Error("unknown schema"); })();
      calls.push({ stage, messages });
      const queue = script[stage] ?? [];
      const reply = queue[Math.min(calls.filter((c) => c.stage === stage).length, queue.length) - 1];
      if (reply === undefined) throw new LlmError(`no scripted reply for ${stage}`);
      const value = typeof reply === "function" ? (reply as (m: ChatMessage[]) => unknown)(messages) : reply;
      return { data: schema.parse(value), ms: 5, attempts: 1, usage: { input: 100, output: 20, reasoning: 0 } };
    },
  };
  return { llm, calls };
}

const IDEA = "Show the room temperature and humidity on the OLED every few seconds";
const INTAKE = { clarity: "clear", title: "Room climate", goal: "Show the room's temperature and humidity.", behaviors: ["Shows both values."], missing: [], unsupportedParts: [] };
const PLAN = {
  title: "Room climate",
  goal: "Show the room's temperature and humidity on the OLED.",
  behavior: ["Every 2 seconds the screen shows the temperature and the humidity."],
  parts: [
    { kind: "dht11", purpose: "measures the room's temperature and humidity" },
    { kind: "oled", purpose: "shows the values" },
  ],
  questions: [],
};

describe("a DHT11 project, start to finish (scripted AI)", () => {
  it("builds with the pull-up, explains the dht module to the code AI, and the code passes", async () => {
    let gpio = "";
    const code = (messages: ChatMessage[]) => {
      gpio = /DHT11 temperature and humidity sensor DHT1 on GP(\d+)/.exec(messages.map((m) => m.content).join("\n"))![1]!;
      const i2c = /i2c\d? = I2C\((\d), sda=Pin\((\d+)\), scl=Pin\((\d+)\)/.exec(messages.map((m) => m.content).join("\n"))!;
      return {
        code: `from machine import Pin, I2C
from sh1106 import SH1106_I2C
import dht
import time

sensor = dht.DHT11(Pin(${gpio}))
i2c = I2C(${i2c[1]}, sda=Pin(${i2c[2]}), scl=Pin(${i2c[3]}), freq=400000)
oled = SH1106_I2C(128, 64, i2c)
time.sleep(1)

while True:
    try:
        sensor.measure()
        oled.fill(0)
        oled.text("Temp: " + str(sensor.temperature()) + " C", 0, 16)
        oled.text("Humidity: " + str(sensor.humidity()) + "%", 0, 32)
    except OSError:
        oled.fill(0)
        oled.text("Sensor error", 0, 24)
    oled.show()
    time.sleep(2)
`,
        explanation: "Reads the DHT11 every 2 seconds and shows both values.",
      };
    };
    const { llm, calls } = fakeLlm({ intake: [INTAKE], plan: [PLAN], code: [code] });
    const deps: AgentDeps = { llm, store: memoryStore(), newId: () => "44444444-4444-4444-8444-444444444444", now: () => new Date("2026-11-11T12:00:00Z") };
    const p = await createProject(deps, IDEA);

    if (p.state !== "READY") throw new Error(`${p.state}: ${p.failure}\n${p.events.map((e) => `${e.stage}:${e.status}:${e.detail ?? ""}`).join("\n")}`);
    const refs = p.build!.build.parts.map((x) => `${x.ref}:${x.type}`);
    expect(refs).toEqual(expect.arrayContaining(["DHT1:dht11", "R1:resistor", "OLED1:oled-sh1106-i2c"]));
    expect(p.build!.build.parts.find((x) => x.ref === "R1")!.props).toEqual({ ohms: 10000 });
    expect(p.build!.codeCheck!.ok).toBe(true);
    expect(p.build!.steps.some((s) => /pull-up resistor/.test(s.why))).toBe(true);

    // The plan AI was told what the DHT11 is for; the code AI how to read it.
    const planPrompt = calls.find((c) => c.stage === "plan")!.messages.map((m) => m.content).join("\n");
    expect(planPrompt).toMatch(/"dht11": a DHT11 sensor that measures the air.s temperature/);
    const codePrompt = calls.find((c) => c.stage === "code")!.messages.map((m) => m.content).join("\n");
    expect(codePrompt).toMatch(new RegExp(`sensor = dht\\.DHT11\\(Pin\\(${gpio}\\)\\)`));
    expect(codePrompt).toMatch(/at least 2 s between measure\(\) calls/);
    expect(codePrompt).toMatch(/^import dht$/m);
  });

  it("the plan prompt no longer lists temperature sensors as unavailable", () => {
    const text = planMessages(IDEA, INTAKE as never).map((m) => m.content).join("\n");
    expect(text).not.toMatch(/sensors for temperature/);
    expect(text).toMatch(/other temperature sensors \(DHT22, BME280, DS18B20, thermistors\)/);
  });
});
