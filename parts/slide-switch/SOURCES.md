# Slide switch (IC206, 3 legs): sources

| Fact | Source |
|---|---|
| 3 legs in a row, straight down ("180 degree"), a single slider joining the middle leg to one outer leg or the other | robotistan.com product page "IC206 180 Degree Sliding Switch" (photo; the page has no text specs), read 11/11/2026 |
| The legs fit next-to-each-other breadboard holes | The user, with their own switch (11/11/2026) |
| Read with the Pico's internal pull-up, the middle leg on the pin and one outer leg on GND | Same as the push button (`parts/button-6mm`): a contact to ground, `Pin.PULL_UP` |

No datasheet: the shop links none and the switch has no part number beyond "IC206". No electrical
rating is used (the Pico's pull-up current is a few tens of microamps).

Reviewed: by the user, 11/11/2026 (written by Claude the same day).

3D shape (`view.json`): the body and slider sizes are those of common small slide switches, not
measured on the user's switch.
