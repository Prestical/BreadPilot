# BreadPilot behaviour simulator: `network` (the Pico 2 W's built-in Wi-Fi module) as a Pico that never
# gets a connection (M18 18.7b). Wi-Fi isn't simulated: the program can set it up and wait, the trace
# says "unsimulated", and nothing ever connects. Names follow MicroPython's network/CYW43 docs.
import _bpsim

_bpsim.emit("unsimulated", "network (Wi-Fi)")

STA_IF = 0
AP_IF = 1
STAT_IDLE = 0
STAT_CONNECTING = 1
STAT_WRONG_PASSWORD = -3
STAT_NO_AP_FOUND = -2
STAT_CONNECT_FAIL = -1
STAT_GOT_IP = 3


class WLAN:
    PM_NONE = 0
    PM_PERFORMANCE = 1
    PM_POWERSAVE = 2

    def __init__(self, interface=STA_IF):
        self._active = False

    def active(self, on=None):
        if on is None:
            return self._active
        self._active = bool(on)

    def connect(self, ssid=None, key=None, **kwargs):
        pass

    def disconnect(self):
        pass

    def isconnected(self):
        return False

    def status(self, param=None):
        if param == "rssi":
            return -100
        return STAT_CONNECTING if self._active else STAT_IDLE

    def scan(self):
        return []

    def ifconfig(self, config=None):
        return ("0.0.0.0", "0.0.0.0", "0.0.0.0", "0.0.0.0")

    def ipconfig(self, *args, **kwargs):
        return "0.0.0.0" if args else None

    def config(self, *args, **kwargs):
        return None


def hostname(name=None):
    return "PicoW" if name is None else None


def country(code=None):
    return "XX" if code is None else None


def ipconfig(*args, **kwargs):
    return None
