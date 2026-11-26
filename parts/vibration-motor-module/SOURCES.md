# Vibration motor module (coin motor, 3 pins): sources

| Fact | Source |
|---|---|
| Pins IN, VCC, GND; a coin vibration motor switched by an NPN transistor (with its flyback diode) on the module; IN HIGH = on | Typical for the vibration motor modules in kits; no datasheet page checked yet |
| Supply 3.3-5 V; about 80 mA while running | Typical; not measured. From 3V3 it stays well under the Pico's 300 mA 3V3 limit |

The part described is the most common 3-pin module, chosen 19/11/2026 (a bare motor on wires would need its own transistor: a later phase).

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
