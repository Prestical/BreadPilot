# Pressure sensor module (BME280 / BMP280, 6 pins): sources

| Fact | Source |
|---|---|
| Pins VCC, GND, SCL, SDA, CSB, SDO; no regulator on the 6-pin board (VCC straight to the chip); I2C 0x76 (SDO low) or 0x77 | Typical for the purple 6-pin GY-BME280 boards; no datasheet page checked yet |
| Supply 1.71-3.6 V; 300-1100 hPa; chip id 0x60 (BME280) / 0x58 (BMP280); the compensation formulas | Typical Bosch BME280/BMP280 values, used by `driver/bme280.py`; the temperature and pressure maths reproduce the datasheet's worked example (25.08 °C, 100653 Pa) on a simulated bus; humidity isn't checked against an example |

The part described is the purple 6-pin board, chosen 19/11/2026.

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
