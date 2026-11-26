# bme280.py - MicroPython driver for BME280 and BMP280 pressure sensors (BreadPilot).
#
# Save this file on the Pico next to main.py. Use it like this:
#     from machine import Pin, I2C
#     from bme280 import BME280
#     i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)
#     sensor = BME280(i2c)
#     t, p, h = sensor.read()   # C, hPa, % (h is None on a BMP280, which has no humidity sensor)
#     print(sensor.altitude())  # metres above sea level, estimated from the pressure
#
# Bosch BME280 / BMP280 facts used (datasheets; typical values, not checked against a page yet):
# I2C address 0x76 (SDO to GND) or 0x77 (SDO to VDDIO); chip id (D0h) 0x60 = BME280, 0x58 = BMP280;
# calibration in 88h-A1h (and E1h-E7h for humidity, BME280 only); ctrl_hum F2h, ctrl_meas F4h,
# config F5h; raw data from F7h (pressure, temperature: 20 bits each; humidity: 16 bits); the
# compensation formulas are the datasheets' floating-point ones.

import time

_ADDRESSES = (0x76, 0x77)


def _u16(b, i):
    return b[i] | b[i + 1] << 8


def _s16(b, i):
    v = _u16(b, i)
    return v - 65536 if v & 0x8000 else v


class BME280:
    def __init__(self, i2c, addr=None):
        self.i2c = i2c
        found = i2c.scan()
        if addr is None:
            for a in _ADDRESSES:
                if a in found:
                    addr = a
                    break
        if addr is None:
            raise OSError(
                "No BME280/BMP280 found at 0x76 or 0x77 (found: %s). Check the wiring: VCC to 3V3, GND to GND, "
                "SCL and SDA to the pins in the build steps." % [hex(a) for a in found]
            )
        self.addr = addr
        chip = i2c.readfrom_mem(addr, 0xD0, 1)[0]
        self.humidity_sensor = chip == 0x60
        c = i2c.readfrom_mem(addr, 0x88, 24)
        self.T = (_u16(c, 0), _s16(c, 2), _s16(c, 4))
        self.P = (_u16(c, 6),) + tuple(_s16(c, 8 + 2 * i) for i in range(8))
        if self.humidity_sensor:
            h1 = i2c.readfrom_mem(addr, 0xA1, 1)[0]
            h = i2c.readfrom_mem(addr, 0xE1, 7)
            h4 = h[3] << 4 | (h[4] & 0x0F)
            h5 = h[5] << 4 | h[4] >> 4
            self.H = (h1, _s16(h, 0), h[2], h4 - 4096 if h4 & 0x800 else h4, h5 - 4096 if h5 & 0x800 else h5, h[6] - 256 if h[6] & 0x80 else h[6])
            i2c.writeto_mem(addr, 0xF2, b"\x01")  # humidity oversampling x1 (before ctrl_meas)
        i2c.writeto_mem(addr, 0xF5, b"\xa0")  # 1 s standby, no filter
        i2c.writeto_mem(addr, 0xF4, b"\x27")  # temperature and pressure x1, normal mode
        time.sleep_ms(10)

    def read(self):
        """(temperature C, pressure hPa, humidity % or None)."""
        d = self.i2c.readfrom_mem(self.addr, 0xF7, 8)
        adc_p = d[0] << 12 | d[1] << 4 | d[2] >> 4
        adc_t = d[3] << 12 | d[4] << 4 | d[5] >> 4
        T1, T2, T3 = self.T
        v1 = (adc_t / 16384 - T1 / 1024) * T2
        v2 = (adc_t / 131072 - T1 / 8192) ** 2 * T3
        t_fine = v1 + v2
        temperature = t_fine / 5120
        P1, P2, P3, P4, P5, P6, P7, P8, P9 = self.P
        v1 = t_fine / 2 - 64000
        v2 = v1 * v1 * P6 / 32768 + v1 * P5 * 2
        v2 = v2 / 4 + P4 * 65536
        v1 = (P3 * v1 * v1 / 524288 + P2 * v1) / 524288
        v1 = (1 + v1 / 32768) * P1
        pressure = None
        if v1:
            p = 1048576 - adc_p
            p = (p - v2 / 4096) * 6250 / v1
            v1 = P9 * p * p / 2147483648
            v2 = p * P8 / 32768
            pressure = (p + (v1 + v2 + P7) / 16) / 100
        humidity = None
        if self.humidity_sensor:
            adc_h = d[6] << 8 | d[7]
            H1, H2, H3, H4, H5, H6 = self.H
            h = t_fine - 76800
            h = (adc_h - (H4 * 64 + H5 / 16384 * h)) * (H2 / 65536 * (1 + H6 / 67108864 * h * (1 + H3 / 67108864 * h)))
            h = h * (1 - H1 * h / 524288)
            humidity = min(100, max(0, h))
        return temperature, pressure, humidity

    def altitude(self, sea_level_hpa=1013.25):
        """Metres above sea level from the pressure (weather changes it by tens of metres)."""
        p = self.read()[1]
        return 44330 * (1 - (p / sea_level_hpa) ** 0.1903) if p else None
