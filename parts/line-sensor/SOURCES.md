# Line tracking sensor module (TCRT5000, 4 pins): sources

| Fact | Source |
|---|---|
| Pins VCC, GND, D0, A0; a TCRT5000 reflective sensor (IR LED + phototransistor) with an LM393 comparator; works 1-15 mm from the surface | Typical for the TCRT5000 modules in kits; no datasheet page checked yet |
| Supply 3.3-5 V; about 20 mA (mostly the IR LED) | Typical; not measured |
| D0 low over a light surface, high over black | Typical for these boards; some differ |

The part described is the most common version (the blue 4-pin TCRT5000 board), chosen 19/11/2026.

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
