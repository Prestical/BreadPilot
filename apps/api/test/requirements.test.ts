// Principle-based tests for agent/requirements.ts. The examples are deliberately NOT taken
// from data/eval/*.jsonl, so passing them says something about general behavior.
import { describe, expect, it } from "vitest";
import { PICO_2_W } from "@breadpilot/circuit-core";
import { analyzeIdea, mergeRequirements, minimumParts, planProblems, TEMPERATURE_QUESTION, UNSUPPORTED_DISPLAY } from "../src/agent/requirements";
import { ALARM_SOUND_QUESTION } from "../src/agent/vocabulary";
import type { Plan, PartKind } from "../src/agent/schemas";

const a = (text: string) => analyzeIdea(text, PICO_2_W);
const planWith = (counts: Partial<Record<PartKind, number>>): Plan => ({
  title: "t",
  goal: "g",
  behavior: ["b"],
  questions: [],
  parts: Object.entries(counts).flatMap(([kind, n]) => Array.from({ length: n! }, () => ({ kind: kind as PartKind, purpose: "p" }))),
});

describe("1. unambiguous component names are unsupported", () => {
  it.each([
    ["Spin a small motor faster when I turn a knob", "motors or servos"],
    ["Wave a flag using a servo", "motors or servos"],
    ["Show my name on an LCD", UNSUPPORTED_DISPLAY],
    ["Rainbow effect on a NeoPixel ring", "RGB or addressable LEDs"],
    ["Read a DHT22 every minute", "a temperature sensor other than the DHT11 (such as a DHT22, BME280, DS18B20 or thermistor) or a moisture sensor"],
    ["Switch a lamp with a relay", "a relay or high-power device"],
    ["Type a code on a keypad to unlock", "an input module that isn't supported yet"],
  ])("%s", (idea, label) => {
    expect(a(idea).unsupported).toContain(label);
  });
});

describe("2. context words count only in a component context", () => {
  it.each([
    ["Print the button count to the serial monitor on my laptop", []],
    ["Display how many times I pressed using three LEDs", []],
    ["I want to display the knob value", []],
    ["Blink an LED to the beat of a song", []], // M15: songs are the buzzer's
    ["Show the time on a small screen", []],
    ["Scan Wi-Fi when I click the button, it will display on i2C Display", []],
    ["Print text on a 16x2 screen", [UNSUPPORTED_DISPLAY]],
    ["Play a tune when the button is pressed", []],
    ["Count how often it beeps", []],
    ["Read the news aloud through a speaker", ["a speaker or headphones (for recorded sound or speech; the buzzer only plays tones)"]],
    ["Turn on the LED when it gets dark outside", ["a light sensor"]],
    ["Measure the distance to the wall", ["a distance sensor"]],
    ["Blink faster when an object comes close", ["a distance sensor"]],
    ["Cool down my desk with a fan", ["a fan (needs a driver)"]],
  ])("%s", (idea, labels) => {
    expect(a(idea).unsupported).toEqual(labels);
  });
});

describe("3. unsure → ask instead of guessing", () => {
  it("asks about an alarm", () => {
    const r = a("Build an alarm that I arm with a button");
    expect(r.unsupported).toEqual([]);
    expect(r.ambiguous[0]).toMatch(/alarm/);
  });
  it("asks which numbering 'pin 20' uses", () => {
    expect(a("Put the LED on pin 20").ambiguous[0]).toBe(
      'You wrote "pin 20". Do you mean physical pin 20 (GP15), or GPIO 20 (GP20)? Please write it as GP20 or name the physical pin.',
    );
  });
  it("doesn't ask when the GPIO is written clearly", () => {
    const r = a("Put the LED on GP20 and a button on GPIO 21");
    expect(r.ambiguous).toEqual([]);
    expect(r.pins).toEqual(["GP20", "GP21"]);
  });
  it("marks very short ideas", () => {
    expect(a("LEDs!").tooShort).toBe(true);
    expect(a("a blinking LED please").tooShort).toBe(false);
  });
});

describe("4. negation is respected", () => {
  it.each([
    "A visual timer with LEDs, no buzzer",
    "Light an LED without any speaker",
    "Use LEDs instead of a screen",
    "Blink an LED; a motor is not needed",
  ])("%s", (idea) => {
    expect(a(idea).unsupported).toEqual([]);
  });
  it("records excluded parts", () => {
    const r = a("Blink two LEDs, no button");
    expect(r.removed).toEqual(["button"]);
    expect(r.parts).toEqual({ led: { min: 2, exact: 2 } });
  });
});

describe("5. the board's own features are supported", () => {
  it.each(["Toggle the on-board LED every second", "Log the Pico's internal temperature sensor to my computer", "Switch the onboard LED from a web page over Wi-Fi"])("%s", (idea) => {
    expect(a(idea).unsupported).toEqual([]);
  });
  it("the on-board LED is not an external part", () => {
    const r = a("Toggle the on-board LED every second");
    expect(r.onboard).toBe(true);
    expect(r.parts.led).toBeUndefined();
  });
  it("an outside temperature needs the DHT11 (M15)", () => {
    const r = a("Turn on an LED when the room temperature is high");
    expect(r.unsupported).toEqual([]);
    expect(r.parts.dht11).toEqual({ min: 1 });
  });
});

describe("5b. temperature (M15, user 11/11/2026): the air's needs the DHT11, the chip's own sensor only when the idea is about the chip", () => {
  const OTHER = "a temperature sensor other than the DHT11 (such as a DHT22, BME280, DS18B20 or thermistor) or a moisture sensor";

  it.each(["Print the chip temperature to my laptop once a minute", "Light an LED if the CPU's temperature goes above 30 degrees", "Graph the processor temperature over an hour on a screen", "Show the temperature of the Pico on a 128x64 display"])(
    "the chip's own temperature: no DHT11, nothing to ask: %s",
    (idea) => {
      const r = a(idea);
      expect(r.unsupported).toEqual([]);
      expect(r.ambiguous).not.toContain(TEMPERATURE_QUESTION);
      expect(r.parts.dht11).toBeUndefined();
    },
  );

  it.each([
    "Put the temperature on a small display every few seconds",
    "Keep a list of temperature readings and send them to my computer",
    "Show the outside temperature and humidity on a screen",
    "Log the air temperature in my greenhouse plant room",
    "Compare the chip temperature with the room temperature",
    "Light an LED when it gets humid",
    "A small weather station on the OLED",
    "Use a temperature sensor to show how warm my room is",
  ])("the air's temperature or humidity needs the DHT11, nothing refused or asked: %s", (idea) => {
    const r = a(idea);
    expect(r.unsupported).toEqual([]);
    expect(r.ambiguous).not.toContain(TEMPERATURE_QUESTION);
    expect(r.parts.dht11).toEqual({ min: 1 });
  });

  it.each(["Read a DHT11 every two seconds", "Show the DHT11's humidity on the screen", "Two DHT11 sensors, one per room"])("a named DHT11 is a part: %s", (idea) => {
    const r = a(idea);
    expect(r.unsupported).toEqual([]);
    expect(r.parts.dht11!.min).toBeGreaterThanOrEqual(1);
    expect(r.named).toContain("dht11");
  });

  it.each(["Turn on an LED when the water gets cold", "Show my coffee's temperature on the screen", "Measure the soil temperature in my garden", "Read my body temperature"])(
    "a temperature the air sensor can't measure still needs another sensor: %s",
    (idea) => {
      expect(a(idea).unsupported).toEqual([OTHER]);
    },
  );

  it("'no temperature' isn't a DHT11; a condition like 'gets hot' is left to the plan", () => {
    expect(a("Blink an LED, no temperature needed").parts.dht11).toBeUndefined();
    const hot = a("Flash an LED faster as it gets hot");
    expect(hot.unsupported).toEqual([]);
    expect(hot.ambiguous).not.toContain(TEMPERATURE_QUESTION);
  });
});

describe("6. counts: one clear number is exact, a choice is a range, no number is at least one", () => {
  it.each([
    ["Five LEDs that light up in turn", { led: { min: 5, exact: 5 } }],
    ["A purple LED and an orange LED", { led: { min: 2 } }],
    ["Use 3 dials to set the speed of a blinking LED", { pot: { min: 3, exact: 3 }, led: { min: 1 } }],
    ["Press to start a countdown on an LED", { button: { min: 1 }, led: { min: 1 } }],
    ["Switch on 2 LEDs one after another", { led: { min: 2, exact: 2 } }],
    ["Up to 8 LEDs show the level", { led: { min: 8, exact: 8 } }],
    ["Use 2 or 3 LEDs as a light bar", { led: { min: 2, max: 3 } }],
    ["Three LEDs: red, green and blue. The three LEDs blink.", { led: { min: 3, exact: 3 } }],
    ["Three LEDs, and later two LEDs", { led: { min: 3 } }],
  ])("%s", (idea, parts) => {
    expect(a(idea).parts).toEqual(parts);
  });
  it("only attaches a number directly in front of the noun", () => {
    expect(a("LED on pin 20 that I switch with a button").parts).toEqual({ led: { min: 1 }, button: { min: 1 } });
    expect(a("Blink 3 times when I press the button").parts).toEqual({ led: { min: 1 }, button: { min: 1 } });
    expect(a("Two small red LEDs").parts).toEqual({ led: { min: 2, exact: 2 } });
    expect(a("After 10 seconds the LED turns off").parts).toEqual({ led: { min: 1 } });
  });
  it("skips descriptive words between the count and the part", () => {
    expect(a("Make 4 same red blinking LED flawless sequence in increasing frequency").parts).toEqual({ led: { min: 4, exact: 4 } });
    expect(a("Two flashing green LEDs").parts).toEqual({ led: { min: 2, exact: 2 } });
    expect(a("Three identical push buttons").parts).toEqual({ button: { min: 3, exact: 3 } });
    expect(a("A red blinking LED and a green blinking LED").parts).toEqual({ led: { min: 2 } });
    expect(a("Blink 3 times after pressing the button").parts).toEqual({ led: { min: 1 }, button: { min: 1 } });
  });
  it("exact: more than asked is a problem", () => {
    expect(planProblems(planWith({ led: 5, pot: 1 }), a("A knob lights up 0 to 4 LEDs"))).toEqual(['The request asks for exactly 4 LEDs, but the plan has 5. Use exactly 4 parts of kind "led".']);
  });
  it("exact: fewer than asked is a problem", () => {
    expect(planProblems(planWith({ led: 1 }), a("Two LEDs blinking"))).toEqual(['The request asks for exactly 2 LEDs, but the plan has 1. Use exactly 2 parts of kind "led".']);
  });
  it("no number: more is fine, none is not", () => {
    expect(planProblems(planWith({ led: 3 }), a("Blink some LEDs"))).toEqual([]);
    expect(planProblems(planWith({ button: 1 }), a("Blink some LEDs"))).toEqual(['The request mentions an LED, but the plan has none. Add 1 part(s) of kind "led".']);
  });
  it("a choice allows anything in the range", () => {
    const req = a("Use 2 or 3 LEDs as a light bar");
    expect(planProblems(planWith({ led: 3 }), req)).toEqual([]);
    expect(planProblems(planWith({ led: 4 }), req)).toEqual(['The request asks for at most 3 LEDs, but the plan has 4. Remove 1 part(s) of kind "led".']);
  });
  it("turns minimum counts into layout requests", () => {
    expect(minimumParts(a("Three LEDs and a knob"))).toEqual([{ kind: "led" }, { kind: "led" }, { kind: "led" }, { kind: "pot" }]);
  });
});

describe("7. feedback overrides the idea", () => {
  it("removing a part drops its requirement and forbids it", () => {
    const req = mergeRequirements(a("An LED that I turn on with a button"), a("Remove the button, just blink the LED"));
    expect(req.parts).toEqual({ led: { min: 1 } });
    expect(planProblems(planWith({ led: 1, button: 1 }), req)).toEqual(['The user doesn\'t want any part of kind "button". Remove it from the plan.']);
  });
  it("adding a part raises the requirement", () => {
    expect(mergeRequirements(a("Blink an LED"), a("make it three LEDs")).parts.led).toEqual({ min: 3, exact: 3 });
  });
});

describe("8. ideas that name their parts get only those parts", () => {
  it("forbids an unrequested kind for an idea that names parts", () => {
    expect(planProblems(planWith({ button: 1, led: 1 }), a("Ping my laptop when I click the button"))).toEqual([
      'The request doesn\'t ask for any part of kind "led". Only use the parts the request asks for; remove the LEDs.',
    ]);
  });
  it("forbids external parts for an on-board LED idea", () => {
    expect(planProblems(planWith({ led: 1 }), a("Blink the built-in LED"))).toHaveLength(1);
  });
  it("allows extras for ideas that name no parts", () => {
    expect(planProblems(planWith({ led: 2, button: 1 }), a("something cool with lights"))).toEqual([]);
    expect(planProblems(planWith({ led: 1, pot: 1 }), a("make a game for my kid"))).toEqual([]);
  });
  it("never restricts non-English ideas", () => {
    expect(planProblems(planWith({ led: 1, button: 1 }), a("Butona basınca kırmızı LED yansın"))).toEqual([]);
  });
  it("parts named in feedback are allowed", () => {
    const req = mergeRequirements(a("Blink an LED"), a("add a button to pause it"));
    expect(planProblems(planWith({ led: 1, button: 1 }), req)).toEqual([]);
  });
});

describe("plans with no parts", () => {
  it("are fine for the on-board LED only", () => {
    expect(planProblems(planWith({}), a("Blink the built-in LED"))).toEqual([]);
    expect(planProblems(planWith({}), a("Make a fun game"))).toHaveLength(1);
  });
});

describe("robustness", () => {
  it("handles empty, punctuation-only, very long and non-English input without throwing", () => {
    for (const text of ["", "!!!", "?", "LED ".repeat(500), "Butona basınca LED yansın", "🚦🚦"]) expect(() => a(text)).not.toThrow();
    expect(a("").tooShort).toBe(true);
  });
});

describe("displays (Milestone 6): the 1.3\" I2C OLED is a part; other display types aren't", () => {
  it.each([
    ["Show the button count on an OLED", { oled: { min: 1 }, button: { min: 1 } }],
    ["Write my name on the screen", { oled: { min: 1 } }],
    ["Show the knob value on a small i2c display", { oled: { min: 1 }, pot: { min: 1 } }],
    ["Use two displays to show two counters", { oled: { min: 2, exact: 2 } }],
  ])("%s", (idea, parts) => {
    const r = a(idea);
    expect(r.unsupported).toEqual([]);
    expect(r.parts).toMatchObject(parts);
  });

  it.each([
    ["Display the time with three LEDs", "the verb 'display' is not a part"],
    ["Print the knob value on my computer screen", "the computer's screen is the USB serial link"],
    ["Blink an LED without a screen", "negated"],
  ])("%s (no display part: %s)", (idea) => {
    expect(a(idea).parts.oled).toBeUndefined();
  });

  it.each(["Show text on an LCD display", "A 16x2 screen that shows the time", "Draw pictures on a color TFT", "A touchscreen menu", "Count down on a 7-segment display"])(
    "%s → unsupported display, not our OLED",
    (idea) => {
      const r = a(idea);
      expect(r.unsupported).toEqual([UNSUPPORTED_DISPLAY]);
      expect(r.parts.oled).toBeUndefined();
    },
  );

  it("a 128x64 display is ours", () => {
    expect(a("Show the temperature of the Pico on a 128x64 display").unsupported).toEqual([]);
  });

  it("three displays can't be wired (same I2C address, two buses)", () => {
    expect(minimumParts(a("Show three numbers on three OLED displays"))).toEqual([{ kind: "oled" }, { kind: "oled" }, { kind: "oled" }]);
  });
});

describe("6c. a second, another, the other: one more of the same part", () => {
  it.each([
    ["One knob sets the speed and a second knob sets the brightness", { pot: { min: 2 } }],
    ["Press one button to start, then press another button to stop", { button: { min: 2 } }],
    ["The first LED blinks fast, the second LED slowly and the third LED stays on", { led: { min: 3 } }],
    ["Use one button for left and the other button for right", { button: { min: 2 } }],
    ["A 2nd display shows the score", { oled: { min: 2 } }],
  ])("%s", (idea, parts) => {
    expect(a(idea).parts).toEqual(parts);
  });

  it("a clear number that already covers them stays exact", () => {
    expect(a("Two buttons: one button goes up, the other button goes down").parts).toEqual({ button: { min: 2, exact: 2 } });
  });

  it("'a second time' or 'each other' are not parts", () => {
    expect(a("Press the button a second time to switch the LED off").parts).toEqual({ button: { min: 1 }, led: { min: 1 } });
    expect(a("Two LEDs that copy each other").parts).toEqual({ led: { min: 2, exact: 2 } });
  });
});

describe("6d. a list of colors before one LED noun is that many LEDs", () => {
  it.each([
    ["Fade a red, a green and a blue LED in turn", 3],
    ["Light a yellow or a white LED depending on the knob", 2],
    ["Blink a red LED", 1],
  ])("%s", (idea, n) => {
    expect(a(idea).parts.led?.min).toBe(n);
  });
});

describe("6b. a size is not a count", () => {
  it.each([
    ['Show the score on the 1.3" OLED', { oled: { min: 1 } }],
    ["Show the score on a 0.96 inch OLED", { oled: { min: 1 } }],
    ['Two 1.3" OLEDs, one per player', { oled: { min: 2, exact: 2 } }],
    ["Three 12 mm buttons for a quiz", { button: { min: 3, exact: 3 } }],
    ["Blink 3 LEDs, each every 1.5 seconds", { led: { min: 3, exact: 3 } }],
  ])("%s", (idea, parts) => {
    const r = a(idea);
    expect(r.parts).toMatchObject(parts);
    for (const [kind, need] of Object.entries(parts)) if (!("exact" in need)) expect(r.parts[kind as PartKind]?.exact, kind).toBeUndefined();
  });
});

describe("9. talking about filming isn't asking for a camera", () => {
  it.each(["Make the LED bright enough to see on camera", "When the button is pressed, the LED says smile for the camera", "Big text on the OLED so it reads well on camera"])("%s", (idea) => {
    expect(a(idea).unsupported).toEqual([]);
  });

  it.each(["A robot with a camera that blinks an LED", "Take a photo with the camera when the button is pressed"])("%s → a camera part, unsupported", (idea) => {
    expect(a(idea).unsupported).toEqual(["a module that isn't supported yet"]);
  });
});

describe("10. words that imply a part don't when a named part is what they describe", () => {
  it.each([
    ["The OLED flashes the score when the button is pressed", { oled: { min: 1 }, button: { min: 1 } }],
    ["A face on the display that blinks every few seconds", { oled: { min: 1 } }],
  ])("%s → no LED", (idea, parts) => {
    const r = a(idea);
    expect(r.parts).toMatchObject(parts);
    expect(r.parts.led).toBeUndefined();
  });

  it.each([
    ["Make something blink when I press the button", "no display named: blinking means an LED"],
    ["Blink an LED and print the count to the computer screen", "the LED is named; the computer screen isn't our display"],
    ["Show the count on the OLED and blink an LED with it", "the LED is named next to the display"],
  ])("%s (LED: %s)", (idea) => {
    expect(a(idea).parts.led).toMatchObject({ min: 1 });
  });
});


describe("taking away one of several parts (M9 change test, 11/11/2026)", () => {
  const idea = "A red LED and a green LED that blink one after the other, and a button that stops and starts the blinking";
  it("'remove the green LED' means one LED fewer, not no LEDs (both models failed this change)", () => {
    const change = a("Remove the green LED: only the red one should blink");
    expect(change.removed).toEqual([]);
    expect(change.fewer).toEqual({ led: 1 });
    const req = mergeRequirements(a(idea), change);
    expect(req.parts.led).toEqual({ min: 1 });
    expect(req.parts.button).toEqual({ min: 1 });
    expect(req.removed).toEqual([]);
    const plan = (parts: Plan["parts"]): Plan => ({ title: "t", goal: "g", behavior: ["b"], parts, questions: [] });
    expect(planProblems(plan([{ kind: "led", purpose: "red", color: "red" }, { kind: "button", purpose: "stop" }]), req)).toEqual([]);
  });

  it("an ordinal or 'one' picks one of several too; plain 'remove the X' / 'no X' still means none", () => {
    expect(a("remove the second button").fewer).toEqual({ button: 1 });
    expect(a("remove one of the LEDs").fewer).toEqual({ led: 1 });
    expect(a("take out the other knob").removed).toEqual([]); // "take out" isn't a negation word: nothing changes
    expect(a("remove the button").removed).toEqual(["button"]);
    expect(a("remove the button").fewer).toBeUndefined();
    expect(a("no buzzer, without a screen").removed.length).toBeGreaterThan(0);
  });

  it("a swap changes no count: 'instead of the red LED, use a blue one'", () => {
    const swap = a("instead of the red LED, use a blue one");
    expect(swap.removed).toEqual([]);
    expect(swap.fewer).toBeUndefined();
    expect(mergeRequirements(a("A red LED that turns on while I hold a button"), swap).parts.led).toEqual({ min: 1 });
  });

  it("taking away the last one of a kind leaves none asked for", () => {
    const req = mergeRequirements(a("A red LED that turns on while I hold a button"), a("remove the red LED"));
    expect(req.parts.led).toBeUndefined();
    expect(req.removed).toEqual([]);
  });
});

describe("slide switch words (M15): a phrase beats the single word inside it", () => {
  it.each([
    ["Turn the LED on and off with a slide switch", { "slide-switch": { min: 1 } }],
    ["Two slide switches set how fast an LED blinks", { "slide-switch": { min: 2, exact: 2 }, led: { min: 1 } }],
    ["A toggle switch turns the buzzer-free alarm lights on", { "slide-switch": { min: 1 } }],
    ["An on/off switch for the OLED screen", { "slide-switch": { min: 1 }, oled: { min: 1 } }],
    ["A slider switch picks fast or slow blinking", { "slide-switch": { min: 1 } }],
  ])("%s", (idea, parts) => {
    const r = a(idea);
    for (const [kind, need] of Object.entries(parts)) expect(r.parts[kind as never], kind).toMatchObject(need);
    expect(r.parts.button, "not also a button").toBeUndefined();
    expect(r.parts.pot, "not a slider potentiometer").toBeUndefined();
  });

  it("a plain switch is still the push button, and 'toggle' as a verb is no part", () => {
    expect(a("Press the switch to light the LED").parts.button).toEqual({ min: 1 });
    expect(a("Press the switch to light the LED").parts["slide-switch" as never]).toBeUndefined();
    expect(a("Toggle the LED every second").parts["slide-switch" as never]).toBeUndefined();
  });
});

describe("sound (M15): the passive buzzer plays tones; recorded sound and speech still need a speaker", () => {
  it.each([
    "Beep three times when the button is pressed",
    "Play a short melody when the timer ends",
    "A buzzer that buzzes when it gets too humid",
    "Make a sound every second",
    "Play the notes of a song on a piezo",
  ])("needs the buzzer, nothing refused: %s", (idea) => {
    const r = a(idea);
    expect(r.unsupported).toEqual([]);
    expect(r.parts.buzzer).toEqual({ min: 1 });
  });

  it.each(["Play my favourite song through a speaker", "Say the time out loud on headphones"])("a speaker is still unsupported: %s", (idea) => {
    expect(a(idea).unsupported).toEqual(["a speaker or headphones (for recorded sound or speech; the buzzer only plays tones)"]);
  });

  it("an alarm alone is asked about; with a sound word it is the buzzer; 'silent' or 'no buzzer' is none", () => {
    expect(a("An alarm with three LEDs").ambiguous).toContain(ALARM_SOUND_QUESTION);
    const beeping = a("An alarm that beeps when the button is pressed");
    expect(beeping.ambiguous).not.toContain(ALARM_SOUND_QUESTION);
    expect(beeping.parts.buzzer).toEqual({ min: 1 });
    expect(a("A silent timer that only blinks an LED, no sound").parts.buzzer).toBeUndefined();
    expect(a("Blink the LED, no buzzer").parts.buzzer).toBeUndefined();
  });

  it("listening for a sound is a microphone, not the buzzer", () => {
    const r = a("Light an LED when it hears a clap");
    expect(r.parts.buzzer).toBeUndefined();
  });
});
