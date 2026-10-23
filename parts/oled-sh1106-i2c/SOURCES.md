# 1.3" I2C OLED (SH1106, 128x64): sources

| Fact | Source |
|---|---|
| Header order VCC, GND, SCL, SDA; VCC 3.3-5 V; SH1106 controller; I2C; 128x64 | Product page text supplied by the user (robotistan.com, "1.3 inc I2C OLED Ekran - SSD1106"), 20/10/2026 |
| 132 x 64 display RAM, 400 kHz I2C | `docs/hardware/components/SH1106.pdf` (Sino Wealth SH1106 V2.2) p.1 |
| 7-bit I2C addresses 0x3C / 0x3D (SA0) | `SH1106.pdf` p.13 |
| Supply limited to 3.3 V (`maxSafeVoltage`) | User's decision, 20/10/2026: SDA/SCL pull-ups to VCC on the module are undocumented |
| Driver `driver/sh1106.py` | Written from `SH1106.pdf` (init order p.32, page/column addressing); byte-checked under CPython by `packages/circuit-core/test/sh1106_driver_check.py`; works on the user's real module (21/10/2026) |

Not documented for this module: the SDA/SCL pull-ups, its current draw, and which 128 of the 132
columns the panel uses (`col_offset=2` and `flip` are options in the driver for that reason).
`SSD1306.pdf` (also in the folder) is a different chip and is not used.

Reviewed: migrated unchanged from `data/components/oled-sh1106-i2c.json` and `data/drivers/sh1106.py`
(main at e7c3199), 23/10/2026.
