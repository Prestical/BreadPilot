# BreadPilot behaviour simulator: the `time` module on a virtual clock (M18 18.7b).
# Exactly the names of the Pico 2 W's `time` (MicroPython v1.29.0, rp2): see MICROPYTHON_API.
# The run puts this module in sys.modules as "time" and "utime". sleep() moves the virtual clock, so
# a 5-minute wait takes no real time. time() starts at 2021-01-01 00:00:00, as on a Pico whose clock
# wasn't set by a computer.

import _bpsim as _s

_real = __import__("time")  # the built-in module (its gmtime/mktime do the calendar)
_EPOCH = 1609459200  # 2021-01-01 00:00:00
_PERIOD = 1 << 30  # MicroPython's ticks wrap here
_HALF = _PERIOD >> 1


def sleep(seconds):
    _s.advance(seconds * 1_000_000)


def sleep_ms(ms):
    _s.advance(ms * 1000)


def sleep_us(us):
    _s.advance(us)


def ticks_ms():
    _s.tick()
    return (_s.now_us // 1000) & (_PERIOD - 1)


def ticks_us():
    _s.tick()
    return _s.now_us & (_PERIOD - 1)


def ticks_cpu():
    _s.tick()
    return (_s.now_us * 150) & (_PERIOD - 1)  # 150 MHz


def ticks_add(ticks, delta):
    return (ticks + delta) & (_PERIOD - 1)


def ticks_diff(ticks1, ticks2):
    return ((ticks1 - ticks2 + _HALF) & (_PERIOD - 1)) - _HALF


def time():
    _s.tick()
    return _EPOCH + _s.now_us // 1_000_000


def time_ns():
    _s.tick()
    return (_EPOCH * 1_000_000 + _s.now_us) * 1000


def gmtime(secs=None):
    return _real.gmtime(time() if secs is None else secs)


def localtime(secs=None):
    return _real.localtime(time() if secs is None else secs)


def mktime(t):
    return _real.mktime(t)
