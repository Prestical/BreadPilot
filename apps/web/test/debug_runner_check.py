# Runs the Pico debug runner (src/pico/debug_main.py) under CPython with stand-ins for MicroPython's
# machine module, sys.print_exception and the sh1106 driver, once per scenario, and prints what the
# LED, error.txt and the display did as JSON. Used by debugRunner.test.ts.
# Usage: python3 debug_runner_check.py <debug_main.py> <scenarios.json> <work dir>
import json
import os
import sys
import time
import traceback
import types

runner_path, scenarios_path, work = sys.argv[1:4]
runner = open(runner_path).read()
scenarios = json.load(open(scenarios_path))


class Stop(KeyboardInterrupt):
    """Ends a scenario (like pressing Stop): the runner hands it back, as it must."""


def run(app, max_sleeps):
    events = []
    timers = []
    shown = []

    class Pin:
        OUT = 1

        def __init__(self, name, mode=None):
            assert name == "LED"

        def on(self):
            events.append(1)

        def off(self):
            events.append(0)

    class Timer:
        PERIODIC = 1

        def __init__(self, period, mode, callback):
            self.callback = callback
            self.alive = True
            timers.append(self)

        def deinit(self):
            self.alive = False

    machine = types.ModuleType("machine")
    machine.Pin, machine.Timer = Pin, Timer
    sh1106 = types.ModuleType("sh1106")

    class SH1106_I2C:
        def __init__(self, w, h, i2c):
            self.rows = []

        def fill(self, c):
            self.rows = []

        def text(self, s, x, y):
            self.rows.append(s)

        def show(self):
            shown.append(list(self.rows))

    sh1106.SH1106_I2C = SH1106_I2C
    sys.modules["machine"], sys.modules["sh1106"] = machine, sh1106
    sys.modules["network"] = types.ModuleType("network")

    sleeps = []
    real_sleep = time.sleep

    def fake_sleep(s):
        sleeps.append(s)
        # A beat from the heartbeat timer while the program runs (as the real Timer would)
        if timers and timers[0].alive:
            timers[0].callback(timers[0])
        if len(sleeps) >= max_sleeps:
            raise Stop()

    time.sleep = fake_sleep
    sys.print_exception = lambda e, f: traceback.print_exception(type(e), e, e.__traceback__, file=f)

    for name in ("app.py", "error.txt"):
        if os.path.exists(name):
            os.remove(name)
    if app is not None:
        with open("app.py", "w") as f:
            f.write(app)
    stopped = False
    try:
        exec(compile(runner, "main.py", "exec"), {"__name__": "__main__"})
    except Stop:
        stopped = True
    finally:
        time.sleep = real_sleep
    error = open("error.txt").read() if os.path.exists("error.txt") else None
    return {
        "events": events,
        "sleeps": sleeps,
        "timer": bool(timers),
        "timerStopped": bool(timers) and not timers[0].alive,
        "stopped": stopped,
        "error": error,
        "shown": shown,
    }


os.chdir(work)
out = {}
for name, s in scenarios.items():
    out[name] = run(s.get("app"), s.get("maxSleeps", 40))
print(json.dumps(out))
