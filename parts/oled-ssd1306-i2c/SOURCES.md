# 0.96" I2C OLED display (SSD1306, 128x64): sources

| Fact | Source |
|---|---|
| SSD1306 controller, 128 x 64, I2C 0x3C (or 0x3D); pins GND, VCC, SCL, SDA on most boards | Typical for the 0.96" OLED modules in kits; no datasheet page checked yet |
| Supply 3.3-5 V; VCC from 3V3 only (`maxSafeVoltage`), as for the 1.3" OLED | Typical seller values; same reasoning as `parts/oled-sh1106-i2c` |
| The driver's commands (addressing, charge pump, scan direction) | Typical SSD1306 datasheet values, used by `driver/ssd1306.py`; its drawing helpers are the 1.3" OLED driver's |

The part described is the most common version (the 4-pin 0.96" board), chosen 19/11/2026.

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
