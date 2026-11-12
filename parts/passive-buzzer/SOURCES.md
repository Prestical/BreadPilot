# Passive buzzer module (MH-FMD, 3 pins): sources

| Fact | Source |
|---|---|
| A passive buzzer needs a PWM signal; 2- or 3-pin modules; best between 1 and 5 kHz | robotistan.com product page "Passive Buzzer Module" (read 11/11/2026) |
| Pins GND, I/O, VCC from top to bottom; marked MH-FMD | Checked on a real module (11/11/2026) |
| On while I/O is LOW (a PNP stage: the transistor's 2-leg side connects to VCC and I/O) | Read from the module's board wiring (11/11/2026); consistent with the hardware test below |
| VCC from 3V3 only (`maxSafeVoltage`) | Follows from the line above: from 5 V a 3.3 V HIGH can't switch a PNP stage off |
| VCC range 3.3-5 V; about 30 mA while sounding | Typical values (no datasheet for this module); listed as unverified |

No datasheet: the shop links none for this module.

Tested on a Raspberry Pi Pico 2 W (11/11/2026) with VCC from 3.3 V: a melody project worked as expected.
The quiet-state supply current wasn't measured, so "on while LOW" still rests on the module's wiring.

Reviewed: 11/11/2026.
