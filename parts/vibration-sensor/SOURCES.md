# Vibration sensor module (SW-420, 3 pins): sources

| Fact | Source |
|---|---|
| Pins VCC, GND, DO; an SW-420 spring vibration switch with an LM393 comparator and a sensitivity trimmer | Typical for the SW-420 modules in sensor kits; no datasheet page checked yet |
| Supply 3.3-5 V; a few milliamps | Typical seller values; not measured |
| Which level DO has during a shake differs between boards | Seller descriptions disagree, so the code compares with the reading at start |

The part described is the most common version (the blue 3-pin SW-420 board), chosen 19/11/2026.

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
