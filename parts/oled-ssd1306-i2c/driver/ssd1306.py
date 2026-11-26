# ssd1306.py - MicroPython driver for 0.96" 128x64 SSD1306 OLED displays over I2C (BreadPilot).
#
# Save this file on the Pico next to main.py. Use it like this:
#     from machine import Pin, I2C
#     from ssd1306 import SSD1306_I2C
#     i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)
#     oled = SSD1306_I2C(128, 64, i2c)
#     oled.fill(0)
#     oled.text("Hello!", 0, 0)
#     oled.show()
#
# Everything from MicroPython's framebuf works (text, pixel, line, rect, fill_rect, hline, vline,
# scroll, blit); call show() to send the picture to the screen.
# Drawing helpers on top of it: title, center_text, big_text, bar, graph, icon (ICONS below), sprite.
# They are the same as in sh1106.py, so code written for one display works on the other.
#
# SSD1306 facts used (Solomon Systech SSD1306 datasheet; typical values, not checked against a
# page yet):
#   - I2C 7-bit address 0x3C or 0x3D, chosen by the D/C# (SA0) pin; most modules use 0x3C.
#   - Control byte 0x00: command bytes follow; 0x40: display data follows.
#   - 128 x 64 display RAM in 8 pages; horizontal addressing (20h, 00h) with the column range set by
#     21h and the page range by 22h, so one write fills the whole screen.
#   - The charge pump (8Dh, 14h) makes the panel voltage from VCC; it must be on before display on.
# If the picture is upside down, use flip=True.

import framebuf
import time

_ADDRESSES = (0x3C, 0x3D)


class SSD1306_I2C(framebuf.FrameBuffer):
    def __init__(self, width, height, i2c, addr=None, flip=False):
        if height not in (32, 64) or width > 128:
            raise ValueError("SSD1306 supports 128 x 64 or 128 x 32 pixels")
        self.width = width
        self.height = height
        self.i2c = i2c
        self.flip = flip
        self.pages = height // 8
        self.buffer = bytearray(self.pages * width)
        super().__init__(self.buffer, width, height, framebuf.MONO_VLSB)
        self.addr = self._find() if addr is None else addr
        self.init_display()

    def _find(self):
        found = self.i2c.scan()
        for a in _ADDRESSES:
            if a in found:
                return a
        raise OSError(
            "No SSD1306 display found at 0x3C or 0x3D (found: %s). Check the wiring: "
            "VCC to 3V3, GND to GND, SCL and SDA to the pins in the build steps." % [hex(a) for a in found]
        )

    def write_cmd(self, *cmds):
        # 0x00 = control byte: every byte after it is a command.
        self.i2c.writeto(self.addr, bytes((0x00,) + cmds))

    def _write_data(self, data):
        # 0x40 = control byte: every byte after it goes to the display RAM.
        self.i2c.writeto(self.addr, b"\x40" + bytes(data))

    def init_display(self):
        self.write_cmd(0xAE)  # display off
        self.write_cmd(0x20, 0x00)  # horizontal addressing
        self.write_cmd(0x40)  # display start line 0
        self.write_cmd(0xA0 if self.flip else 0xA1)  # segment re-map
        self.write_cmd(0xA8, self.height - 1)  # multiplex ratio
        self.write_cmd(0xC0 if self.flip else 0xC8)  # common output scan direction
        self.write_cmd(0xD3, 0x00)  # display offset 0
        self.write_cmd(0xDA, 0x12 if self.height == 64 else 0x02)  # common pins configuration
        self.write_cmd(0xD5, 0x80)  # clock divide ratio and oscillator frequency
        self.write_cmd(0xD9, 0xF1)  # pre-charge period (internal charge pump)
        self.write_cmd(0xDB, 0x30)  # VCOMH deselect level
        self.write_cmd(0x81, 0xFF)  # contrast
        self.write_cmd(0xA4)  # show the RAM (not all pixels on)
        self.write_cmd(0xA6)  # normal, not inverted
        self.write_cmd(0x8D, 0x14)  # charge pump on
        self.fill(0)
        self.show()
        self.write_cmd(0xAF)  # display on
        time.sleep_ms(100)

    def show(self):
        self.write_cmd(0x21, 0, self.width - 1)  # column range
        self.write_cmd(0x22, 0, self.pages - 1)  # page range
        self._write_data(self.buffer)

    def poweroff(self):
        self.write_cmd(0xAE)

    def poweron(self):
        self.write_cmd(0xAF)

    def contrast(self, value):
        self.write_cmd(0x81, value & 0xFF)

    def invert(self, on):
        self.write_cmd(0xA7 if on else 0xA6)

    # ---- Drawing helpers (BreadPilot) ----
    # Built only from framebuf's own methods (text, pixel, fill_rect, rect, line), as listed in
    # MicroPython v1.29.0's framebuf docs and source (docs/software/micropython-v1.29.0/). They draw
    # into the picture like text() does; call show() once after drawing.

    def big_text(self, s, x, y, scale=2, c=1, style="block"):
        # Big text in one of TEXT_STYLES: "block" (the 8x8 font, enlarged), "dots" (LED-matrix look,
        # scale 3 or more), "seg" (seven-segment digits like a clock). Every style is 8 x scale pixels
        # wide per character; "block" and "dots" are 8 x scale tall, "seg" is 11 x scale tall.
        s = str(s)
        if style not in TEXT_STYLES:
            raise ValueError("no text style %r; styles: %s" % (style, ", ".join(TEXT_STYLES)))
        for i, ch in enumerate(s):
            left = x + i * 8 * scale
            if style == "seg" and ch in SEGMENTS:
                self._seg(SEGMENTS[ch], left, y, scale, c)
            else:
                # "dots" leaves a dark line between the squares, like an LED matrix (from scale 3;
                # smaller squares would be single pixels, so below that it draws like "block").
                self._big_char(ch, left, y, scale, scale - 1 if style == "dots" and scale >= 3 else scale, c)

    def _big_char(self, ch, x, y, scale, size, c):
        # One character of the 8x8 font, each pixel drawn as a size x size square every scale pixels.
        if self._glyph is None:
            self._glyph = framebuf.FrameBuffer(bytearray(8), 8, 8, framebuf.MONO_VLSB)
        g = self._glyph
        g.fill(0)
        g.text(ch, 0, 0, 1)
        for gy in range(8):
            for gx in range(8):
                if g.pixel(gx, gy):
                    self.fill_rect(x + gx * scale, y + gy * scale, size, size, c)

    def _seg(self, lit, x, y, s, c):
        # A seven-segment character, 6s wide and 11s tall (2s gap to the next one). Segments
        # a-g: a top, b top right, c bottom right, d bottom, e bottom left, f top left, g middle;
        # ":" and "." are dots.
        w, h, mid = 6 * s, TEXT_HEIGHT["seg"] * s, 5 * s
        boxes = {
            "a": (s, 0, w - 2 * s, s),
            "b": (w - s, s, s, mid - s),
            "c": (w - s, mid + s, s, h - mid - 2 * s),
            "d": (s, h - s, w - 2 * s, s),
            "e": (0, mid + s, s, h - mid - 2 * s),
            "f": (0, s, s, mid - s),
            "g": (s, mid, w - 2 * s, s),
            ":": (w // 2 - s // 2, 3 * s, s, s),
            ";": (w // 2 - s // 2, h - 4 * s, s, s),
            ".": (w // 2 - s // 2, h - s, s, s),
        }
        for k in lit:
            bx, by, bw, bh = boxes[k]
            self.fill_rect(x + bx, y + by, bw, bh, c)

    def center_text(self, s, y, scale=1, c=1, style="block"):
        # Text centred left to right; scale 2 or more (or a style) draws it big.
        s = str(s)
        x = (self.width - len(s) * 8 * scale) // 2
        if scale == 1 and style == "block":
            self.text(s, x, y, c)
        else:
            self.big_text(s, x, y, scale, c, style)

    def title(self, s):
        # A lit bar across the top with the text in dark letters, centred. Draw the rest from y = 12.
        self.fill_rect(0, 0, self.width, 10, 1)
        self.text(str(s), (self.width - len(str(s)) * 8) // 2, 1, 0)

    def sprite(self, rows, x, y, scale=1, c=1):
        # A small picture written as rows of text: "#" is a lit pixel, "." or " " a dark one.
        for r, row in enumerate(rows):
            for col, ch in enumerate(row):
                if ch != "." and ch != " ":
                    self.fill_rect(x + col * scale, y + r * scale, scale, scale, c)

    def icon(self, name, x, y, scale=1, c=1):
        # One of the ready-made 8x8 icons in ICONS, e.g. oled.icon("heart", 0, 0).
        if name not in ICONS:
            raise ValueError("no icon %r; icons: %s" % (name, ", ".join(sorted(ICONS))))
        self.sprite(ICONS[name], x, y, scale, c)

    def bar(self, x, y, w, h, value, max_value=100, c=1, style="solid"):
        # A level or progress bar in one of BAR_STYLES, filled from the left in proportion to
        # value / max_value. "solid": outline + fill; "blocks": separate cells; "rounded": solid
        # with round ends; "slider": a thin line with a knob at the value.
        if style not in BAR_STYLES:
            raise ValueError("no bar style %r; styles: %s" % (style, ", ".join(BAR_STYLES)))
        value = min(max(value, 0), max_value)
        frac = value / max_value if max_value else 0
        if style == "slider":
            mid = y + h // 2
            self.hline(x, mid, w, c)
            kx = x + int((w - 4) * frac)
            self.fill_rect(kx, y, 4, h, c)
            return
        if style == "blocks":
            cell = max(h - 2, 3)
            n = max((w + 2) // (cell + 2), 1)
            for i in range(n):
                cx = x + i * (cell + 2)
                if i < round(n * frac):
                    self.fill_rect(cx, y, cell, h, c)
                else:
                    self.rect(cx, y, cell, h, c)
            return
        inner = int((w - 4) * frac)
        if style == "rounded":
            self.hline(x + 2, y, w - 4, c)
            self.hline(x + 2, y + h - 1, w - 4, c)
            self.vline(x, y + 2, h - 4, c)
            self.vline(x + w - 1, y + 2, h - 4, c)
            self.pixel(x + 1, y + 1, c)
            self.pixel(x + w - 2, y + 1, c)
            self.pixel(x + 1, y + h - 2, c)
            self.pixel(x + w - 2, y + h - 2, c)
            if inner > 0:
                self.fill_rect(x + 2, y + 2, inner, h - 4, c)
            return
        self.rect(x, y, w, h, c)
        if inner > 0:
            self.fill_rect(x + 2, y + 2, inner, h - 4, c)

    def graph(self, values, x, y, w, h, low=None, high=None, c=1):
        # A line graph of a list of numbers inside the box x, y, w, h: oldest on the left, newest on
        # the right. low/high set the range; without them the graph uses the list's own min and max.
        values = list(values)[-w:]
        if not values:
            return
        lo = min(values) if low is None else low
        hi = max(values) if high is None else high
        span = (hi - lo) or 1
        n = len(values)
        px = py = None
        for i, v in enumerate(values):
            v = min(max(v, lo), hi)
            nx = x + (i * (w - 1) // (n - 1) if n > 1 else 0)
            ny = y + h - 1 - int((v - lo) * (h - 1) / span)
            if px is None:
                self.pixel(nx, ny, c)
            else:
                self.line(px, py, nx, ny, c)
            px, py = nx, ny

    _glyph = None


# Styles for big_text() / center_text() and bar(). The app reads these lists (and ICONS) from this
# file for the AI's instructions and the code checks: a new style or icon needs no other change.
TEXT_STYLES = ("block", "dots", "seg")
TEXT_HEIGHT = {"block": 8, "dots": 8, "seg": 11}  # pixels per scale step, for each text style
BAR_STYLES = ("solid", "blocks", "rounded", "slider")

# Seven-segment characters for the "seg" text style (segments a-g as drawn in _seg); other
# characters fall back to the 8x8 font.
SEGMENTS = {
    "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg", "5": "acdfg", "6": "acdefg",
    "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g", " ": "", ":": ":;", ".": ".",
    "A": "abcefg", "b": "cdefg", "C": "adef", "c": "deg", "d": "bcdeg", "E": "adefg", "F": "aefg",
    "H": "bcefg", "h": "cefg", "L": "def", "n": "ceg", "o": "cdeg", "P": "abefg", "r": "eg",
    "t": "defg", "U": "bcdef", "u": "cde", "y": "bcdfg",
}

# Ready-made 8x8 icons for icon(); "#" = lit pixel. Add one with a new line here.
ICONS = {
    "heart": (".##.##.", "#######", "#######", "#######", ".#####.", "..###..", "...#..."),
    "check": ("......#", ".....##", "#...##.", "##.##..", ".###...", "..#...."),
    "cross": ("#.....#", ".#...#.", "..#.#..", "...#...", "..#.#..", ".#...#.", "#.....#"),
    "up": ("...#...", "..###..", ".#####.", "#######", "..###..", "..###..", "..###.."),
    "down": ("..###..", "..###..", "..###..", "#######", ".#####.", "..###..", "...#..."),
    "left": ("...#...", "..##...", ".######", "#######", ".######", "..##...", "...#..."),
    "right": ("...#...", "...##..", "######.", "#######", "######.", "...##..", "...#..."),
    "bell": ("...#...", "..###..", ".#####.", ".#####.", ".#####.", "#######", "...#..."),
    "sun": ("...#...", ".#...#.", "..###..", "#.###.#", "..###..", ".#...#.", "...#..."),
    "moon": ("..###.", ".##...", "##....", "##....", "##....", ".##...", "..###."),
    "note": ("...###", "...#.#", "...#.#", "...#..", ".###..", "####..", ".##..."),
    "drop": ("...#...", "..###..", "..###..", ".#####.", "#######", "#######", ".#####.", "..###.."),
    "thermometer": ("..#..", ".#.#.", ".#.#.", ".###.", ".###.", "#####", "#####", ".###."),
    "clock": ("..###..", ".#.#.#.", "#..#..#", "#..##.#", "#.....#", ".#...#.", "..###.."),
    "smile": ("..####..", ".#....#.", "#.#..#.#", "#......#", "#.#..#.#", "#..##..#", ".#....#.", "..####.."),
    "sad": ("..####..", ".#....#.", "#.#..#.#", "#......#", "#..##..#", "#.#..#.#", ".#....#.", "..####.."),
    "star": ("...#...", "...#...", "#######", ".#####.", "..###..", ".##.##.", "#.....#"),
    "lock": ("..###..", ".#...#.", ".#...#.", "#######", "###.###", "###.###", "#######"),
    "play": ("#......", "###....", "#####..", "#######", "#####..", "###....", "#......"),
    "pause": ("##..##", "##..##", "##..##", "##..##", "##..##", "##..##", "##..##"),
}
