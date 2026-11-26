# Ball tilt switch (SW-520D): sources

| Fact | Source |
|---|---|
| Two legs; a metal ball closes the contact while the switch stands upright and opens it when tilted | Typical for SW-520D ball tilt switches (the usual kit part); no datasheet page checked yet |
| Read with the Pico's internal pull-up, one leg on the pin and the other on GND | Same as the push button (`parts/button-6mm`): a contact to ground, `Pin.PULL_UP` |
| The ball bounces while shaken, so readings flicker | Typical for ball tilt switches |

The part described is the most common version (SW-520D in starter kits), chosen 17/11/2026.
No electrical rating is used: the Pico's pull-up current is a few tens of microamps.

Not tried on hardware yet: every fact above is a typical value (`typical`), shown as unverified.
