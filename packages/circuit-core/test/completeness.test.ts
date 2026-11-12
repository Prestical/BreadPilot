// M8 8.5 "is it all used": code that passes every other check but only looks like it does the job.
// The cases come from real model answers in the M8 tests (08/11/2026).
import { describe, expect, it } from "vitest";
import { PICO_2_W } from "../src/board";
import { checkMicroPython } from "../src/codecheck";
import { layoutProject } from "../src/layout";

// LED on GP16, button on GP18, knob on GP26.
const build = layoutProject([{ kind: "led" }, { kind: "button" }, { kind: "pot" }]).build;
const HEAD = "from machine import Pin, ADC, PWM\nimport time\nled = Pin(16, Pin.OUT)\nbtn = Pin(18, Pin.IN, Pin.PULL_UP)\nknob = ADC(26)\n";
const LOOP = "while True:\n    led.value(btn.value() == 0)\n    print(knob.read_u16())\n    time.sleep(0.1)\n";
const run = (src: string, b = build) => checkMicroPython(src, b, PICO_2_W).issues;
const codes = (src: string, code: string, b = build) => run(src, b).filter((i) => i.code === code);

describe("the base program is clean", () => {
  it("passes without the new checks firing", () => {
    expect(run(HEAD + LOOP).filter((i) => ["C006", "C016", "C017"].includes(i.code))).toEqual([]);
  });
});

describe("C016: fake or unfinished code", () => {
  it("a fixed number marked as a placeholder (the local model's #15: temp = 25.0  # Placeholder)", () => {
    const found = codes(`${HEAD}temp = 25.0  # Placeholder: assume room temperature\n${LOOP}`, "C016");
    expect(found).toEqual([expect.objectContaining({ severity: "error", line: 6, message: expect.stringMatching(/^Line 6 sets temp to a fixed 25\.0 marked "Placeholder", so the program shows or uses a made-up value instead of doing the job\./) })]);
    for (const word of ["dummy value", "fake reading", "stub until the sensor works", "pretend it's warm", "mock"]) {
      expect(codes(`${HEAD}level = 42  # ${word}\n${LOOP}`, "C016"), word).toHaveLength(1);
    }
  });

  it("TODO / FIXME / not implemented notes, and functions that do nothing", () => {
    expect(codes(`${HEAD}# TODO: add the alarm sound\n${LOOP}`, "C016")[0]!.message).toMatch(/^Line 6 says "TODO", so this part of the program isn't finished/);
    expect(codes(`${HEAD}def alarm():\n    pass\n${LOOP}`, "C016")[0]!.message).toMatch(/^Line 6: the function alarm\(\) does nothing \(its body is only pass\)/);
    expect(codes(`${HEAD}def alarm(n):\n    raise NotImplementedError\n${LOOP}`, "C016")).toHaveLength(1);
    expect(codes(`${HEAD}def alarm():\n    ...\n${LOOP}`, "C016")).toHaveLength(1);
  });

  it("not flagged: real constants with ordinary comments, words inside strings, except: pass, functions with a body", () => {
    const fine = [
      "PRESSED = 0  # the button reads 0 when pressed (pull-up)",
      "DELAY = 0.5  # assume a half-second blink, as asked",
      'WIFI_SSID = "your-wifi-name"  # replace with your Wi-Fi name',
      'label = "placeholder text"',
      "try:\n    led.on()\nexcept OSError:\n    pass",
      "def alarm():\n    led.on()\n    pass",
      "GRAVITY = 1  # simulated gravity for the ball",
      "MAX_SCORE = 10  # hard-coded limit, as asked",
    ];
    for (const line of fine) expect(codes(`${HEAD}${line}\n${LOOP}`, "C016"), line).toEqual([]);
  });
});

describe("C017: input()", () => {
  it("an error when the build has buttons or knobs (the local model's #47 guessing game)", () => {
    const found = codes(`${HEAD}guess = int(input("Enter your guess (1-100): "))\n${LOOP}`, "C017");
    expect(found).toEqual([expect.objectContaining({ severity: "error", message: expect.stringMatching(/^Line 6 calls input\(\), which waits for someone to type on a computer over USB: on its own the Pico stops there forever\. Use the build's buttons or knobs/) })]);
  });

  it("a warning without any inputs (typing over USB may be the point); not flagged in comments, strings or other names", () => {
    const leds = layoutProject([{ kind: "led" }]).build;
    const src = "from machine import Pin\nimport time\nled = Pin(16, Pin.OUT)\nname = input('Your name: ')\nwhile True:\n    led.toggle()\n    time.sleep(0.5)\n";
    expect(codes(src, "C017", leds).map((i) => i.severity)).toEqual(["warning"]);
    expect(codes(`${HEAD}# input() is not used here\nmsg = "type input( here"\nmy_input(3)\n${LOOP}`.replace("my_input(3)", "def my_input(n):\n    return n\nmy_input(3)"), "C017")).toEqual([]);
  });
});

describe("C006: a part set up but never used again", () => {
  const unused = (src: string) => codes(src, "C006").filter((i) => /never uses/.test(i.message));

  it("a knob, a button or an LED that nothing uses, with how to use it", () => {
    const noKnob = HEAD + "while True:\n    led.value(btn.value() == 0)\n    time.sleep(0.1)\n";
    expect(unused(noKnob)).toEqual([expect.objectContaining({ severity: "error", line: 5, message: "Line 5 sets up knob (GP26), but the program never uses knob again, so that part does nothing. Read it with knob.read_u16() in the main loop." })]);
    const noButton = HEAD + "while True:\n    led.toggle()\n    print(knob.read_u16())\n    time.sleep(0.1)\n";
    expect(unused(noButton)[0]!.message).toMatch(/sets up btn \(GP18\).*Read it with btn\.value\(\)/);
    const noLed = HEAD + "while True:\n    print(btn.value(), knob.read_u16())\n    time.sleep(0.1)\n";
    expect(unused(noLed)[0]!.message).toMatch(/sets up led \(GP16\).*Switch it with led\.value\(1\) \/ led\.value\(0\)/);
  });

  it("not flagged: used in a function, a list, a callback; constants; ADC(0) = GP26; unwired pins like the on-board LED", () => {
    const fine = [
      HEAD + "def show():\n    led.value(btn.value() == 0)\n    print(knob.read_u16())\nwhile True:\n    show()\n    time.sleep(0.1)\n",
      HEAD + "parts = [led, btn, knob]\nwhile True:\n    print(parts)\n    time.sleep(0.1)\n",
      "from machine import Pin, ADC\nimport time\nKNOB_PIN = 26\nled = Pin(16, Pin.OUT)\nbtn = Pin(18, Pin.IN, Pin.PULL_UP)\nknob = ADC(KNOB_PIN)\nonboard = Pin(\"LED\", Pin.OUT)\nbtn.irq(lambda p: led.toggle())\nwhile True:\n    print(knob.read_u16())\n    time.sleep(0.1)\n",
      "from machine import Pin, ADC\nimport time\nled = Pin(16, Pin.OUT)\nbtn = Pin(18, Pin.IN, Pin.PULL_UP)\nknob = ADC(0)\nwhile True:\n    led.value(btn.value())\n    print(knob.read_u16())\n    time.sleep(0.1)\n",
    ];
    for (const src of fine) expect(unused(src)).toEqual([]);
    // ADC(0) is GP26: unused, it's still caught, and named by its GPIO
    expect(unused("from machine import Pin, ADC\nimport time\nled = Pin(16, Pin.OUT)\nbtn = Pin(18, Pin.IN, Pin.PULL_UP)\nknob = ADC(0)\nwhile True:\n    led.value(btn.value())\n    time.sleep(0.1)\n")[0]!.message).toMatch(/sets up knob \(GP26\)/);
  });
});

// M15 15.6: a small model put the functions its main loop calls below that endless loop (qwen #7).
describe("C019: functions defined after the endless loop that calls them", () => {
  const sensors = layoutProject([{ kind: "led" }, { kind: "dht11" }, { kind: "buzzer" }] as never).build;
  const QWEN_7 = "from machine import Pin, PWM\nimport dht\nimport time\n\n# Settings\nHUMIDITY_ALERT_THRESHOLD = 70\nHUMIDITY_DEACTIVATION_THRESHOLD = 10\nBLINK_DELAY = 0.5\nMEASURE_INTERVAL = 2\n\n# Set up the parts\nled_red = Pin(16, Pin.OUT)\nbuzzer_pin = Pin(20, Pin.OUT)\ndht_sensor = dht.DHT11(Pin(18))\n\n# Main loop\nwhile True:\n    # Wait 1 second after start, then measure every 2 seconds\n    if time.ticks_diff(time.ticks_ms(), time.ticks_ms()) < 1000:\n        time.sleep(1)\n    else:\n        try:\n            dht_sensor.measure()\n            humidity = dht_sensor.humidity()\n            print(f\"Humidity: {humidity}%\")\n        except OSError:\n            print(\"DHT11 reading failed, retrying...\")\n            continue\n\n        # Check if humidity is above 70%\n        if humidity > HUMIDITY_ALERT_THRESHOLD:\n            led_red.value(1)\n            buzzer_on()\n            print(\"ALERT: Humidity too high!\")\n        # Check if humidity drops below 10%\n        elif humidity < HUMIDITY_DEACTIVATION_THRESHOLD:\n            led_red.value(0)\n            buzzer_off()\n            print(\"Normal: Humidity low again.\")\n\n    time.sleep(MEASURE_INTERVAL)\n\n# Function to turn on buzzer with a note (A4 = 440 Hz)\ndef buzzer_on():\n    buzzer_pin.init(Pin.OUT)\n    pwm = PWM(buzzer_pin)\n    pwm.freq(440)\n    pwm.duty_u16(32768)\n    time.sleep(0.5)\n    pwm.deinit()\n    buzzer_pin.value(1)\n\n# Function to turn off buzzer\ndef buzzer_off():\n    buzzer_pin.value(1)";

  it("catches the real case: buzzer_on and buzzer_off come after while True", () => {
    const found = codes(QWEN_7, "C019", sensors);
    expect(found.map((i) => /defines (\w+)\(\)/.exec(i.message)![1])).toEqual(["buzzer_on", "buzzer_off"]);
    expect(found[0]!.message).toMatch(/after the endless loop on line \d+, so the loop runs before Python ever reaches that line/);
  });

  it("stays quiet when the functions come first, when the loop can end, or when the loop doesn't call them", () => {
    const fn = "def show():\n    print(knob.read_u16())\n";
    expect(codes(HEAD + fn + "while True:\n    led.value(btn.value() == 0)\n    show()\n    time.sleep(0.1)\n", "C019")).toEqual([]);
    expect(codes(HEAD + "while True:\n    led.value(btn.value() == 0)\n    if btn.value() == 0:\n        break\n    show()\n    time.sleep(0.1)\n" + fn, "C019")).toEqual([]);
    expect(codes(HEAD + LOOP + fn, "C019")).toEqual([]);
    // A call inside a function defined before the loop isn't the loop calling it: only the loop's own lines count.
    expect(codes(HEAD + LOOP, "C019")).toEqual([]);
  });
});
