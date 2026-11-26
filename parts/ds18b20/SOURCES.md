# DS18B20 temperature sensor (TO-92, 1-Wire): sources

| Fact | Source |
|---|---|
| Legs GND, DQ, VDD (flat side facing you, left to right); supply 3.0-5.5 V; −55 to 125 °C, ±0.5 °C from −10 to 85 °C; 750 ms per 12-bit reading; 4.7 kΩ pull-up on DQ | Typical DS18B20 values (Maxim/Analog Devices datasheet), not checked against a page yet |
| The code: MicroPython's built-in `onewire` and `ds18x20` modules | MicroPython v1.29.0 for the Pico 2 W (frozen modules, `docs/software/micropython-v1.29.0/`) |

The part described is the bare TO-92 sensor, chosen 19/11/2026 (the waterproof probe on a cable is the same chip in a different case).

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
