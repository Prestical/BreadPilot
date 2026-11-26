# Motion sensor module (MPU-6050, GY-521): sources

| Fact | Source |
|---|---|
| Pins VCC, GND, SCL, SDA, XDA, XCL, AD0, INT; MPU-6050 at I2C 0x68 (AD0 low) or 0x69; a 3.3 V regulator and I2C pull-ups on the board | Typical for the GY-521 modules; no datasheet page checked yet |
| Wake by writing 0 to 6Bh; 14 bytes from 3Bh; ±2 g = 16384 per g, ±250 °/s = 131 per °/s; temperature = raw / 340 + 36.53 | Typical MPU-6050 register map values, used by `driver/mpu6050.py` (checked with a simulated bus, not on a real sensor) |

The part described is the most common module (GY-521), chosen 19/11/2026.

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
