# BreadPilot behaviour simulator: the `machine` module of the Pico 2 W (M18 18.7b).
# Public names are exactly the firmware's (MICROPYTHON_API, generated from MicroPython v1.29.0's rp2
# source; a test compares them), so a call to something the Pico doesn't have (PWM.duty(), ADC.read(),
# machine.DAC) fails here as on the board. What a pin reads and what an output does is asked from or
# told to the host; the circuit decides (18.7c). Classes the simulator doesn't model (UART, SPI, I2S,
# ...) exist and accept calls, and say so once in the trace ("unsimulated").

import _bpsim as _s
import _bphost as _host

PWRON_RESET = 1
WDT_RESET = 3

_noted = set()


def _unsimulated(what):
    if what not in _noted:
        _noted.add(what)
        _s.emit("unsimulated", what)


def _hex(b):
    return "".join("%02x" % x for x in b)


def _gpio(id):
    """GPIO number of a pin id (an int, "GPn", or "LED" = the wireless chip's LED pin, -1)."""
    if isinstance(id, Pin):
        return id._gpio
    if isinstance(id, int):
        if 0 <= id <= 29:
            return id
        raise ValueError("invalid pin")
    if isinstance(id, str):
        if id in ("LED", "WL_GPIO0"):
            return -1
        if id.startswith("GP") and id[2:].isdigit() and int(id[2:]) <= 29:
            return int(id[2:])
    raise ValueError("unknown named pin \"%s\"" % (id,))


# ---------------- Pin ----------------


class _Names:
    """Pin.board / Pin.cpu: pins by name (Pin.board.GP16, Pin.board.LED)."""

    def __getattr__(self, name):
        return Pin(name)


class Pin:
    IN = 0
    OUT = 1
    OPEN_DRAIN = 2
    ALT = 3
    PULL_UP = 1
    PULL_DOWN = 2
    IRQ_FALLING = 4
    IRQ_RISING = 8
    ALT_SPI = 1
    ALT_UART = 2
    ALT_I2C = 3
    ALT_PWM = 4
    ALT_SIO = 5
    ALT_PIO0 = 6
    ALT_PIO1 = 7
    ALT_PIO2 = 8
    ALT_GPCK = 9
    ALT_USB = 10
    ALT_HSTX = 0
    ALT_XIP_CS1 = 11
    ALT_CORESIGHT_TRACE = 12
    ALT_UART_AUX = 13
    board = _Names()
    cpu = _Names()

    def __init__(self, id, mode=-1, pull=-1, *, value=None, alt=-1):
        self._gpio = _gpio(id)
        self._mode = -1
        self._pull = 0
        self._out = 0
        self._said = False
        self.init(mode, pull, value=value, alt=alt)

    def init(self, mode=-1, pull=-1, *, value=None, alt=-1):
        if mode != -1:
            self._mode = mode
        if pull != -1:
            self._pull = pull or 0
        if value is not None:
            self._out = 1 if value else 0
        if mode != -1 or pull != -1:
            _s.emit("mode", self._gpio, self._mode, self._pull)
        if value is not None or (mode == Pin.OUT and self._mode == Pin.OUT):
            self._said = True
            _s.emit("out", self._gpio, self._out)

    def value(self, v=None):
        if v is None:
            if self._mode == Pin.OUT:
                return self._out  # an output reads back the level it drives
            _s.tick()
            r = _host.pin_in(self._gpio, _s.now_us, self._pull)
            r = self._out if r < 0 else r
            _s.idle_read(self._gpio, r)
            return r
        level = 1 if v else 0
        # Writing the level a pin already has changes nothing on the board: no event (a busy loop
        # writing the same level stays a quiet loop the clock can move past).
        if level != self._out or not self._said:
            self._out = level
            self._said = True
            _s.emit("out", self._gpio, self._out)
        return None

    def _level(self):
        """The level now, without a time query (for the interrupt check)."""
        if self._mode == Pin.OUT:
            return self._out
        r = _host.pin_in(self._gpio, _s.now_us, self._pull)
        return self._out if r < 0 else r

    def __call__(self, v=None):
        return self.value(v)

    def on(self):
        self.value(1)

    def off(self):
        self.value(0)

    def high(self):
        self.value(1)

    def low(self):
        self.value(0)

    def toggle(self):
        self.value(0 if self._out else 1)

    def irq(self, handler=None, trigger=IRQ_FALLING | IRQ_RISING, hard=False):
        if handler is None:
            _s.irqs.pop(self._gpio, None)
        else:
            _s.irqs[self._gpio] = [handler, trigger, self, self._level()]
            _s.emit("irq", self._gpio, trigger)
        return self

    def __repr__(self):
        return "Pin(GPIO%d)" % self._gpio if self._gpio >= 0 else "Pin(LED)"


# ---------------- PWM ----------------


class PWM:
    def __init__(self, dest, *, freq=None, duty_u16=None, duty_ns=None, invert=False):
        self._gpio = _gpio(dest)
        self._freq = 0
        self._duty = 0
        self._invert = bool(invert)
        self.init(freq=freq, duty_u16=duty_u16, duty_ns=duty_ns, invert=invert)

    def init(self, *, freq=None, duty_u16=None, duty_ns=None, invert=None):
        if freq is not None:
            self._freq = int(freq)
        if duty_u16 is not None:
            self._duty = max(0, min(65535, int(duty_u16)))
        if duty_ns is not None:
            self._set_ns(duty_ns)
        if invert is not None:
            self._invert = bool(invert)
        self._emit()

    def _set_ns(self, ns):
        period = 1_000_000_000 // self._freq if self._freq else 0
        self._duty = max(0, min(65535, int(ns) * 65535 // period)) if period else 0

    def _emit(self):
        duty = 65535 - self._duty if self._invert else self._duty
        if (self._freq, duty) != getattr(self, "_last", None):  # an unchanged setting is no change
            self._last = (self._freq, duty)
            _s.emit("pwm", self._gpio, self._freq, duty)

    def deinit(self):
        self._duty = 0
        _s.emit("pwm", self._gpio, 0, -1)

    def freq(self, f=None):
        if f is None:
            return self._freq
        self._freq = int(f)
        self._emit()

    def duty_u16(self, d=None):
        if d is None:
            return self._duty
        self._duty = max(0, min(65535, int(d)))
        self._emit()

    def duty_ns(self, ns=None):
        if ns is None:
            return self._duty * (1_000_000_000 // self._freq) // 65535 if self._freq else 0
        self._set_ns(ns)
        self._emit()


# ---------------- ADC ----------------


class ADC:
    CORE_TEMP = 4

    def __init__(self, pin):
        g = pin._gpio if isinstance(pin, Pin) else pin
        if isinstance(g, int) and 0 <= g <= 4:
            self._ch = g
        elif isinstance(g, int) and 26 <= g <= 29:
            self._ch = g - 26
        else:
            raise ValueError("Pin doesn't have ADC capabilities")

    def read_u16(self):
        _s.tick()
        volts = _host.adc(self._ch, _s.now_us)
        raw = max(0, min(4095, int(volts / 3.3 * 4096)))
        _s.idle_read(100 + self._ch, raw)
        return (raw << 4) | (raw >> 8)


# ---------------- I2C ----------------


class I2C:
    def __init__(self, id=-1, *, scl=None, sda=None, freq=400_000, timeout=50_000):
        self._bus = id
        self._scl = _gpio(scl) if scl is not None else -1
        self._sda = _gpio(sda) if sda is not None else -1
        _s.emit("i2c", id, self._sda, self._scl)

    def init(self, *, scl=None, sda=None, freq=400_000, timeout=50_000):
        pass

    def deinit(self):
        pass

    def scan(self):
        _s.tick()
        found = _host.i2c_scan(self._sda, self._scl, _s.now_us)
        return [found[i] for i in range(len(found))]

    def _xfer(self, addr, write, nread):
        # The bytes cross to the host as hex text; the chip on this bus (SDA/SCL pins) answers.
        _s.tick()
        r = _host.i2c(self._sda, self._scl, addr, _hex(bytes(write)), nread, _s.now_us)
        if r is None or (isinstance(r, int) and r < 0):
            raise OSError(5)  # EIO: no device answered at this address
        return bytes([r[i] for i in range(len(r))])

    def writeto(self, addr, buf, stop=True):
        self._xfer(addr, buf, 0)
        return len(buf)

    def writevto(self, addr, vector, stop=True):
        data = b"".join(bytes(v) for v in vector)
        self._xfer(addr, data, 0)
        return len(data)

    def readfrom(self, addr, nbytes, stop=True):
        return self._xfer(addr, b"", nbytes)

    def readfrom_into(self, addr, buf, stop=True):
        data = self._xfer(addr, b"", len(buf))
        for i in range(len(buf)):
            buf[i] = data[i]

    def writeto_mem(self, addr, memaddr, buf, *, addrsize=8):
        self._xfer(addr, bytes([memaddr]) + bytes(buf), 0)

    def readfrom_mem(self, addr, memaddr, nbytes, *, addrsize=8):
        self._xfer(addr, bytes([memaddr]), 0)
        return self._xfer(addr, b"", nbytes)

    def readfrom_mem_into(self, addr, memaddr, buf, *, addrsize=8):
        data = self.readfrom_mem(addr, memaddr, len(buf))
        for i in range(len(buf)):
            buf[i] = data[i]

    # Primitive operations (SoftI2C-style); not modelled bit by bit.
    def start(self):
        _unsimulated("I2C.start")

    def stop(self):
        _unsimulated("I2C.stop")

    def readinto(self, buf, nack=True):
        _unsimulated("I2C.readinto")

    def write(self, buf):
        _unsimulated("I2C.write")
        return 0


class SoftI2C(I2C):
    def __init__(self, scl, sda, *, freq=400_000, timeout=50_000):
        super().__init__(-1, scl=scl, sda=sda, freq=freq, timeout=timeout)


# ---------------- Timer ----------------


class Timer:
    ONE_SHOT = 0
    PERIODIC = 1

    def __init__(self, id=-1, *, mode=PERIODIC, period=-1, tick_hz=1000, freq=-1, callback=None, hard=True):
        self._entry = None
        if callback is not None:
            self.init(mode=mode, period=period, tick_hz=tick_hz, freq=freq, callback=callback, hard=hard)

    def init(self, *, mode=PERIODIC, period=-1, tick_hz=1000, freq=-1, callback=None, hard=True):
        self.deinit()
        if freq > 0:
            us = int(1_000_000 / freq)
        else:
            us = int(period * 1_000_000 / tick_hz) if period >= 0 else 1_000_000
        us = max(1, us)
        self._entry = [_s.now_us + us, us if mode == Timer.PERIODIC else 0, callback, self]
        _s.timers.append(self._entry)
        _s.emit("timer", us, mode)

    def deinit(self):
        if self._entry is not None and self._entry in _s.timers:
            _s.timers.remove(self._entry)
        self._entry = None

    def __del__(self):
        self.deinit()


# ---------------- Not modelled: they exist, accept calls and say so ----------------


class _Unsimulated:
    _what = "?"

    def __init__(self, *args, **kwargs):
        _unsimulated(self._what)

    def __getattr__(self, name):
        _unsimulated(self._what)
        return lambda *args, **kwargs: None


class Signal(_Unsimulated):
    _what = "Signal"


class SoftSPI(_Unsimulated):
    _what = "SoftSPI"


class SPI(_Unsimulated):
    _what = "SPI"


class UART(_Unsimulated):
    _what = "UART"


class I2S(_Unsimulated):
    _what = "I2S"


class I2CTarget(_Unsimulated):
    _what = "I2CTarget"


class USBDevice(_Unsimulated):
    _what = "USBDevice"


class WDT:
    def __init__(self, id=0, timeout=5000):
        _s.emit("wdt", timeout)

    def feed(self):
        pass


class RTC:
    def __init__(self, id=0):
        pass

    def datetime(self, dt=None):
        if dt is not None:
            _unsimulated("RTC.datetime(set)")
            return None
        import time

        t = time.localtime()
        return (t[0], t[1], t[2], t[6], t[3], t[4], t[5], 0)


class _Mem:
    def __getitem__(self, addr):
        _unsimulated("machine.mem")
        return 0

    def __setitem__(self, addr, value):
        _unsimulated("machine.mem")


mem8 = _Mem()
mem16 = _Mem()
mem32 = _Mem()


# ---------------- Functions ----------------


def mem_backup(*args):
    _unsimulated("machine.mem_backup")
    return bytearray(0)


def unique_id():
    return b"\xe6\x61\x41\x04\x03\x2b\x5c\x2d"


def freq(hz=None):
    if hz is None:
        return 150_000_000
    _s.emit("freq", hz)


def reset():
    _s.emit("reset")
    raise _s.SimEnd("reset")


def soft_reset():
    _s.emit("reset")
    raise _s.SimEnd("soft reset")


def bootloader(*args):
    _s.emit("reset")
    raise _s.SimEnd("bootloader")


def deepsleep(ms=0):
    _s.emit("sleep", ms)
    raise _s.SimEnd("deep sleep")


def lightsleep(ms=None):
    _s.advance((ms if ms is not None else 1000) * 1000)


def idle():
    _s.advance(1000)


def reset_cause():
    return PWRON_RESET


def disable_irq():
    return 0


def enable_irq(state=0):
    pass


def bitstream(pin, encoding, timing, buf):
    _unsimulated("machine.bitstream")


def dht_readinto(pin, buf):
    _s.tick()
    data = _host.dht(_gpio(pin), _s.now_us)
    if data is None or (isinstance(data, int) and data < 0):
        raise OSError(110)  # ETIMEDOUT: the sensor didn't answer
    for i in range(5):
        buf[i] = data[i]


def time_pulse_us(pin, pulse_level, timeout_us=1_000_000):
    _unsimulated("machine.time_pulse_us")
    return -1
