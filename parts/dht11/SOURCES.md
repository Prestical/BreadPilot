# DHT11 temperature and humidity sensor: sources

| Fact | Source |
|---|---|
| Supply 3.3-5.5 V; legs 1 VDD, 2 DATA, 3 NC, 4 GND; 0.3 mA measuring / 60 µA standby; 5.1 kΩ pull-up; sampling period more than 2 s, each read returns the previous measurement | Aosong DHT11 Product Manual p. 4 (see `reference.md`) |
| Accuracy ±2 °C, ±5 %RH | Manual p. 3 |
| Wait 1 s after power-up | Manual p. 6 |
| Leg order left to right with the grid facing you | The manual's pin numbers and a pin picture the user found (11/11/2026) |
| Measuring ranges 0-50 °C, 20-90 %RH | robotistan.com product page "DHT11 Temperature and Humidity Sensor" (11/11/2026); not in the manual |
| The user's part: a bare 4-leg sensor (no module board), legs fit next-to-each-other breadboard holes | The user, 11/11/2026 (shop photo and their own part) |
| Pull-up used: 10 kΩ, not the manual's 5.1 kΩ | Decision until the user's real test (11/11/2026): 5.1 kΩ isn't a common kit value; 10 kΩ is, and a breadboard's wires are far shorter than the manual's 20 m. The user's only other value, 330 Ω, is far too strong (about 10 mA when the sensor pulls the line low) |
| The code: MicroPython's built-in `dht` module (`dht.DHT11(pin)`, `measure()`, `temperature()`, `humidity()`) | MicroPython v1.29.0 (the checker's module list, `docs/software/micropython-v1.29.0/`) |

Not tried on the real sensor yet (M15 step 15.7).

Reviewed: by the user, 11/11/2026 (written by Claude the same day).
