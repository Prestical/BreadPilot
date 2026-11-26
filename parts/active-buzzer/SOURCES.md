# Active buzzer module (MH-FMD type, 3 pins): sources

| Fact | Source |
|---|---|
| Pins GND, I/O, VCC; on while I/O is LOW (a PNP stage), like the passive module | Typical for MH-FMD buzzer modules; the passive module's board wiring was checked on a real module (`parts/passive-buzzer`, 11/11/2026); this active one wasn't |
| VCC from 3V3 only (`maxSafeVoltage`) | Follows from the line above: from 5 V a 3.3 V HIGH can't switch a PNP stage off |
| One fixed tone of about 2.3 kHz; about 30 mA while sounding | Typical values for small active buzzers; not measured |

The part described is the 3-pin module twin of the passive buzzer module, chosen 17/11/2026 (a bare 2-leg active buzzer would need a transistor driver: phase 17.5).

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
