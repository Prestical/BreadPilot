# BreadPilot behaviour simulator: the core inside MicroPython (M18 18.7b).
# The virtual clock, the event trace, timers and pin interrupts. The host (_bphost, JavaScript) records
# events and answers what inputs read; the simulated parts come from the circuit (18.7c).

import _bphost as host


class SimEnd(BaseException):
    """Ends a run (time limit, reset, deep sleep). A BaseException, so `except Exception:` in the
    program can't swallow it."""


now_us = 0
limit_us = 30_000_000
# Each time query takes a little time, so a loop that waits by polling ticks_ms() moves forward.
QUERY_US = 5

# Timers: [due_us, period_us (0 = one shot), callback, timer object]
timers = []
# Pin interrupts: gpio -> [handler, trigger, pin object, last level]
irqs = {}
# True while a timer or interrupt callback runs: time it spends sleeping doesn't start more callbacks.
_in_callback = False


# A loop that keeps reading the same values with no output change in between (busy-waiting for a
# button, a polling loop without sleep) moves the clock ahead by at most JUMP_US at a time, or to the
# next scenario change if that is sooner: nothing it reads can differ in between, and simulating every
# few microseconds of it would take far longer than the run allows.
SAME_READS = 256
JUMP_US = 25_000
_last = {}
_streak = 0


def emit(kind, a=0, b=0, c=0):
    global _streak
    _streak = 0
    host.emit(now_us, kind, a, b, c)


def idle_read(key, value):
    global _streak
    if _last.get(key) == value:
        _streak += 1
    else:
        _last[key] = value
        _streak = 0
    if _streak >= SAME_READS and not _in_callback:
        _streak = 0
        edge = host.next_edge(now_us, now_us + JUMP_US)
        advance((edge if edge >= 0 else now_us + JUMP_US) - now_us)


def _due():
    best = -1
    for t in timers:
        if best < 0 or t[0] < best:
            best = t[0]
    return best


def _call(cb, arg):
    global _in_callback
    _in_callback = True
    try:
        cb(arg)
    finally:
        _in_callback = False


def _fire_timers():
    for t in list(timers):
        if t[0] <= now_us and t in timers:
            cb = t[2]
            if t[1] > 0:
                t[0] += t[1]
            else:
                timers.remove(t)
            if cb is not None:
                _call(cb, t[3])


def _fire_irqs():
    for gpio, entry in list(irqs.items()):
        handler, trigger, pin, last = entry
        level = pin._level()  # without a time query: reading here must not move the clock
        if level != last:
            entry[3] = level
            rising = level == 1
            if handler is not None and ((rising and trigger & 8) or (not rising and trigger & 4)):
                _call(handler, pin)


def advance(us):
    """Moves the clock forward, running timers and pin interrupts that fall due on the way."""
    global now_us
    target = now_us + max(0, int(us))
    if _in_callback:  # a callback that sleeps: time passes, no callbacks start inside it
        if target > limit_us:
            now_us = limit_us
            raise SimEnd("time limit")
        now_us = target
        if host.time(now_us):
            raise SimEnd("stopped")
        return
    while True:
        due = _due()
        edge = host.next_edge(now_us, target) if irqs else -1
        nxt = target
        if 0 <= due < nxt:
            nxt = due
        if 0 <= edge < nxt:
            nxt = edge
        if nxt > limit_us:
            now_us = limit_us
            raise SimEnd("time limit")
        now_us = nxt
        if irqs:
            _fire_irqs()
        if timers:
            _fire_timers()
        if now_us >= target:
            break
    # A live run (the preview) waits here for real time; the page may have asked it to stop.
    if host.time(now_us):
        raise SimEnd("stopped")


def tick():
    """A time query: a few microseconds pass."""
    advance(QUERY_US)
