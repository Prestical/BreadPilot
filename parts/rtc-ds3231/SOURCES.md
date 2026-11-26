# Real-time clock module (DS3231, ZS-042): sources

| Fact | Source |
|---|---|
| Pins 32K, SQW, SCL, SDA, VCC, GND; DS3231 at I2C 0x68 (plus an AT24C32 memory at 0x57); a coin cell on the back keeps the time | Typical for the ZS-042 modules; no datasheet page checked yet |
| Time registers 00h-06h in BCD; temperature in 11h-12h; about ±2 ppm | Typical DS3231 values (Maxim/Analog Devices datasheet), used by `driver/ds3231.py` |
| SDA and SCL pulled up to VCC on the board, so VCC from 3V3 only (`maxSafeVoltage`) | Typical ZS-042 board wiring |

The part described is the most common module (ZS-042), chosen 19/11/2026. Its charging circuit is meant for a rechargeable LIR2032 cell; with a plain CR2032 many people remove the charging diode or resistor.

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
