# sh1106.py - MicroPython driver for 1.3" 128x64 SH1106 OLED displays over I2C (BreadPilot).
#
# Save this file on the Pico next to main.py. Use it like this:
#     from machine import Pin, I2C
#     from sh1106 import SH1106_I2C
#     i2c = I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)
#     oled = SH1106_I2C(128, 64, i2c)
#     oled.fill(0)
#     oled.text("Hello!", 0, 0)
#     oled.show()
#
# Everything from MicroPython's framebuf works (text, pixel, line, rect, fill_rect, hline, vline,
# scroll, blit); call show() to send the picture to the screen.
#
# Facts from the Sino Wealth SH1106 datasheet V2.2 (docs/hardware/components/SH1106.pdf):
#   - I2C 7-bit address 0x3C or 0x3D, chosen by the SA0 pin (p.13).
#   - Control byte 0x00: command bytes follow; 0x40: display data follows (Co = 0, D/C, p.13-14).
#   - 132 x 64 display RAM in 8 pages of 8 rows; page address B0h-B7h (p.23); column address set
#     with 00h-0Fh (low 4 bits) and 10h-1Fh (high 4 bits), auto-incremented (p.19).
#   - Power-on order and delays (p.32); command values (p.19-27).
# Module-specific, NOT in the datasheet: which of the 132 RAM columns the 128-pixel panel shows
# (most 1.3" modules show columns 2-129, hence col_offset=2) and which way up the panel is mounted
# (flip). If the picture is shifted sideways, try col_offset=0; if it's upside down, try flip=True.

import framebuf
import time

_ADDRESSES = (0x3C, 0x3D)
_RAM_COLUMNS = 132


class SH1106_I2C(framebuf.FrameBuffer):
    def __init__(self, width, height, i2c, addr=None, col_offset=2, flip=False):
        if height % 8 or height > 64 or width + col_offset > _RAM_COLUMNS:
            raise ValueError("SH1106 supports up to 132 x 64 pixels (height a multiple of 8)")
        self.width = width
        self.height = height
        self.i2c = i2c
        self.col_offset = col_offset
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
            "No SH1106 display found at 0x3C or 0x3D (found: %s). Check the wiring: "
            "VCC to 3V3, GND to GND, SCL and SDA to the pins in the build steps." % [hex(a) for a in found]
        )

    def write_cmd(self, *cmds):
        # 0x00 = control byte: Co = 0 and D/C = 0, so every byte after it is a command (p.13-14).
        self.i2c.writeto(self.addr, bytes((0x00,) + cmds))

    def _write_data(self, data):
        # 0x40 = control byte: Co = 0 and D/C = 1, so every byte after it goes to the RAM (p.13-14).
        self.i2c.writeto(self.addr, b"\x40" + bytes(data))

    def _set_address(self, page, column):
        # Page B0h-B7h (p.23), column low 00h-0Fh and high 10h-1Fh (p.19).
        self.write_cmd(0xB0 | page, 0x00 | (column & 0x0F), 0x10 | (column >> 4))

    def init_display(self):
        # Order from the datasheet's power-on flow chart (p.32).
        self.write_cmd(0xAE)  # display off (p.23)
        self.write_cmd(0xA0 if self.flip else 0xA1)  # segment re-map (p.21)
        self.write_cmd(0xDA, 0x12)  # common pads: alternative, the power-on value (p.26)
        self.write_cmd(0xC0 if self.flip else 0xC8)  # common output scan direction (p.24)
        self.write_cmd(0xA8, self.height - 1)  # multiplex ratio (p.22)
        self.write_cmd(0xD5, 0x50)  # clock divide 1, oscillator at its power-on value (p.25)
        self.write_cmd(0x81, 0x80)  # contrast, the power-on value (p.20)
        self.write_cmd(0xAD, 0x8B)  # built-in DC-DC on (p.22)
        self.write_cmd(0x40)  # display start line 0 (p.20)
        self.write_cmd(0xD3, 0x00)  # display offset 0 (p.24)
        # Clear all 132 RAM columns, including the ones the panel doesn't show.
        blank = bytes(_RAM_COLUMNS)
        for page in range(8):
            self._set_address(page, 0)
            self._write_data(blank)
        time.sleep_ms(100)  # let the DC-DC output settle (p.32: about 100 ms)
        self.write_cmd(0xAF)  # display on (p.23)
        time.sleep_ms(150)  # p.32: about 150 ms after display on

    def show(self):
        for page in range(self.pages):
            self._set_address(page, self.col_offset)
            start = page * self.width
            self._write_data(self.buffer[start : start + self.width])

    def poweroff(self):
        self.write_cmd(0xAE)  # display off = sleep mode (p.23)

    def poweron(self):
        self.write_cmd(0xAF)

    def contrast(self, value):
        self.write_cmd(0x81, value & 0xFF)  # 256 steps (p.20)

    def invert(self, on):
        self.write_cmd(0xA7 if on else 0xA6)  # reverse / normal display (p.21)
