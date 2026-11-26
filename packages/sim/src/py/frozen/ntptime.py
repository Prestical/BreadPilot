# BreadPilot behaviour simulator: `ntptime` (frozen into the Pico 2 W firmware) with no network:
# asking the time server fails with OSError, as without a Wi-Fi connection (M18 18.7b).
import _bpsim

_bpsim.emit("unsimulated", "ntptime")
host = "pool.ntp.org"
timeout = 1


def time():
    raise OSError(-2)


def settime():
    raise OSError(-2)
