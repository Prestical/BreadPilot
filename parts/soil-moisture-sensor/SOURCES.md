# Capacitive soil moisture sensor (v1.2, 3 pins): sources

| Fact | Source |
|---|---|
| Pins GND, VCC, AOUT on a 3-pin plug; a 555-type oscillator and the coated probe; AOUT falls as the soil gets wetter | Typical for the black v1.2 capacitive sensors in kits; no datasheet page checked yet |
| Supply 3.3-5.5 V; about 5 mA | Typical seller values; not measured |
| Readings in air and water (in `agent.json`) | Rough guides; every sensor differs, so the code calibrates |
| The board is about 98 x 23 mm | Typical; the 3D model's size, not measured |

The part described is the capacitive v1.2 sensor (not the resistive FC-28, whose bare probe rusts), chosen 19/11/2026.

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
