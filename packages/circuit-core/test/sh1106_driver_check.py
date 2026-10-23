# Runs parts/oled-sh1106-i2c/driver/sh1106.py under CPython with fake MicroPython modules (framebuf, time) and a
# fake I2C bus, and checks every byte the driver sends against the SH1106 datasheet V2.2.
# Started by test/drivers.test.ts; prints "ok" when every check passes.
import importlib.util
import pathlib
import sys
import types

ROOT = pathlib.Path(__file__).resolve().parents[3]

# ---- fake MicroPython modules ----
framebuf = types.ModuleType("framebuf")
framebuf.MONO_VLSB = 0


class FrameBuffer:
    def __init__(self, buf, width, height, fmt):
        self._buf, self._w, self._h = buf, width, height

    def fill(self, c):
        for i in range(len(self._buf)):
            self._buf[i] = 0xFF if c else 0

    def pixel(self, x, y, c):
        # MONO_VLSB: one byte = 8 rows of one column, LSB at the top (same layout as SH1106 pages).
        i = (y // 8) * self._w + x
        bit = 1 << (y % 8)
        self._buf[i] = (self._buf[i] | bit) if c else (self._buf[i] & ~bit)


framebuf.FrameBuffer = FrameBuffer
sys.modules["framebuf"] = framebuf
fake_time = types.ModuleType("time")
fake_time.sleeps = []
fake_time.sleep_ms = lambda ms: fake_time.sleeps.append(ms)
sys.modules["time"] = fake_time

spec = importlib.util.spec_from_file_location("sh1106", ROOT / "parts" / "oled-sh1106-i2c" / "driver" / "sh1106.py")
sh1106 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sh1106)


class FakeI2C:
    def __init__(self, devices):
        self.devices, self.writes = devices, []

    def scan(self):
        return list(self.devices)

    def writeto(self, addr, data):
        assert isinstance(data, (bytes, bytearray)), type(data)
        self.writes.append((addr, bytes(data)))


def cmds(i2c):
    return [w[1][1:] for w in i2c.writes if w[1][0] == 0x00]


# ---- address detection (p.13: 0x3C / 0x3D) ----
i2c = FakeI2C([0x3C])
oled = sh1106.SH1106_I2C(128, 64, i2c)
assert oled.addr == 0x3C
assert all(a == 0x3C for a, _ in i2c.writes)
assert sh1106.SH1106_I2C(128, 64, FakeI2C([0x3D])).addr == 0x3D
try:
    sh1106.SH1106_I2C(128, 64, FakeI2C([0x27]))
    raise AssertionError("expected OSError")
except OSError as e:
    assert "0x3C or 0x3D" in str(e) and "0x27" in str(e), e

# ---- init sequence (p.19-27, order p.32) ----
c = cmds(i2c)
init = [bytes(x) for x in ([0xAE], [0xA1], [0xDA, 0x12], [0xC8], [0xA8, 0x3F], [0xD5, 0x50], [0x81, 0x80], [0xAD, 0x8B], [0x40], [0xD3, 0x00])]
assert c[: len(init)] == init, c[: len(init)]
# RAM clear: 8 pages x 132 columns from column 0
clears = [w for w in i2c.writes if w[1][0] == 0x40]
assert len(clears) == 8 and all(len(w[1]) == 1 + 132 and set(w[1][1:]) == {0} for w in clears)
page_cmds = [x for x in c if x[0] & 0xF8 == 0xB0]
assert page_cmds[:8] == [bytes([0xB0 | p, 0x00, 0x10]) for p in range(8)], page_cmds[:8]
assert c[-1] == bytes([0xAF]), c[-1]  # display on last
assert fake_time.sleeps[:2] == [100, 150], fake_time.sleeps
# flip=True uses the power-on mapping
f = FakeI2C([0x3C])
sh1106.SH1106_I2C(128, 64, f, flip=True)
assert cmds(f)[1] == bytes([0xA0]) and cmds(f)[3] == bytes([0xC0])

# ---- show(): 8 pages, column offset 2, 128 data bytes each ----
i2c.writes.clear()
oled.fill(0)
oled.pixel(0, 0, 1)  # top-left pixel -> page 0, first byte, bit 0
oled.pixel(127, 63, 1)  # bottom-right -> page 7, last byte, bit 7
oled.show()
assert len(i2c.writes) == 16
for p in range(8):
    addr_cmd, data = i2c.writes[2 * p][1], i2c.writes[2 * p + 1][1]
    assert addr_cmd == bytes([0x00, 0xB0 | p, 0x02, 0x10]), addr_cmd
    assert data[0] == 0x40 and len(data) == 1 + 128
assert i2c.writes[1][1][1] == 0x01
assert i2c.writes[15][1][-1] == 0x80

# ---- other commands ----
i2c.writes.clear()
oled.contrast(300)
oled.invert(True)
oled.invert(False)
oled.poweroff()
oled.poweron()
assert cmds(i2c) == [bytes([0x81, 300 & 0xFF]), bytes([0xA7]), bytes([0xA6]), bytes([0xAE]), bytes([0xAF])]

# ---- size limits (132 x 64 RAM) ----
for w, h in ((131, 64), (128, 72), (128, 60)):
    try:
        sh1106.SH1106_I2C(w, h, FakeI2C([0x3C]))
        raise AssertionError("expected ValueError for %dx%d" % (w, h))
    except ValueError:
        pass

print("ok")
