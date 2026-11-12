# 1.3" I2C OLED (SH1106, 128x64): sources

| Fact | Source |
|---|---|
| Header order VCC, GND, SCL, SDA; VCC 3.3-5 V; SH1106 controller; I2C; 128x64 | Product page text (robotistan.com, "1.3 inc I2C OLED Ekran - SSD1106"), 20/10/2026 |
| 132 x 64 display RAM, 400 kHz I2C | `SH1106.pdf` (Sino Wealth SH1106 V2.2, see `reference.md`) p.1 |
| 7-bit I2C addresses 0x3C / 0x3D (SA0) | `SH1106.pdf` p.13 |
| Supply limited to 3.3 V (`maxSafeVoltage`) | Decision, 20/10/2026: SDA/SCL pull-ups to VCC on the module are undocumented |
| Driver `driver/sh1106.py` | Written from `SH1106.pdf` (init order p.32, page/column addressing); byte-checked under CPython by `packages/circuit-core/test/sh1106_driver_check.py`; works on a real module (21/10/2026) |
| Drawing helpers in `driver/sh1106.py` (title, center_text, big_text, bar, graph, icon, sprite; text styles block/dots/seg, bar styles solid/blocks/rounded/slider; 07-08/11/2026) | Built only from framebuf methods in MicroPython v1.29.0 (`docs/software/micropython-v1.29.0/docs__library__framebuf.rst`; `fill_rect` from the method table in `extmod__modframebuf.c`, not in the doc page). Ran in MicroPython 1.29's WebAssembly build with the real `framebuf`, rendered to images; CPython geometry test in `sh1106_driver_check.py`. Not yet tried on the real module |
| 8x8 font, characters outside 32-127 drawn as character 127 | `docs__library__framebuf.rst` (FrameBuffer.text); `extmod__modframebuf.c` line 844 |

Not documented for this module: the SDA/SCL pull-ups, its current draw, and which 128 of the 132
columns the panel uses (`col_offset=2` and `flip` are options in the driver for that reason).

Reviewed: migrated unchanged from `data/components/oled-sh1106-i2c.json` and `data/drivers/sh1106.py`
(main at e7c3199), 23/10/2026.
