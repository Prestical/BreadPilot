import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import type * as z from "zod/v4";
import { buildApp } from "../src/app";
import { handoffMarkdown } from "../src/agent/handoff";
import { createLlm, dropNulls, LlmError, REASONING_HEADROOM, strictSchema, type ChatMessage, type LlmClient } from "../src/agent/llm";
import { approvePlan, createProject, retryProject, stopProject, STOPPED_MESSAGE, type AgentDeps } from "../src/agent/pipeline";
import { memoryStore } from "../src/agent/project";
import { CodeSchema, IntakeSchema, PlanSchema, type Intake, type Plan } from "../src/agent/schemas";

type Stage = "intake" | "plan" | "code";
type Reply = unknown | ((messages: ChatMessage[]) => unknown);

/** Scripted LLM: each stage pops its next reply (the last one repeats). Errors are thrown. */
function fakeLlm(script: Partial<Record<Stage, Reply[]>>) {
  const calls: { stage: Stage; messages: ChatMessage[] }[] = [];
  const stageOf = (schema: unknown): Stage =>
    schema === IntakeSchema ? "intake" : schema === PlanSchema ? "plan" : schema === CodeSchema ? "code" : (() => { throw new Error("unknown schema"); })();
  const llm: LlmClient = {
    model: "fake",
    async json<T>(schema: z.ZodType<T>, messages: ChatMessage[]) {
      const stage = stageOf(schema);
      calls.push({ stage, messages });
      const queue = script[stage] ?? [];
      const n = calls.filter((c) => c.stage === stage).length;
      const reply = queue[Math.min(n, queue.length) - 1];
      if (reply === undefined) throw new LlmError(`no scripted reply for ${stage}`);
      const value = typeof reply === "function" ? (reply as (m: ChatMessage[]) => unknown)(messages) : reply;
      if (value instanceof Error) throw value;
      return { data: schema.parse(value), ms: 5, attempts: 1, usage: { input: 100, output: 20, reasoning: 0 } };
    },
  };
  return { llm, calls };
}

const intake = (clarity: Intake["clarity"], extra: Partial<Intake> = {}): Intake => ({
  clarity,
  title: "Button LED",
  goal: "Light an LED while a button is pressed.",
  behaviors: ["Pressing the button lights the LED."],
  missing: [],
  unsupportedParts: [],
  ...extra,
});
const plan = (parts: Plan["parts"], extra: Partial<Plan> = {}): Plan => ({
  title: "Button LED",
  goal: "Light an LED while a button is pressed.",
  behavior: ["Pressing the button lights the LED."],
  parts,
  questions: [],
  ...extra,
});
const LED_BUTTON = plan([
  { kind: "led", purpose: "light", color: "green" },
  { kind: "button", purpose: "switch" },
]);
const GOOD_CODE = {
  code: "from machine import Pin\nimport time\n\n# LED on GP16\nled = Pin(16, Pin.OUT)\n# button on GP17\nbutton = Pin(17, Pin.IN, Pin.PULL_UP)\n\nwhile True:\n    led.value(1 if button.value() == 0 else 0)\n    time.sleep(0.01)\n",
  explanation: "The LED is on while you hold the button.",
};

const deps = (llm: LlmClient, extra: Partial<AgentDeps> = {}): AgentDeps => ({
  llm,
  store: memoryStore(),
  newId: () => "11111111-1111-4111-8111-111111111111",
  now: () => new Date("2026-10-18T10:00:00Z"),
  ...extra,
});

describe("clear idea → READY", () => {
  it("runs intake, plan, design, steps and code", async () => {
    const { llm, calls } = fakeLlm({ intake: [intake("clear")], plan: [LED_BUTTON], code: [GOOD_CODE] });
    const search = vi.fn(async () => [
      { content: "GPIO is fixed at 3.3 V.", citation: "Datasheet, p.14" },
      { content: "Another chunk of the same section.", citation: "Datasheet, p.14" },
    ]);
    const p = await createProject(deps(llm, { search }), "LED on while I hold a button");

    expect(p.state).toBe("READY");
    expect(calls.map((c) => c.stage)).toEqual(["intake", "plan", "code"]);
    expect(p.plans).toHaveLength(1);
    expect(p.plans[0]!.approved).toBe(true);
    expect(p.build!.blocks.map((b) => [b.kind, b.gpio, b.mode])).toEqual([
      ["led", "GP16", "out"],
      ["button", "GP17", "in_pullup"],
    ]);
    expect(p.build!.build.parts.find((x) => x.ref === "LED1")!.props).toEqual({ color: "green" });
    expect(p.build!.steps.find((x) => x.dsl === "#32j(BTN1.2b) -> #RR-(GND)")!.why).toMatch(/^When BTN1 is pressed, it connects its pin to ground/);
    expect(p.build!.codeCheck!.ok).toBe(true);
    expect(p.build!.codeAttempts).toBe(1);
    expect(p.build!.citations).toEqual(["Datasheet, p.14"]); // duplicates removed
    expect(p.events.map((e) => `${e.stage}:${e.status}`)).toEqual(["intake:ok", "plan:ok", "design:ok", "steps:ok", "code:ok"]);
  });

  it("gives the code stage an exact pin table and the documentation references", async () => {
    const { llm, calls } = fakeLlm({ intake: [intake("clear")], plan: [LED_BUTTON], code: [GOOD_CODE] });
    await createProject(deps(llm, { search: async () => [{ content: "GPIO is fixed at 3.3 V.", citation: "Datasheet, p.14" }] }), "x LED button");
    const prompt = calls.find((c) => c.stage === "code")!.messages[1]!.content;
    expect(prompt).toContain("green LED LED1 on GP16: Pin(16, Pin.OUT)");
    expect(prompt).toContain("push button BTN1 on GP17: Pin(17, Pin.IN, Pin.PULL_UP)");
    expect(prompt).toContain("[Datasheet, p.14]");
    const system = calls.find((c) => c.stage === "code")!.messages[0]!.content;
    expect(system).toContain("Only use modules built into MicroPython on the Pico 2 W");
    // Not a network idea: no Wi-Fi recipe (it leaked WIFI_SSID constants into unrelated code).
    expect(system).not.toContain("WIFI_SSID");
    expect(system).toContain("This project doesn't use Wi-Fi");
  });

  it("adds the Wi-Fi recipe and the no-ping note only for network ideas", async () => {
    const { llm, calls } = fakeLlm({ intake: [intake("clear")], plan: [LED_BUTTON], code: [GOOD_CODE] });
    await createProject(deps(llm), "Turn on an LED from my phone over Wi-Fi when I press a button");
    const system = calls.find((c) => c.stage === "code")!.messages[0]!.content;
    expect(system).toContain("WIFI_SSID");
    expect(system).toContain("MicroPython has NO ping");
    // General API facts: the interface is always created; scan() needs no connection; the tuple layout.
    expect(system).toContain("wlan = network.WLAN(network.STA_IF) and wlan.active(True): every other wlan call needs these two lines first");
    expect(system).toMatch(/wlan\.scan\(\) only listens: .*without joining a network/);
    expect(system).toContain("(ssid, bssid, channel, rssi, security, hidden)");
  });

  it("respects a pin the user asked for", async () => {
    const { llm } = fakeLlm({ intake: [intake("clear")], plan: [plan([{ kind: "led", purpose: "light", pin: "GP15" }])], code: [{ code: "from machine import Pin\nled = Pin(15, Pin.OUT)\nwhile True:\n    led.toggle()\n", explanation: "Blinks." }] });
    const p = await createProject(deps(llm), "blink an LED on GP15");
    expect(p.build!.blocks[0]!.gpio).toBe("GP15");
    expect(p.state).toBe("READY");
  });
});

describe("OLED display (Milestone 6)", () => {
  const OLED_PLAN = plan([{ kind: "oled", purpose: "show the count" }, { kind: "button", purpose: "count presses" }], { title: "Press counter" });
  const OLED_CODE = {
    code: "from machine import Pin, I2C\nfrom sh1106 import SH1106_I2C\nimport time\n\n# Set up the parts\ni2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)\noled = SH1106_I2C(128, 64, i2c)\nbutton = Pin(18, Pin.IN, Pin.PULL_UP)\ncount = 0\n\nwhile True:\n    if button.value() == 0:\n        count += 1\n        time.sleep(0.2)\n    oled.fill(0)\n    oled.text(\"Count: \" + str(count), 0, 0)\n    oled.show()\n    time.sleep(0.05)\n",
    explanation: "Counts button presses and shows the number on the screen.",
  };

  it("builds an OLED project: I2C pair wired, driver API in the prompt, code checked", async () => {
    const { llm, calls } = fakeLlm({ intake: [intake("clear")], plan: [OLED_PLAN], code: [OLED_CODE] });
    const p = await createProject(deps(llm), "Count button presses and show the number on an OLED");
    expect(p.state).toBe("READY");
    expect(p.build!.build.gpioModes).toEqual({ GP16: "i2c0_sda", GP17: "i2c0_scl", GP18: "in_pullup" });
    expect(p.build!.codeCheck!.ok).toBe(true);
    const prompt = calls.find((c) => c.stage === "code")!.messages[1]!.content;
    expect(prompt).toContain("i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000) and oled = SH1106_I2C(128, 64, i2c)");
    expect(prompt).toContain("Not ssd1306");
    // Facts about the display itself (any OLED project), not tips for a particular project.
    expect(prompt).toContain("8 text rows at y = 0, 8, 16, 24, 32, 40, 48, 56");
    expect(prompt).toContain("only plain ASCII characters");
    const md = handoffMarkdown(p);
    expect(md).toContain("| GP16 | 21 | OLED1 SDA | i2c0_sda | `I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)` |");
    expect(md).toContain("## Driver file: sh1106.py");
    expect(md).toContain("class SH1106_I2C(framebuf.FrameBuffer):");
  });

  it("code that uses the SSD1306 driver is sent back with the SH1106 fix", async () => {
    const wrong = { ...OLED_CODE, code: OLED_CODE.code.replace("from sh1106 import SH1106_I2C", "from ssd1306 import SSD1306_I2C").replace("SH1106_I2C(128", "SSD1306_I2C(128") };
    const { llm, calls } = fakeLlm({ intake: [intake("clear")], plan: [OLED_PLAN], code: [wrong, OLED_CODE] });
    const p = await createProject(deps(llm), "Count button presses and show the number on an OLED");
    expect(p.state).toBe("READY");
    const repair = calls.filter((c) => c.stage === "code")[1]!.messages.at(-1)!.content;
    expect(repair).toMatch(/uses the SH1106 chip: use `from sh1106 import SH1106_I2C`/);
  });

  it("three displays are refused before any repair loop", async () => {
    const { llm, calls } = fakeLlm({ intake: [intake("clear")] });
    const p = await createProject(deps(llm), "Show three numbers on three OLED displays");
    expect(p.state).toBe("HANDOFF");
    expect(p.handoffReason).toMatch(/at least 3 displays.*same I2C address/);
    expect(calls.map((c) => c.stage)).toEqual(["intake"]);
  });
});

describe("vague idea → approval flow", () => {
  it("waits for approval, revises with feedback, then builds", async () => {
    const { llm, calls } = fakeLlm({
      intake: [intake("vague", { missing: ["What should light up?"] })],
      plan: [plan([{ kind: "led", purpose: "light", color: "red" }], { questions: ["Which color?"] }), LED_BUTTON],
            code: [GOOD_CODE],
    });
    const d = deps(llm);
    let p = await createProject(d, "something with lights");
    expect(p.state).toBe("AWAIT_APPROVAL");
    expect(p.plans[0]!.approved).toBe(false);

    p = await approvePlan(d, p.id, "add a button too");
    expect(p.state).toBe("AWAIT_APPROVAL");
    expect(p.plans).toHaveLength(2);
    expect(p.plans[1]!.feedback).toBe("add a button too");
    expect(calls.at(-1)!.messages[1]!.content).toContain("The user wants these changes: add a button too");

    p = await approvePlan(d, p.id);
    expect(p.state).toBe("READY");
    expect(p.plans[1]!.approved).toBe(true);
    expect(p.build!.blocks).toHaveLength(2);
  });

  it("refuses to approve a project that isn't waiting", async () => {
    const { llm } = fakeLlm({ intake: [intake("clear")], plan: [LED_BUTTON], code: [GOOD_CODE] });
    const d = deps(llm);
    const p = await createProject(d, "LED and button");
    await expect(approvePlan(d, p.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("unsupported ideas", () => {
  it("a component name the rules know stops before planning (HANDOFF)", async () => {
    const { llm, calls } = fakeLlm({ intake: [intake("clear", { title: "Robot car" })] });
    const p = await createProject(deps(llm), "A robot car with two motors");
    expect(p.state).toBe("HANDOFF");
    expect(calls).toHaveLength(1);
    expect(p.intake!.unsupportedParts).toEqual(["motors or servos"]);
    const md = handoffMarkdown(p);
    expect(md).toContain("**Parts the local builder can't wire yet:** motors or servos");
    expect(md).toContain("Design this project");
  });

  it("when only the model says unsupported, the user is asked instead of blocked", async () => {
    const { llm } = fakeLlm({ intake: [intake("unsupported", { unsupportedParts: ["DC motors"] })], plan: [LED_BUTTON] });
    const p = await createProject(deps(llm), "build a robot car");
    expect(p.state).toBe("AWAIT_APPROVAL");
    expect(p.plans[0]!.questions[0]).toBe("This might need DC motors. Can it be done with LEDs, buttons and knobs instead? If not, ask for the handoff bundle.");
  });
});

describe("rules that ask instead of guessing", () => {
  it("an unclear pin number makes the project wait with a question", async () => {
    const { llm } = fakeLlm({ intake: [intake("clear")], plan: [LED_BUTTON] });
    const p = await createProject(deps(llm), "LED on pin 20 that I switch with a button");
    expect(p.state).toBe("AWAIT_APPROVAL");
    expect(p.plans[0]!.questions[0]).toMatch(/^You wrote "pin 20"\. Do you mean physical pin 20 \(GP15\)/);
  });

  it("a very short idea waits for approval even if the model calls it clear", async () => {
    const { llm } = fakeLlm({ intake: [intake("clear")], plan: [plan([{ kind: "led", purpose: "light" }])] });
    expect((await createProject(deps(llm), "LEDs")).state).toBe("AWAIT_APPROVAL");
  });

  it("pins the model invents are dropped; pins the user wrote are kept", async () => {
    const invented = plan([{ kind: "led", purpose: "a", pin: "GP3" }, { kind: "button", purpose: "b", pin: "GP9" }]);
    const code = { code: "from machine import Pin\nimport time\na = Pin(16, Pin.OUT)\nb = Pin(9, Pin.IN, Pin.PULL_UP)\nwhile True:\n    a.value(not b.value())\n    time.sleep(0.01)\n", explanation: "x" };
    const { llm } = fakeLlm({ intake: [intake("clear")], plan: [invented], code: [code] });
    const p = await createProject(deps(llm), "An LED and a button on GP9");
    expect(p.plans[0]!.parts.map((x) => x.pin)).toEqual([undefined, "GP9"]);
    expect(p.build!.blocks.map((b) => b.gpio)).toEqual(["GP16", "GP9"]);
  });
});

describe("impossible requests are caught early (no repair loop)", () => {
  it.each([
    ["Ten LEDs in a row", "10 LEDs"],
    ["four knobs to mix colors on four LEDs", "4 LEDs, 4 knobs"],
  ])("%s", async (idea, text) => {
    const { llm, calls } = fakeLlm({ intake: [intake("clear")] });
    const p = await createProject(deps(llm), idea);
    expect(p.state).toBe("HANDOFF");
    expect(p.handoffReason).toContain(`This needs at least ${text}`);
    expect(calls.map((c) => c.stage)).toEqual(["intake"]);
  });
});

describe("on-board LED projects", () => {
  it("build with no external parts", async () => {
    const code = { code: 'from machine import Pin\nimport time\nled = Pin("LED", Pin.OUT)\nwhile True:\n    led.toggle()\n    time.sleep(0.5)\n', explanation: "Blinks the on-board LED." };
    const { llm, calls } = fakeLlm({ intake: [intake("clear")], plan: [plan([])], code: [code] });
    const p = await createProject(deps(llm), "Blink the on-board LED every half second");
    expect(p.state).toBe("READY");
    expect(p.build!.build.parts).toEqual([]);
    expect(p.build!.steps.map((s) => s.kind)).toEqual(["intro", "place-pico", "usb"]);
    expect(calls.find((c) => c.stage === "code")!.messages[1]!.content).toContain('Use only the Pico 2 W\'s on-board LED: Pin("LED", Pin.OUT). (It is NOT GP25');
  });

  it("an empty plan for a normal idea is sent back for repair", async () => {
    const { llm, calls } = fakeLlm({ intake: [intake("clear")], plan: [plan([]), plan([{ kind: "led", purpose: "x" }])], code: [{ code: "from machine import Pin\nimport time\nled = Pin(16, Pin.OUT)\nwhile True:\n    led.toggle()\n    time.sleep(1)\n", explanation: "x" }] });
    const p = await createProject(deps(llm), "make a game with lights");
    expect(calls.filter((c) => c.stage === "plan")[1]!.messages[1]!.content).toContain("The plan has no parts.");
    expect(p.state).toBe("READY");
  });
});

describe("feedback overrides the idea", () => {
  it("removing a part the idea asked for is respected", async () => {
    const withButton = plan([{ kind: "led", purpose: "light" }, { kind: "button", purpose: "switch" }]);
    const ledOnly = plan([{ kind: "led", purpose: "light" }]);
    const code = { code: "from machine import Pin\nimport time\nled = Pin(16, Pin.OUT)\nwhile True:\n    led.toggle()\n    time.sleep(1)\n", explanation: "x" };
    const { llm } = fakeLlm({ intake: [intake("vague")], plan: [withButton, ledOnly], code: [code] });
    const d = deps(llm);
    let p = await createProject(d, "An LED I switch with a button, maybe");
    p = await approvePlan(d, p.id, "remove the button, just blink the LED");
    p = await approvePlan(d, p.id);
    expect(p.state).toBe("READY");
    expect(p.build!.blocks.map((b) => b.kind)).toEqual(["led"]); // the idea's button is not forced back in
  });
});

describe("loops and time budget", () => {
  it("the design repair loop is bounded", async () => {
    const stubborn = plan([{ kind: "led", purpose: "x" }]);
    const { llm, calls } = fakeLlm({ intake: [intake("clear")], plan: [stubborn] });
    const p = await createProject(deps(llm), "Use a knob to set an LED's brightness");
    expect(p.state).toBe("HANDOFF");
    expect(calls.filter((c) => c.stage === "plan")).toHaveLength(1 + 3);
    expect(p.handoffReason).toMatch(/couldn't be turned into a breadboard layout/);
  });

  it("stops with FAILED when the time budget runs out, and can resume", async () => {
    const { llm } = fakeLlm({ intake: [intake("clear")], plan: [LED_BUTTON], code: [GOOD_CODE] });
    const d = deps(llm, { budgetMs: 0 });
    const p = await createProject(d, "LED and button");
    expect(p.state).toBe("FAILED");
    expect(p.failure).toMatch(/took longer than 0 s/);
    expect(p.resumeFrom).toBe("intake");
    const resumed = await retryProject({ ...d, budgetMs: 60_000 }, p.id);
    expect(resumed.state).toBe("READY");
  });

  it("refuses a second request for a project that's still running", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { llm } = fakeLlm({ intake: [intake("vague")], plan: [LED_BUTTON], code: [GOOD_CODE] });
    const slow: LlmClient = { model: "slow", json: async (s, m, o) => (await gate, llm.json(s, m, o)) };
    const d = deps(llm);
    const p = await createProject(d, "LED and button");
    const first = approvePlan({ ...d, llm: slow }, p.id);
    await expect(approvePlan(d, p.id)).rejects.toMatchObject({ status: 409 });
    release();
    expect((await first).state).toBe("READY");
  });
});

describe("design repair loop", () => {
  it("sends the layout error back to the model and uses the fixed plan", async () => {
    // Satisfies the idea's requirements (knobs + an LED) but needs 4 ADC pins: only the layout can say no.
    const tooMany = plan([...Array.from({ length: 4 }, () => ({ kind: "pot" as const, purpose: "knob" })), { kind: "led", purpose: "light", color: "red" }]);
    const fixed = plan([{ kind: "pot", purpose: "knob" }, { kind: "led", purpose: "light", color: "red" }]);
    const code = { code: "from machine import Pin, ADC, PWM\nimport time\nknob = ADC(26)\nled = PWM(Pin(16))\nwhile True:\n    led.duty_u16(knob.read_u16())\n    time.sleep(0.02)\n", explanation: "Dims." };
    const { llm, calls } = fakeLlm({ intake: [intake("clear")], plan: [tooMany, fixed], code: [code] });
    const p = await createProject(deps(llm), "knobs that dim an LED");
    expect(p.state).toBe("READY");
    expect(calls.filter((c) => c.stage === "plan")[1]!.messages[1]!.content).toContain("can't be built: No ADC pins left");
    expect(p.plans.map((x) => x.version)).toEqual([1, 2]);
    expect(p.plans[1]!.autoFix).toMatch(/^No ADC pins left/);
    expect(p.plans[1]!.feedback).toBeUndefined();
    expect(p.events.filter((e) => e.stage === "design").map((e) => e.status)).toEqual(["retry", "ok"]);
  });

});

describe("live-eval regressions (run 1)", () => {
  it("catches unsupported parts in code even when the model calls the idea clear", async () => {
    const { llm, calls } = fakeLlm({ intake: [intake("clear", { title: "Room thermometer" })], plan: [LED_BUTTON] });
    const p = await createProject(deps(llm), "Measure the room temperature and show it on an OLED screen");
    expect(p.state).toBe("HANDOFF");
    expect(p.intake!.clarity).toBe("unsupported");
    // The OLED is supported since Milestone 6; the room temperature sensor still isn't.
    expect(p.intake!.unsupportedParts).toEqual(["a temperature or humidity sensor"]);
    expect(p.handoffReason).toMatch(/^This project needs a temperature or humidity sensor, which the builder can't wire yet/);
    expect(calls.map((c) => c.stage)).toEqual(["intake"]); // no plan, no substituted parts
    expect(p.build).toBeUndefined();
  });

  it("reports a missing part with correct grammar", async () => {
    const { llm, calls } = fakeLlm({ intake: [intake("clear")], plan: [plan([{ kind: "pot", purpose: "k" }]), plan([{ kind: "pot", purpose: "k" }, { kind: "led", purpose: "l" }])], code: [{ code: "from machine import Pin, ADC\nled = Pin(16, Pin.OUT)\nk = ADC(26)\n", explanation: "x" }] });
    await createProject(deps(llm), "knobs that dim an LED");
    expect(calls.filter((c) => c.stage === "plan")[1]!.messages[1]!.content).toContain("The request mentions an LED, but the plan has none.");
  });

  it("sends a plan that dropped a requested part back for repair", async () => {
    const ledOnly = plan([{ kind: "led", purpose: "light", color: "red" }]);
    const withKnob = plan([{ kind: "pot", purpose: "brightness" }, { kind: "led", purpose: "light", color: "red" }]);
    const code = { code: "from machine import Pin, ADC, PWM\nimport time\nknob = ADC(26)\nled = PWM(Pin(16))\nwhile True:\n    led.duty_u16(knob.read_u16())\n    time.sleep(0.02)\n", explanation: "Dims." };
    const { llm, calls } = fakeLlm({ intake: [intake("clear")], plan: [ledOnly, withKnob], code: [code] });
    const p = await createProject(deps(llm), "Use a knob to control how bright an LED is");
    expect(p.state).toBe("READY");
    expect(calls.filter((c) => c.stage === "plan")[1]!.messages[1]!.content).toContain('The request mentions a knob (potentiometer), but the plan has none. Add 1 part(s) of kind "pot".');
    expect(p.build!.blocks.map((b) => b.kind)).toEqual(["pot", "led"]);
  });

  it("refuses feedback that asks for an unsupported part", async () => {
    const { llm } = fakeLlm({ intake: [intake("vague")], plan: [LED_BUTTON] });
    const d = deps(llm);
    const p = await createProject(d, "something with lights");
    await expect(approvePlan(d, p.id, "add a buzzer that beeps")).rejects.toMatchObject({ status: 400, message: expect.stringContaining("a buzzer or speaker") });
  });

  it("normalizes over-long text and drops invalid pins instead of failing", async () => {
    const long = plan([{ kind: "led", purpose: "light", pin: "pin 15" }], { title: "A".repeat(90), behavior: Array.from({ length: 14 }, (_, i) => `step ${i}`) });
    const { llm } = fakeLlm({ intake: [intake("clear", { unsupportedParts: ["a", "b", "c", "d", "e", "f", "g"] })], plan: [long], code: [{ code: "from machine import Pin\nled = Pin(16, Pin.OUT)\nwhile True:\n    led.toggle()\n", explanation: "Blinks." }] });
    const p = await createProject(deps(llm), "blink an LED");
    expect(p.state).toBe("READY");
    expect(p.plans[0]!.title).toHaveLength(60);
    expect(p.plans[0]!.behavior).toHaveLength(10);
    expect(p.plans[0]!.parts[0]!.pin).toBeUndefined();
    expect(p.intake!.unsupportedParts).toHaveLength(5);
  });

  it("allows 7 parts (dice: six LEDs + a button)", async () => {
    const dice = plan([...Array.from({ length: 6 }, () => ({ kind: "led" as const, purpose: "pip", color: "red" as const })), { kind: "button", purpose: "roll" }]);
    const code = { code: "from machine import Pin\nimport random\nPINS = [16, 17, 18, 19, 20, 21]\nleds = [Pin(p, Pin.OUT) for p in PINS]\nbtn = Pin(22, Pin.IN, Pin.PULL_UP)\nwhile True:\n    if btn.value() == 0:\n        n = random.randint(1, 6)\n        for i, led in enumerate(leds):\n            led.value(1 if i < n else 0)\n", explanation: "Rolls." };
    const { llm } = fakeLlm({ intake: [intake("clear")], plan: [dice], code: [code] });
    const p = await createProject(deps(llm), "Electronic dice: press a button and show a random number from 1 to 6 with six LEDs");
    expect(p.build!.blocks).toHaveLength(7);
    expect(p.build!.codeCheck!.issues.map((i) => i.code)).toEqual(["C009"]); // loop without sleep: a warning only
    expect(p.state).toBe("READY");
  });
});

describe("code repair loop", () => {
  it("feeds checker problems back and accepts the corrected code", async () => {
    const wrongPin = { ...GOOD_CODE, code: GOOD_CODE.code.replace("Pin(16, Pin.OUT)", "Pin(5, Pin.OUT)") };
    const { llm, calls } = fakeLlm({ intake: [intake("clear")], plan: [LED_BUTTON], code: [wrongPin, GOOD_CODE] });
    const p = await createProject(deps(llm), "LED and button");
    expect(p.state).toBe("READY");
    expect(p.build!.codeAttempts).toBe(2);
    const repair = calls.filter((c) => c.stage === "code")[1]!.messages.at(-1)!.content;
    expect(repair).toContain("The code uses GP5 (pin 7), but nothing is wired to it in this build.");
    expect(repair).toContain("The build wires GP16 as an output, but the code never uses it.");
  });

  it("hands off with the validated wiring when the code never passes", async () => {
    const wrongPin = { ...GOOD_CODE, code: GOOD_CODE.code.replace("Pin(16, Pin.OUT)", "Pin(5, Pin.OUT)") };
    const { llm, calls } = fakeLlm({ intake: [intake("clear")], plan: [LED_BUTTON], code: [wrongPin] });
    const p = await createProject(deps(llm), "LED and button");
    expect(p.state).toBe("HANDOFF");
    expect(calls.filter((c) => c.stage === "code")).toHaveLength(4);
    expect(p.build!.steps.length).toBeGreaterThan(5);
    const md = handoffMarkdown(p);
    expect(md).toContain("| GP16 | 21 | LED1 + R1 | out |");
    expect(md).toContain("#21(GP16) -> #24j(R1.a)");
    expect(md).toContain("don't change it");
    expect(md).toContain("C004:");
    expect(md).toContain("Use exactly the GPIOs and modes in the pin assignment table");
  });
});

describe("failures and retry", () => {
  it("goes to FAILED when the model is unreachable, then resumes from that stage", async () => {
    let down = true;
    const { llm, calls } = fakeLlm({
      intake: [intake("clear")],
      plan: [() => (down ? new LlmError("Can't reach the language model") : LED_BUTTON)],
            code: [GOOD_CODE],
    });
    const d = deps(llm);
    let p = await createProject(d, "LED and button");
    expect(p.state).toBe("FAILED");
    expect(p.resumeFrom).toBe("plan");
    expect(p.failure).toContain("Can't reach");

    down = false;
    p = await retryProject(d, p.id);
    expect(p.state).toBe("READY");
    expect(p.failure).toBeUndefined();
    expect(calls.filter((c) => c.stage === "intake")).toHaveLength(1); // intake was not repeated
  });

  it("rejects empty ideas and unknown boards", async () => {
    const { llm } = fakeLlm({});
    await expect(createProject(deps(llm), "  ")).rejects.toMatchObject({ status: 400 });
    await expect(createProject(deps(llm), "blink", "arduino-uno")).rejects.toMatchObject({ status: 400 });
  });
});

describe("LLM client", () => {
  const ok = (content: string) => new Response(JSON.stringify({ message: { content } }));

  it("calls Ollama /api/chat with the JSON schema and num_ctx", async () => {
    const f = vi.fn(async () => ok(JSON.stringify({ code: "x", explanation: "y" })));
    const llm = createLlm({ api: "ollama", baseUrl: "http://host:11434/v1", model: "qwen", numCtx: 16384, temperature: 0.2, timeoutMs: 1000, fetchImpl: f as never });
    const r = await llm.json(CodeSchema, [{ role: "user", content: "hi" }]);
    expect(r.data).toEqual({ code: "x", explanation: "y" });
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("http://host:11434/api/chat");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "qwen", stream: false, options: { num_ctx: 16384, temperature: 0.2 } });
    expect(body.options.num_predict).toBeUndefined();
    await llm.json(CodeSchema, [], { maxTokens: 2500 });
    expect(JSON.parse(String((f.mock.calls[1]! as unknown as [string, RequestInit])[1].body)).options.num_predict).toBe(2500);
    expect(body.format.required).toEqual(["code", "explanation"]);
    // Upper bounds are left out of the grammar; lower bounds stay (no empty strings).
    expect(JSON.stringify(body.format)).not.toMatch(/maxLength|\$schema/);
    expect(body.format.properties.code.minLength).toBe(1);
  });

  it("keeps enums and structure in the grammar schema", async () => {
    const f = vi.fn(async () => ok(JSON.stringify({ title: "t", goal: "g", behavior: ["b"], parts: [{ kind: "led", purpose: "p" }], questions: [] })));
    const llm = createLlm({ api: "ollama", baseUrl: "http://h", model: "m", numCtx: 1, temperature: 0, timeoutMs: 1000, fetchImpl: f as never });
    await llm.json(PlanSchema, []);
    const format = JSON.parse(String((f.mock.calls[0]! as unknown as [string, RequestInit])[1].body)).format;
    expect(format.properties.parts.items.properties.kind.enum).toEqual(["led", "button", "pot", "oled"]);
    expect(format.properties.parts.items.required).toEqual(["kind", "purpose"]);
    expect(JSON.stringify(format)).not.toMatch(/maxItems|pattern/);
    expect(format.properties.behavior.minItems).toBe(1);
  });

  it("retries once with the validation error, then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(ok('{"code": "x"}')).mockResolvedValueOnce(ok('{"code":"x","explanation":"y"}'));
    const llm = createLlm({ api: "ollama", baseUrl: "http://h/v1", model: "m", numCtx: 1, temperature: 0, timeoutMs: 1000, fetchImpl: f as never });
    const r = await llm.json(CodeSchema, []);
    expect(r.attempts).toBe(2);
    const second = JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(second.messages.at(-1).content).toMatch(/didn't match the schema/);
  });

  it("uses response_format json_schema in OpenAI mode", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"code":"x","explanation":"y"}' } }] })));
    const llm = createLlm({ api: "openai", baseUrl: "http://h/v1", model: "m", numCtx: 1, temperature: 0, timeoutMs: 1000, fetchImpl: f as never });
    await llm.json(CodeSchema, []);
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("http://h/v1/chat/completions");
    expect(JSON.parse(String(init.body)).response_format.type).toBe("json_schema");
  });

  it("talks to OpenAI's reasoning models: key, reasoning_effort, room for thinking, strict schema, no temperature", async () => {
    const reply = { title: "t", goal: "g", behavior: ["b"], parts: [{ kind: "led", purpose: "p", color: null, pin: null }], questions: [] };
    const f = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] })));
    const llm = createLlm({ api: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-6-luna", numCtx: 1, temperature: 0.2, timeoutMs: 1000, apiKey: "sk-test", reasoningEffort: "low", fetchImpl: f as never });
    const r = await llm.json(PlanSchema, [], { maxTokens: 1200 });
    // The nulls standing in for "left out" are dropped before zod.
    expect(r.data.parts[0]).toEqual({ kind: "led", purpose: "p" });
    const [url, init] = f.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "gpt-6-luna", reasoning_effort: "low", max_completion_tokens: 1200 + REASONING_HEADROOM });
    expect(body.temperature).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
    const part = body.response_format.json_schema.schema.properties.parts.items;
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(part.required).toEqual(["kind", "purpose", "color", "pin"]);
    expect(part.properties.color).toMatchObject({ type: ["string", "null"], enum: ["red", "green", "yellow", "blue", "white", null] });
    expect(part.additionalProperties).toBe(false);
    expect(JSON.stringify(body.response_format)).not.toMatch(/minLength/);
  });

  it("strict schema and null dropping leave required fields and arrays alone", () => {
    const s = strictSchema({ type: "object", properties: { a: { type: "string", minLength: 1 }, b: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["a", "b"] }) as Record<string, any>;
    expect(s).toEqual({ type: "object", properties: { a: { type: "string" }, b: { type: "array", items: { type: "string" }, minItems: 1 } }, required: ["a", "b"], additionalProperties: false });
    expect(dropNulls({ a: null, b: [{ c: null, d: 1 }], e: "x" })).toEqual({ b: [{ d: 1 }], e: "x" });
  });

  it("explains OpenAI key and credit errors", async () => {
    const make = (status: number) => createLlm({ api: "openai", baseUrl: "https://x/v1", model: "m", numCtx: 1, temperature: 0, timeoutMs: 1000, apiKey: "sk", reasoningEffort: "low", fetchImpl: (async () => new Response("nope", { status })) as never });
    await expect(make(401).json(CodeSchema, [])).rejects.toThrow(/rejected the API key.*OPENAI_API_KEY/);
    await expect(make(429).json(CodeSchema, [])).rejects.toThrow(/out of credit or over its rate limit/);
  });

  it("turns HTTP and network failures into LlmError", async () => {
    const http = createLlm({ api: "ollama", baseUrl: "http://h", model: "m", numCtx: 1, temperature: 0, timeoutMs: 1000, fetchImpl: (async () => new Response("model not found", { status: 404 })) as never });
    await expect(http.json(CodeSchema, [])).rejects.toThrow(/HTTP 404: model not found/);
    const net = createLlm({ api: "ollama", baseUrl: "http://h", model: "m", numCtx: 1, temperature: 0, timeoutMs: 1000, fetchImpl: (async () => { throw new Error("ECONNREFUSED"); }) as never });
    await expect(net.json(CodeSchema, [])).rejects.toBeInstanceOf(LlmError);
  });
});

describe("token usage and Stop", () => {
  it("adds every model call's tokens to the project", async () => {
    const { llm } = fakeLlm({ intake: [intake("clear")], plan: [LED_BUTTON], code: [GOOD_CODE] });
    const p = await createProject(deps(llm), "LED and button");
    expect(p.usage).toEqual({ input: 300, output: 60, reasoning: 0, calls: 3 });
  });

  it("reads tokens from Ollama and OpenAI replies, summed over the JSON retry", async () => {
    const ollama = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: "{}" }, prompt_eval_count: 50, eval_count: 7 }))).mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: '{"code":"x","explanation":"y"}' }, prompt_eval_count: 60, eval_count: 9 })));
    const a = await createLlm({ api: "ollama", baseUrl: "http://h", model: "m", numCtx: 1, temperature: 0, timeoutMs: 1000, fetchImpl: ollama as never }).json(CodeSchema, []);
    expect(a.usage).toEqual({ input: 110, output: 16, reasoning: 0 });
    const openai = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"code":"x","explanation":"y"}' } }], usage: { prompt_tokens: 900, completion_tokens: 400, completion_tokens_details: { reasoning_tokens: 250 } } })));
    const b = await createLlm({ api: "openai", baseUrl: "http://h/v1", model: "m", numCtx: 1, temperature: 0, timeoutMs: 1000, apiKey: "k", reasoningEffort: "low", fetchImpl: openai as never }).json(CodeSchema, []);
    expect(b.usage).toEqual({ input: 900, output: 400, reasoning: 250 });
  });

  it("Stop cancels the running model call; the project fails with a retry point and keeps its tokens", async () => {
    let started!: () => void;
    const running = new Promise<void>((r) => (started = r));
    const llm: LlmClient = {
      model: "slow",
      async json(_schema, _m, opts) {
        started();
        await new Promise((_, reject) => opts?.signal?.addEventListener("abort", () => reject(Object.assign(new LlmError("aborted"), { usage: { input: 40, output: 0, reasoning: 0 } }))));
        throw new Error("unreachable");
      },
    };
    const d = deps(llm);
    const accepted = await createProject(d, "LED and button", undefined, { background: true });
    await running;
    await stopProject(d, accepted.id);
    await vi.waitFor(async () => expect((await d.store.get(accepted.id))?.failure).toBe(STOPPED_MESSAGE));
    const p = (await d.store.get(accepted.id))!;
    expect(p).toMatchObject({ state: "FAILED", resumeFrom: "intake", usage: { input: 40, calls: 1 } });
    await expect(stopProject(d, accepted.id)).rejects.toThrow(/isn't running/);
    await expect(stopProject(d, "missing")).rejects.toThrow(/not found/);
  });
});

describe("choosing the model per project", () => {
  it("uses the local model by default and OpenAI's for projects that chose it", async () => {
    const local = fakeLlm({ intake: [intake("clear")], plan: [LED_BUTTON], code: [GOOD_CODE] });
    const cloud = fakeLlm({ intake: [intake("clear")], plan: [LED_BUTTON], code: [GOOD_CODE] });
    const d = deps(local.llm, { cloudLlm: cloud.llm });
    const a = await createProject(d, "LED and button");
    expect(a.llm).toBe("local");
    expect([local.calls.length, cloud.calls.length]).toEqual([3, 0]);
    const b = await createProject({ ...d, newId: () => "22222222-2222-4222-8222-222222222222" }, "LED and button", undefined, { llm: "openai" });
    expect(b).toMatchObject({ llm: "openai", state: "READY" });
    expect([local.calls.length, cloud.calls.length]).toEqual([3, 3]);
  });

  it("refuses OpenAI without a key, before storing anything", async () => {
    const d = deps(fakeLlm({}).llm);
    await expect(createProject(d, "LED and button", undefined, { llm: "openai" })).rejects.toThrow(/OPENAI_API_KEY/);
    expect(await d.store.list()).toEqual([]);
  });

  it("an OpenAI project whose key was removed fails clearly on retry", async () => {
    const cloud = fakeLlm({ intake: [() => { throw new LlmError("down"); }] });
    const store = memoryStore();
    const failed = await createProject(deps(fakeLlm({}).llm, { cloudLlm: cloud.llm, store }), "LED and button", undefined, { llm: "openai" });
    expect(failed.state).toBe("FAILED");
    const retried = await retryProject(deps(fakeLlm({}).llm, { store }), failed.id);
    expect(retried.failure).toMatch(/OPENAI_API_KEY/);
  });
});

describe("project API routes", () => {
  let app: FastifyInstance;
  afterEach(async () => {
    await app?.close();
  });
  const make = (llm: LlmClient) =>
    (app = buildApp({ agent: deps(llm), health: { checkDb: async () => ({ status: "ok", detail: "" }), listModels: async () => [], llmModel: "m", embedModel: "e" } }));

  it("POST /stop answers 409 when nothing runs", async () => {
    const { llm } = fakeLlm({ intake: [intake("clear")], plan: [LED_BUTTON], code: [GOOD_CODE] });
    make(llm);
    const id = (await app.inject({ method: "POST", url: "/api/projects", payload: { idea: "LED and button" } })).json().id;
    expect((await app.inject({ method: "POST", url: `/api/projects/${id}/stop` })).statusCode).toBe(409);
  });

  it("lists the models a new project can use", async () => {
    make(fakeLlm({}).llm);
    expect((await app.inject({ method: "GET", url: "/api/llm-options" })).json()).toEqual({ local: { model: "fake" }, openai: { available: false } });
    await app.close();
    app = buildApp({ agent: deps(fakeLlm({}).llm, { cloudLlm: { ...fakeLlm({}).llm, model: "gpt-6-luna" } }), health: { checkDb: async () => ({ status: "ok", detail: "" }), listModels: async () => [], llmModel: "m", embedModel: "e" } });
    expect((await app.inject({ method: "GET", url: "/api/llm-options" })).json().openai).toEqual({ available: true, model: "gpt-6-luna" });
  });

  it("creates, lists, fetches and exports a project", async () => {
    const { llm } = fakeLlm({ intake: [intake("clear")], plan: [LED_BUTTON], code: [GOOD_CODE] });
    make(llm);
    const created = await app.inject({ method: "POST", url: "/api/projects", payload: { idea: "LED and button" } });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect((await app.inject({ method: "GET", url: "/api/projects" })).json()).toEqual([expect.objectContaining({ id, state: "READY", title: "Button LED" })]);
    expect((await app.inject({ method: "GET", url: `/api/projects/${id}` })).json().build.codeCheck.ok).toBe(true);
    const handoff = await app.inject({ method: "GET", url: `/api/projects/${id}/handoff` });
    expect(handoff.headers["content-type"]).toContain("text/markdown");
    expect(handoff.body).toContain("# Project handoff: Button LED");
  });

  it("returns 400, 404 and 409 with the standard error shape", async () => {
    const { llm } = fakeLlm({ intake: [intake("clear")], plan: [LED_BUTTON], code: [GOOD_CODE] });
    make(llm);
    expect((await app.inject({ method: "POST", url: "/api/projects", payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/projects", payload: { idea: "x" } })).json()).toMatchObject({ code: "BAD_REQUEST" });
    expect((await app.inject({ method: "GET", url: "/api/projects/nope" })).statusCode).toBe(404);
    const id = (await app.inject({ method: "POST", url: "/api/projects", payload: { idea: "LED and button" } })).json().id;
    expect((await app.inject({ method: "POST", url: `/api/projects/${id}/approve`, payload: {} })).json()).toMatchObject({ code: "CONFLICT" });
  });
});
