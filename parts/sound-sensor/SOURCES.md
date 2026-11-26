# Sound sensor module (3 pins, digital output): sources

| Fact | Source |
|---|---|
| Pins OUT, GND, VCC; an electret microphone with an LM393 comparator; OUT LOW while the sound is above the trimmer's level | Typical for the 3-pin sound modules in kits; no datasheet page checked yet |
| Supply 3.3-5 V; a few milliamps | Typical seller values; not measured |
| The output only follows the sound wave's peaks, so a clap gives short LOW pulses, not a steady level | Typical for comparator sound modules |

The part described is the most common 3-pin version, chosen 17/11/2026. It detects loud sounds; it can't record or measure them.

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
