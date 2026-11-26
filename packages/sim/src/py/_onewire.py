# BreadPilot behaviour simulator: the built-in `_onewire` module of the Pico 2 W firmware (M18 18.7d).
# The firmware's own onewire.py and ds18x20.py (frozen, in py/frozen) run on it unchanged; the
# devices on each line (DS18B20s wired to that GPIO, powered and pulled up) answer in the host.
import _bpsim as _s
import _bphost as _host


def _g(pin):
    return pin._gpio


def reset(pin):
    _s.tick()
    return bool(_host.ow_reset(_g(pin), _s.now_us))


def readbit(pin):
    _s.tick()
    return _host.ow_readbit(_g(pin), _s.now_us)


def readbyte(pin):
    _s.tick()
    return _host.ow_readbyte(_g(pin), _s.now_us)


def writebit(pin, value):
    _s.tick()
    _host.ow_writebit(_g(pin), 1 if value else 0, _s.now_us)


def writebyte(pin, value):
    _s.tick()
    _host.ow_writebyte(_g(pin), value & 0xFF, _s.now_us)


def crc8(data):
    crc = 0
    for b in data:
        for _ in range(8):
            mix = (crc ^ b) & 1
            crc >>= 1
            if mix:
                crc ^= 0x8C
            b >>= 1
    return crc
