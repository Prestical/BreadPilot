# Passive buzzer module (MH-FMD, 3 pins): sources

| Fact | Source |
|---|---|
| A passive buzzer needs a PWM signal; 2- or 3-pin modules; best between 1 and 5 kHz | robotistan.com product page "Passive Buzzer Module" (read 11/11/2026) |
| Pins GND, I/O, VCC from top to bottom; marked MH-FMD | The user's module (11/11/2026) |
| On while I/O is LOW (a PNP stage: the transistor's 2-leg side connects to VCC and I/O) | Claude's reading of the user's description (11/11/2026); to confirm on the real module (M15 step 15.7) |
| VCC from 3V3 only (`maxSafeVoltage`) | Follows from the line above: from 5 V a 3.3 V HIGH can't switch a PNP stage off |
| VCC range 3.3-5 V; about 30 mA while sounding | Typical values (no datasheet for this module); listed as unverified |

No datasheet: the shop links none for this module.

Tried on the user's Pico 2 W (11/11/2026): a BreadPilot project (melody on a button press, an LED per
note, VCC from 3V3) worked as expected. The supply current in the quiet state wasn't measured, so the
"on while LOW" reading still rests on the module's wiring.

Reviewed: by the user, 11/11/2026 (written by Claude the same day).
