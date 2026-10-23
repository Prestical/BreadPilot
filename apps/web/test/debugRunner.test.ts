// The Pico debug runner (src/pico/debug_main.py), run under CPython with stand-ins for MicroPython's
// machine module and the sh1106 driver (debug_runner_check.py): the LED patterns, error.txt and the
// error on the display, per kind of program.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { picoFiles } from "../src/pico/build";

interface Result {
  events: number[];
  sleeps: number[];
  timer: boolean;
  timerStopped: boolean;
  stopped: boolean;
  error: string | null;
  shown: string[][];
}

const RUNNER = new URL("../src/pico/debug_main.py", import.meta.url).pathname;
const python = spawnSync("python3", ["--version"]).status === 0;

function runScenarios(scenarios: Record<string, { app: string | null; maxSleeps?: number }>): Record<string, Result> {
  const dir = mkdtempSync(join(tmpdir(), "breadpilot-runner-"));
  try {
    writeFileSync(join(dir, "scenarios.json"), JSON.stringify(scenarios));
    const work = join(dir, "pico");
    spawnSync("mkdir", [work]);
    const r = spawnSync("python3", ["-I", new URL("./debug_runner_check.py", import.meta.url).pathname, RUNNER, join(dir, "scenarios.json"), work], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return JSON.parse(r.stdout.trim().split("\n").at(-1)!) as Record<string, Result>;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const FAST = [0.08, 0.08];
const PART = [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 1.2];
/** The sleeps after the 1 s start flash, from the first blink of the error pattern. */
const blinkSleeps = (r: Result) => r.sleeps.slice(1);

describe("Build for Pico: the files on the Pico", () => {
  it("runs the project's code as app.py under the debug runner (main.py), drivers next to it", () => {
    const files = picoFiles("print('hi')\n", [{ name: "sh1106.py", content: "# driver\n" }]);
    expect(files.map((f) => f.name)).toEqual(["main.py", "app.py", "sh1106.py"]);
    expect(files[0]!.content).toBe(readFileSync(RUNNER, "utf8"));
    expect(files[1]!.content).toBe("print('hi')\n");
  });

  it("the runner is plain ASCII (MicroPython reads it as UTF-8, the comments stay safe on any editor)", () => {
    expect(/^[\x00-\x7f]*$/.test(readFileSync(RUNNER, "utf8"))).toBe(true);
  });
});

describe.skipIf(!python)("Pico debug runner (CPython with MicroPython stand-ins)", () => {
  const r = runScenarios({
    finishes: { app: "x = 1\n" },
    running: { app: "import time\nwhile True:\n    time.sleep(0.1)\n", maxSleeps: 45 },
    nameError: { app: "import network\n\nnets = wlan.scan()\n" },
    partError: { app: "from sh1106 import SH1106_I2C\noled = SH1106_I2C(128, 64, None)\nraise OSError(5)\n" },
    codeErrorOled: { app: "from sh1106 import SH1106_I2C\noled = SH1106_I2C(128, 64, None)\noled.text(1 + 'a', 0, 0)\n" },
    usesLed: { app: 'from machine import Pin\nimport time\nled = Pin("LED", Pin.OUT)\nwhile True:\n    time.sleep(1)\n', maxSleeps: 5 },
    syntaxError: { app: "while True\n    pass\n" },
    noApp: { app: null },
    exits: { app: "import sys\nsys.exit()\n" },
    mainGuard: { app: 'if __name__ == "__main__":\n    raise ValueError("ran as the main program")\n' },
  });

  it("start: one long flash; a program that ends leaves the LED on", () => {
    expect(r.finishes!.sleeps[0]).toBe(1);
    expect(r.finishes!.events).toEqual([1, 0, 1]);
    expect(r.finishes!.timerStopped).toBe(true);
    expect(r.finishes!.error).toBeNull();
    expect(r.exits!.events.at(-1)).toBe(1);
    expect(r.exits!.error).toBeNull();
  });

  it("running: a short blink every 20 ticks of 100 ms (2 s); Stop hands control back with the LED off", () => {
    const res = r.running!;
    expect(res.timer).toBe(true);
    // Start flash, then beats at ticks 0/1, 20/21, 40/41 (44 beats before Stop), then off on Stop.
    expect(res.events).toEqual([1, 0, 1, 0, 1, 0, 1, 0, 0]);
    expect(res.stopped).toBe(true);
    expect(res.timerStopped).toBe(true);
    expect(res.error).toBeNull();
  });

  it("a code error: fast blinking, error.txt with the app.py line, heartbeat stopped", () => {
    const res = r.nameError!;
    expect(blinkSleeps(res).slice(0, 4)).toEqual([...FAST, ...FAST]);
    expect(res.error).toMatch(/line 3/);
    expect(res.error).toMatch(/NameError: name 'wlan' is not defined/);
    expect(res.timerStopped).toBe(true);
    expect(res.shown).toEqual([]); // no display in this program
  });

  it("a part that doesn't answer (OSError EIO): 3 blinks + pause, and the display says to check the wiring", () => {
    const res = r.partError!;
    expect(blinkSleeps(res).slice(0, 7)).toEqual(PART);
    expect(res.shown.at(-1)).toEqual(["PART NOT FOUND", "Check wiring", "app.py line 3", "OSError", "5"]);
  });

  it("a code error with a display: the screen shows the error and the line", () => {
    const shown = r.codeErrorOled!.shown.at(-1)!;
    expect(shown.slice(0, 3)).toEqual(["CODE ERROR", "app.py line 3", "TypeError"]);
    expect(shown.slice(3).every((s) => s.length <= 16)).toBe(true);
    expect(blinkSleeps(r.codeErrorOled!).slice(0, 2)).toEqual(FAST);
  });

  it("a program that uses the LED itself gets no heartbeat", () => {
    expect(r.usesLed!.timer).toBe(false);
    expect(r.usesLed!.events).toEqual([1, 0, 0]); // start flash, then off on Stop
  });

  it("a syntax error is a code error at its line", () => {
    expect(r.syntaxError!.error).toMatch(/line 1/);
    expect(r.syntaxError!.error).toMatch(/SyntaxError/);
    expect(blinkSleeps(r.syntaxError!).slice(0, 2)).toEqual(FAST);
  });

  it("no app.py: fast blinking; the program runs as __main__", () => {
    expect(r.noApp!.sleeps.slice(0, 2)).toEqual(FAST);
    expect(r.noApp!.error).toBeNull();
    expect(r.mainGuard!.error).toMatch(/ValueError: ran as the main program/);
  });
});
