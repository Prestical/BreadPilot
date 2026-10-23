# BreadPilot debug runner, added by "Build for Pico". Your program is app.py: this file
# runs it and shows what is happening on the Pico's green LED (next to the USB port).
#   one long flash (1 s)          the Pico started your program
#   short blink every 2 seconds   your program is running
#   LED stays on                  your program finished (it has no main loop)
#   3 blinks, pause, repeating    a part doesn't answer: check its wiring
#   fast blinking, no pause       your program stopped with an error in the code
# The error is also printed on the USB serial console, saved in error.txt and, when the
# project has the OLED display, shown on the screen.
import io
import os
import sys
import time
from machine import Pin, Timer

APP = "app.py"
# OSError numbers from an I2C part that doesn't answer: EIO (no reply), ENODEV (no device)
PART_ERRNOS = (5, 19)

led = Pin("LED", Pin.OUT)
tick = 0


def beat(t):
    # Runs every 100 ms: LED on for one tick out of 20 (a short blink every 2 seconds)
    global tick
    if tick == 0:
        led.on()
    elif tick == 1:
        led.off()
    tick = (tick + 1) % 20


def error_line(text):
    # The last "line N" of the traceback that points into app.py's code
    line = None
    for row in text.splitlines():
        at = row.find(", line ")
        if at >= 0 and "<string>" in row:
            digits = ""
            for ch in row[at + 7:]:
                if not ch.isdigit():
                    break
                digits += ch
            if digits:
                line = int(digits)
    return line


def screen_lines(part, line, err):
    if part:
        lines = ["PART NOT FOUND", "Check wiring"]
    else:
        lines = ["CODE ERROR"]
    if line:
        lines.append("app.py line " + str(line))
    lines.append(type(err).__name__)
    msg = str(err)
    while msg and len(lines) < 8:
        lines.append(msg[:16])
        msg = msg[16:]
    return lines


def show_on_screen(lines, names):
    # Uses the program's own display object, if it made one and it still answers
    try:
        from sh1106 import SH1106_I2C
    except ImportError:
        return
    for value in names.values():
        if isinstance(value, SH1106_I2C):
            try:
                value.fill(0)
                for i, text in enumerate(lines[:8]):
                    value.text(text[:16], 0, i * 8)
                value.show()
            except Exception:
                pass
            return


def save_error(text):
    try:
        with open("error.txt", "w") as f:
            f.write(text)
    except OSError:
        pass


def blink_forever(part):
    while True:
        if part:
            for _ in range(3):
                led.on()
                time.sleep(0.2)
                led.off()
                time.sleep(0.2)
            time.sleep(1.2)
        else:
            led.on()
            time.sleep(0.08)
            led.off()
            time.sleep(0.08)


def main():
    try:
        with open(APP) as f:
            src = f.read()
    except OSError:
        print("No " + APP + " on the Pico.")
        blink_forever(False)
    try:
        os.remove("error.txt")
    except OSError:
        pass
    # A program that uses the LED itself keeps it: no heartbeat, only the error blinks
    uses_led = '"LED"' in src or "'LED'" in src
    led.on()
    time.sleep(1)
    led.off()
    timer = None if uses_led else Timer(period=100, mode=Timer.PERIODIC, callback=beat)
    names = {"__name__": "__main__", "__file__": APP}
    try:
        exec(src, names)
    except KeyboardInterrupt:
        # Stopped from the computer (e.g. Thonny's Stop button): hand control back
        if timer:
            timer.deinit()
        led.off()
        raise
    except SystemExit:
        if timer:
            timer.deinit()
        led.on()
        return
    except BaseException as err:
        if timer:
            timer.deinit()
        buf = io.StringIO()
        sys.print_exception(err, buf)
        text = buf.getvalue()
        print(text)
        line = error_line(text)
        part = isinstance(err, OSError) and bool(err.args) and err.args[0] in PART_ERRNOS
        save_error(text)
        show_on_screen(screen_lines(part, line, err), names)
        blink_forever(part)
    if timer:
        timer.deinit()
    led.on()


main()
