# Photoresistor (LDR, GL5528): sources

| Fact | Source |
|---|---|
| About 10-20 kΩ at 10 lux, about 1 MΩ in the dark; no polarity | Typical GL5528 values (its datasheet), not checked against a page yet |
| A 10 kΩ resistor to GND makes a divider whose middle voltage rises with light | Ohm's law; the usual kit circuit |
| Readings in a dark room and in daylight (in `agent.json`) | Rough guides from the divider and the typical resistances; real values depend on the room |

The part described is the most common version (5 mm GL5528), chosen 17/11/2026.
Current: at most 3.3 V ÷ 10 kΩ = 0.33 mA, in the brightest light.

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
