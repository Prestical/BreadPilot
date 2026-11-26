# ds3231.py - MicroPython driver for the DS3231 real-time clock (BreadPilot).
#
# Save this file on the Pico next to main.py. Use it like this:
#     from machine import Pin, I2C
#     from ds3231 import DS3231
#     i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)
#     clock = DS3231(i2c)
#     clock.set_time(2026, 11, 19, 18, 30, 0)   # once, to set it (it keeps time on its coin cell)
#     year, month, day, hour, minute, second = clock.time()
#     print(clock.temperature())                # the chip's own temperature, 0.25 C steps
#
# DS3231 facts used (Maxim/Analog Devices DS3231 datasheet; typical values, not checked against a
# page yet): I2C address 0x68; time registers 00h-06h in BCD (seconds, minutes, hours, weekday,
# date, month, year 00-99); bit 6 of the hours register = 12-hour mode (this driver writes 24-hour);
# temperature in 11h (whole degrees, signed) and the top two bits of 12h (quarters).

ADDRESS = 0x68


def _bcd(v):
    return (v // 10) << 4 | (v % 10)


def _dec(b):
    return (b >> 4) * 10 + (b & 0x0F)


class DS3231:
    def __init__(self, i2c, addr=ADDRESS):
        self.i2c = i2c
        self.addr = addr
        if addr not in i2c.scan():
            raise OSError(
                "No DS3231 clock found at 0x68 (found: %s). Check the wiring: VCC to 3V3, GND to GND, "
                "SCL and SDA to the pins in the build steps." % [hex(a) for a in i2c.scan()]
            )

    def time(self):
        """(year, month, day, hour, minute, second), 24-hour."""
        b = self.i2c.readfrom_mem(self.addr, 0x00, 7)
        hours = b[2]
        if hours & 0x40:  # 12-hour mode (set by another program): bit 5 = PM
            hour = _dec(hours & 0x1F) % 12 + (12 if hours & 0x20 else 0)
        else:
            hour = _dec(hours & 0x3F)
        return (2000 + _dec(b[6]), _dec(b[5] & 0x1F), _dec(b[4] & 0x3F), hour, _dec(b[1] & 0x7F), _dec(b[0] & 0x7F))

    def set_time(self, year, month, day, hour, minute, second=0, weekday=1):
        """Set the clock (24-hour; year 2000-2099; weekday 1-7, any numbering you like)."""
        self.i2c.writeto_mem(
            self.addr, 0x00,
            bytes((_bcd(second), _bcd(minute), _bcd(hour), _bcd(weekday), _bcd(day), _bcd(month), _bcd(year - 2000))),
        )

    def temperature(self):
        """The chip's temperature in C (0.25 C steps); it measures every 64 s by itself."""
        b = self.i2c.readfrom_mem(self.addr, 0x11, 2)
        whole = b[0] - 256 if b[0] & 0x80 else b[0]
        return whole + (b[1] >> 6) * 0.25
