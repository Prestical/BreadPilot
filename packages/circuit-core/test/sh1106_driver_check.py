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

    def pixel(self, x, y, c=None):
        # MONO_VLSB: one byte = 8 rows of one column, LSB at the top (same layout as SH1106 pages).
        # Like framebuf: pixel(x, y) reads, and drawing outside the buffer is clipped.
        if not (0 <= x < self._w and 0 <= y < self._h):
            return None if c is None else 0
        i = (y // 8) * self._w + x
        bit = 1 << (y % 8)
        if c is None:
            return 1 if self._buf[i] & bit else 0
        self._buf[i] = (self._buf[i] | bit) if c else (self._buf[i] & ~bit)

    # Simple stand-ins for the drawing helpers' tests (the real ones are framebuf's C code).
    def fill_rect(self, x, y, w, h, c):
        for yy in range(y, y + h):
            for xx in range(x, x + w):
                self.pixel(xx, yy, c)

    def hline(self, x, y, w, c):
        self.fill_rect(x, y, w, 1, c)

    def vline(self, x, y, h, c):
        self.fill_rect(x, y, 1, h, c)

    def rect(self, x, y, w, h, c):
        for xx in range(x, x + w):
            self.pixel(xx, y, c)
            self.pixel(xx, y + h - 1, c)
        for yy in range(y, y + h):
            self.pixel(x, yy, c)
            self.pixel(x + w - 1, yy, c)

    def line(self, x1, y1, x2, y2, c):
        n = max(abs(x2 - x1), abs(y2 - y1), 1)
        for k in range(n + 1):
            self.pixel(x1 + round((x2 - x1) * k / n), y1 + round((y2 - y1) * k / n), c)

    def text(self, s, x, y, c=1):
        # Fake font: each character lights the top-left and bottom-right pixel of its 8x8 cell.
        for i, _ in enumerate(s):
            self.pixel(x + i * 8, y, c)
            self.pixel(x + i * 8 + 7, y + 7, c)


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

# ---- drawing helpers ----
def lit(fb):
    return {(x, y) for y in range(64) for x in range(128) if fb.pixel(x, y)}


def fresh():
    o = sh1106.SH1106_I2C(128, 64, FakeI2C([0x3C]))
    o.fill(0)
    return o


# sprite: "#" lit, "." and " " dark, scale makes squares
o = fresh()
o.sprite(["#.", " #"], 10, 20)
assert lit(o) == {(10, 20), (11, 21)}, lit(o)
o = fresh()
o.sprite(["#"], 0, 0, scale=3)
assert lit(o) == {(x, y) for x in range(3) for y in range(3)}
# big_text: every font pixel becomes a scale x scale square, characters 8 x scale apart
o = fresh()
o.big_text("AB", 4, 2, scale=2)
want = set()
for left in (4, 20):
    for gx, gy in ((0, 0), (7, 7)):
        want |= {(left + gx * 2 + dx, 2 + gy * 2 + dy) for dx in range(2) for dy in range(2)}
assert lit(o) == want, sorted(lit(o) ^ want)
# center_text: 3 characters at scale 1 start at (128 - 24) // 2 = 52; 2 characters at scale 2 at (128 - 32) // 2 = 48
o = fresh()
o.center_text("abc", 30)
assert min(x for x, _ in lit(o)) == 52 and min(y for _, y in lit(o)) == 30
o = fresh()
o.center_text(42, 0, scale=2)  # numbers are drawn as text
assert min(x for x, _ in lit(o)) == 48
# title: lit bar 128 x 10 with dark text inside
o = fresh()
o.title("Hi")
assert all(o.pixel(x, y) for x in (0, 127) for y in (0, 9)) and not o.pixel(0, 10)
assert not o.pixel((128 - 16) // 2, 1)  # the fake letter pixel is dark on the bar
# bar: outline, filled 2 pixels inside in proportion; values are clamped
o = fresh()
o.bar(0, 0, 104, 10, 50)
assert o.pixel(0, 0) and o.pixel(103, 9) and o.pixel(2, 2) and o.pixel(51, 7) and not o.pixel(52, 5)
o = fresh()
o.bar(0, 0, 104, 10, 500)
assert o.pixel(101, 5) and not o.pixel(102, 5)
o = fresh()
o.bar(0, 0, 104, 10, -5)
assert not o.pixel(2, 5)
# graph: oldest left, newest right, low at the bottom, high at the top of the box
o = fresh()
o.graph([0, 100], 10, 10, 50, 41, low=0, high=100)
assert o.pixel(10, 50) and o.pixel(59, 10)
o = fresh()
o.graph([5, 5, 5], 0, 0, 20, 10)  # flat list: no division by zero
assert lit(o)
o = fresh()
o.graph([], 0, 0, 20, 10)
assert not lit(o)
# icons: every icon fits 8 x 8 and uses only "#" and "."; icon() draws the sprite; unknown names say which exist
for name, rows in sh1106.ICONS.items():
    assert 1 <= len(rows) <= 8 and all(1 <= len(r) <= 8 and set(r) <= set("#.") for r in rows), name
o = fresh()
o.icon("heart", 0, 0)
assert len(lit(o)) == sum(r.count("#") for r in sh1106.ICONS["heart"])
try:
    o.icon("rocket", 0, 0)
    raise AssertionError("expected ValueError")
except ValueError as e:
    assert "heart" in str(e)

# text styles: every style is 8 x scale wide per character; seg digits are 6s x 11s, dots leave gaps
o = fresh()
o.big_text("8", 0, 0, scale=2, style="seg")
assert lit(o) and max(x for x, _ in lit(o)) == 11 and max(y for _, y in lit(o)) == 21  # 6*2 wide, 11*2 tall
assert not o.pixel(0, 0) and not o.pixel(11, 0)  # segment corners stay dark, like a real display
o = fresh()
o.big_text("1", 0, 0, scale=2, style="seg")
assert all(x >= 10 for x, _ in lit(o))  # only the right segments b and c
o = fresh()
o.big_text("8:", 0, 0, scale=1, style="seg")
assert {(11, 3), (11, 7)} <= lit(o)  # the colon: two dots in the second cell (8 + 6 // 2)
o = fresh()
o.big_text("?", 0, 0, scale=2, style="seg")  # no segment pattern: falls back to the font
assert lit(o) == {(x, y) for x in (0, 1) for y in (0, 1)} | {(x, y) for x in (14, 15) for y in (14, 15)}
o = fresh()
o.big_text("A", 0, 0, scale=3, style="dots")
assert o.pixel(0, 0) and o.pixel(1, 1) and not o.pixel(2, 2)  # 2x2 squares every 3 pixels
o = fresh()
o.big_text("A", 0, 0, scale=2, style="dots")  # below scale 3: drawn like block
assert o.pixel(1, 1)
o = fresh()
o.center_text("12", 0, scale=2, style="seg")
assert min(x for x, _ in lit(o)) >= 48 and max(x for x, _ in lit(o)) < 80
for bad in (lambda: o.big_text("1", 0, 0, style="digital"), lambda: o.bar(0, 0, 50, 10, 5, style="round")):
    try:
        bad()
        raise AssertionError("expected ValueError")
    except ValueError as e:
        assert "styles:" in str(e)
# bar styles
o = fresh()
o.bar(0, 0, 50, 10, 50, style="blocks")  # cells of 8 every 10 pixels: 5 cells, 2 or 3 filled
assert o.pixel(4, 5) and o.pixel(14, 5) and not o.pixel(9, 5) and not o.pixel(44, 5) and o.pixel(40, 0)
o = fresh()
o.bar(0, 0, 50, 10, 50, style="rounded")
assert not o.pixel(0, 0) and o.pixel(1, 1) and o.pixel(2, 0) and o.pixel(2, 5)
o = fresh()
o.bar(0, 0, 54, 10, 50, style="slider")  # knob 4 wide at (54 - 4) * 0.5 = 25
assert o.pixel(0, 5) and o.pixel(53, 5) and o.pixel(25, 0) and o.pixel(28, 9) and not o.pixel(24, 0)
o = fresh()
o.bar(0, 0, 54, 10, 50)  # solid is still the default
assert o.pixel(0, 0) and o.pixel(2, 2)

print("ok")
