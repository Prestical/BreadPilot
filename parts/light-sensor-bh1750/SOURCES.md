# Light sensor module (BH1750, GY-302): sources

| Fact | Source |
|---|---|
| Pins VCC, GND, SCL, SDA, ADDR; I2C address 0x23 (ADDR low, the board's default) or 0x5C; continuous high-resolution mode = command 0x10, a new value every 120 ms; lux = raw / 1.2 | Typical BH1750 values (ROHM BH1750FVI datasheet), not checked against a page yet |
| Supply 3.3-5 V (the GY-302 has its own 3.3 V regulator) | Typical seller values |

The part described is the most common version (the blue 5-pin GY-302 board), chosen 19/11/2026.

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
