# Hall sensor module (KY-024, 4 pins): sources

| Fact | Source |
|---|---|
| Pins A0, G, +, D0; a linear Hall sensor (49E type) with an LM393 comparator; D0 switches while a magnet is near | Typical for the KY-024 modules in sensor kits; no datasheet page checked yet |
| Works on 3.3 V (the 49E and the LM393 both run below 3.3 V); a few milliamps | Typical; not measured |
| Which level D0 has near a magnet differs between boards | Seller descriptions disagree, so the code compares with the reading at start |

The part described is the KY-024 (it runs on 3.3 V), chosen 19/11/2026; the 3-pin KY-003 needs 4.5 V or more.

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
