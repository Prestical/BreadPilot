// Prompts for each pipeline stage. Kept short and concrete for a 4B model: one job
// per prompt, the allowed parts spelled out, and a small worked example.

import type { PlacedBlock } from "@breadpilot/circuit-core";
import type { ChatMessage } from "./llm";
import { AGENT_PACKS, agentOf, blockVars, fill, joinList } from "./packText";
import type { Intake, Plan } from "./schemas";
import { NOT_AVAILABLE_TEXT } from "./vocabulary";

// The parts list comes from the part packs (agent.json plan.line); what isn't available from the
// engine vocabulary minus what packs claim.
const CONTEXT = `You help complete beginners build electronics projects with a Raspberry Pi Pico 2 W on a breadboard.
The ONLY parts available are:
${AGENT_PACKS.map((p) => `- "${p.meta.kind}": ${p.agent!.plan.line}`).join("\n")}
The Pico 2 W also has its own on-board LED, an internal temperature sensor, Wi-Fi and Bluetooth, and can print to the computer over USB. These need no extra parts.
Anything else (${NOT_AVAILABLE_TEXT.join(", ")}) is NOT available.`;

const KIND_LIST = joinList(AGENT_PACKS.map((p) => `"${p.meta.kind}"`), "or");
const PLAN_HINTS = AGENT_PACKS.flatMap((p) => (p.agent!.plan.hint ? [` ${p.agent!.plan.hint}`] : [])).join("");
/** Driver modules the code may import, e.g. "sh1106 when an OLED display is listed". */
const MODULE_RULES = AGENT_PACKS.flatMap((p) => (p.agent!.code.moduleRule ? [p.agent!.code.moduleRule] : []));

export function intakeMessages(idea: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: `${CONTEXT}

Classify the user's project idea:
- "clear": you can tell which available parts are needed and what they should do.
- "vague": too general to know what to build (e.g. "something cool with lights").
- "unsupported": it needs a part that is NOT available. List those parts in unsupportedParts.
Write the title and goal in plain, friendly English. "behaviors" lists what the project does, one short sentence each.
"missing" lists what you'd need to ask a vague user. Use empty lists when nothing applies.

Example: "make an LED blink when I press a button" ->
{"clarity":"clear","title":"Button-controlled LED","goal":"Light an LED while a button is pressed.","behaviors":["When the button is pressed, the LED turns on.","When it is released, the LED turns off."],"missing":[],"unsupportedParts":[]}`,
    },
    { role: "user", content: idea },
  ];
}

export function planMessages(idea: string, intake: Intake, opts: { feedback?: string; previous?: Plan; fixError?: string } = {}): ChatMessage[] {
  const extra: string[] = [];
  if (opts.previous) extra.push(`Your previous plan:\n${JSON.stringify(opts.previous)}`);
  if (opts.feedback) extra.push(`The user wants these changes: ${opts.feedback}`);
  if (opts.fixError) extra.push(`The previous plan can't be built: ${opts.fixError}\nFix the parts list so it can be built.`);
  return [
    {
      role: "system",
      content: `${CONTEXT}

Write a short beginner-friendly project plan.
- "parts": one entry per physical part, using only ${KIND_LIST}. Give each part a short purpose.${PLAN_HINTS}
  Use an empty list ONLY if the idea is about the Pico's own on-board LED and needs no other parts.
- Set "pin" (like "GP15") ONLY if the user explicitly asked for that GPIO. Otherwise leave it out; pins are chosen automatically.
- "behavior": what the finished project does, step by step, in simple sentences.
- "questions": only for a vague idea, up to 3 short questions; otherwise empty.
Use as few parts as the idea needs.

Example for "traffic light with a button":
{"title":"Mini traffic light","goal":"Cycle red, yellow and green LEDs when a button is pressed.","behavior":["The red LED is on at the start.","Each button press moves to the next light: red, then green, then yellow."],"parts":[{"kind":"led","purpose":"stop light","color":"red"},{"kind":"led","purpose":"wait light","color":"yellow"},{"kind":"led","purpose":"go light","color":"green"},{"kind":"button","purpose":"change the light"}],"questions":[]}`,
    },
    {
      role: "user",
      content: [`Project idea: ${idea}`, `Understanding so far: ${JSON.stringify({ goal: intake.goal, behaviors: intake.behaviors, missing: intake.missing })}`, ...extra].join("\n\n"),
    },
  ];
}

/** One line per wired part (agent.json code.pinLine). {n} numbers repeated parts of a kind: "", "2"… */
export function pinTable(blocks: PlacedBlock[], colors: Record<string, string>): string {
  if (!blocks.length) return '- No parts are wired. Use only the Pico 2 W\'s on-board LED: Pin("LED", Pin.OUT). (It is NOT GP25, GP16 or GP2: those are other boards or other pins.)';
  return blocks
    .map((b) => {
      const same = blocks.filter((x) => x.kind === b.kind);
      const n = same.indexOf(b) === 0 ? "" : String(same.indexOf(b) + 1);
      return `- ${fill(agentOf(b.kind).code.pinLine, blockVars(b, undefined, { n, color: colors[b.ref] ?? "red" }))}`;
    })
    .join("\n");
}

const NETWORK_RULES = `
- Wi-Fi always starts with wlan = network.WLAN(network.STA_IF) and wlan.active(True): every other wlan call needs these two lines first.
- Joining a network is only needed to talk to other devices or the internet (web pages, a web server, MQTT, NTP time): wlan.connect(WIFI_SSID, WIFI_PASSWORD), then wait until wlan.isconnected(). Only then put WIFI_SSID, WIFI_PASSWORD and any IP address in constants at the top with a comment telling the user to fill them in. wlan.ifconfig()[0] is the Pico's own IP.
- wlan.scan() only listens: it works right after wlan.active(True) without joining a network, so it needs no SSID, password or connect code. It returns a list of tuples (ssid, bssid, channel, rssi, security, hidden): ssid is bytes (.decode() it; it is empty for hidden networks) and rssi (index 3) is the signal strength in dBm, about -30 (strong) to -90 (weak).
- If the user says not to use a password or not to connect, don't add WIFI_SSID, WIFI_PASSWORD or connect code.
- MicroPython has NO ping. To check whether a computer is reachable, open a TCP connection with socket (e.g. to port 80, 22 or 445) inside try/except and report success or failure. Explain this in "explanation".`;

/** Network instructions only when the project is about networking, so they don't leak into other code. */
export function needsNetwork(text: string): boolean {
  return /\b(wi-?fi|wlan|network|internet|online|ip|ping|https?|web|website|webpage|server|browser|phone|mqtt|api|cloud|email|ntp|bluetooth|ble)\b/i.test(text);
}

export function codeMessages(plan: Plan, pins: string, references: string, fix?: { code: string; problems: string[] }, network = false): ChatMessage[] {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You write MicroPython for a Raspberry Pi Pico 2 W, for a complete beginner.
Rules:
- Use ONLY the pins listed. Never use any other GPIO. Set each one up exactly as shown.
- Start with imports. Every name you use must be imported: time.sleep needs "import time", PWM needs "from machine import PWM", random.randint needs "import random".
- Use a "while True:" main loop with a short time.sleep() so it doesn't run flat out.
- Put a short comment above each part of the code explaining what it does, in simple words.
- Indent with 4 spaces. Keep it under 60 lines. No classes.
- Only use modules built into MicroPython on the Pico 2 W (machine, time, random, math, network, socket, urequests, json, ntptime)${MODULE_RULES.length ? `, plus ${MODULE_RULES.join(", ")} (its file is provided)` : ""}. No pip packages.
- Every name you use must be defined first (no typos: BLINK_DELAY is not BLINK).${network ? NETWORK_RULES : "\n- This project doesn't use Wi-Fi: don't add any network code or Wi-Fi settings."}
"explanation": 2-4 sentences telling the beginner what the program does.

Program shape (adapt it, keep this order):
from machine import Pin
import time

# Settings
BLINK_DELAY = 0.5

# Set up the parts
led = Pin(16, Pin.OUT)

# Main loop
while True:
    led.toggle()
    time.sleep(BLINK_DELAY)`,
    },
    {
      role: "user",
      content: `Project: ${plan.title}
Goal: ${plan.goal}
Behavior:
${plan.behavior.map((b) => `- ${b}`).join("\n")}

Pins (already wired, use exactly these):
${pins}
${references ? `\nReference notes from the official documentation:\n${references}` : ""}`,
    },
  ];
  if (fix) {
    messages.push(
      { role: "assistant", content: JSON.stringify({ code: fix.code, explanation: "(previous attempt)" }) },
      { role: "user", content: `That code has problems:\n${fix.problems.map((p) => `- ${p}`).join("\n")}\nReturn the corrected program.` },
    );
  }
  return messages;
}
