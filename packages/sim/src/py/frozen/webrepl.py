# BreadPilot behaviour simulator: `webrepl` (frozen into the Pico 2 W firmware) does nothing without a network (M18 18.7b).
import _bpsim

_bpsim.emit("unsimulated", "webrepl")


def install(*args, **kwargs):
    raise OSError(-2)


def start(*args, **kwargs):
    pass


def stop(*args, **kwargs):
    pass
