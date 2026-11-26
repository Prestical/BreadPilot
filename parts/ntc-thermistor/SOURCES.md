# NTC thermistor (10 kΩ, B 3950): sources

| Fact | Source |
|---|---|
| 10 kΩ at 25 °C, B value 3950 K; resistance falls as it warms | Typical for the MF52 10 kΩ 3950 thermistors in kits; no datasheet page checked yet |
| The B-value formula for °C in `agent.json` | The standard B-parameter equation, 1/T = 1/T0 + ln(R/R0)/B (T0 = 298.15 K, R0 = 10 kΩ) |
| Range about −20 to 100 °C, about ±1 °C | Typical for a 1 % 10 kΩ NTC with the B formula; not measured |
| The bare epoxy bead isn't waterproof | Typical; a waterproof probe is a different part |

The part described is the most common version (MF52 bead, 10 kΩ, B 3950), chosen 17/11/2026.
Current: at most about 3.3 V ÷ 10 kΩ = 0.33 mA; at that power it barely warms itself.

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
