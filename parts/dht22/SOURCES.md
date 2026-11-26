# DHT22 (AM2302) temperature and humidity sensor: sources

| Fact | Source |
|---|---|
| Supply 3.3-5.5 V; legs 1 VDD, 2 DATA, 3 NC, 4 GND; sampling period 2 s; −40 to 80 °C ±0.5 °C; 0-100 %RH ±2 %; about 1.5 mA while measuring | Typical AM2302 values (Aosong's AM2302 manual), not checked against a page yet |
| Pull-up 10 kΩ inside the block | Same as the DHT11 pack (tested there on hardware) |
| The code: MicroPython's built-in `dht` module, `dht.DHT22(pin)`; values with one decimal | MicroPython v1.29.0 (`docs/software/micropython-v1.29.0/`) |

The part described is the most common version (the bare white 4-leg AM2302/DHT22), chosen 17/11/2026.

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
