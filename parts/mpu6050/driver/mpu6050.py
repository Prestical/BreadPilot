# mpu6050.py - MicroPython driver for the MPU-6050 motion sensor (BreadPilot).
#
# Save this file on the Pico next to main.py. Use it like this:
#     from machine import Pin, I2C
#     from mpu6050 import MPU6050
#     i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)
#     mpu = MPU6050(i2c)
#     ax, ay, az = mpu.acceleration()   # in g (about 1.0 straight down when lying still)
#     gx, gy, gz = mpu.rotation()       # in degrees per second (about 0 when still)
#     print(mpu.temperature())          # the chip's temperature in C
#
# MPU-6050 facts used (InvenSense MPU-6000/6050 register map; typical values, not checked against a
# page yet): I2C address 0x68 (AD0 low) or 0x69 (AD0 high); it starts asleep: write 0 to
# PWR_MGMT_1 (6Bh) to wake it; ACCEL_XOUT_H (3Bh) starts 14 bytes: accel X Y Z, temperature, gyro
# X Y Z, each a signed 16-bit big-endian number; at the power-on ranges +-2 g = 16384 per g and
# +-250 deg/s = 131 per deg/s; temperature = raw / 340 + 36.53 C. WHO_AM_I (75h) reads 0x68.

_ADDRESSES = (0x68, 0x69)


def _signed(hi, lo):
    v = hi << 8 | lo
    return v - 65536 if v & 0x8000 else v


class MPU6050:
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
                "No MPU-6050 found at 0x68 or 0x69 (found: %s). Check the wiring: VCC to 3V3, GND to GND, "
                "SCL and SDA to the pins in the build steps." % [hex(a) for a in found]
            )
        self.addr = addr
        self.i2c.writeto_mem(self.addr, 0x6B, b"\x00")  # wake up

    def _read(self):
        b = self.i2c.readfrom_mem(self.addr, 0x3B, 14)
        return [_signed(b[i], b[i + 1]) for i in range(0, 14, 2)]

    def acceleration(self):
        """(x, y, z) in g."""
        r = self._read()
        return (r[0] / 16384, r[1] / 16384, r[2] / 16384)

    def rotation(self):
        """(x, y, z) in degrees per second."""
        r = self._read()
        return (r[4] / 131, r[5] / 131, r[6] / 131)

    def temperature(self):
        """The chip's temperature in C."""
        return self._read()[3] / 340 + 36.53
