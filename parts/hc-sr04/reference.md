# HC-SR04: reference documents

Not in this repository: the datasheet (Elecfreaks) gives no licence to republish it. Get it from the
link and compare the checksum. This pack isn't one the AI can pick yet (it needs wave B engine work:
two pins in one block, 5 V power, a divider on ECHO); its numbers are still marked typical.

| File | Link | Pages used | SHA-256 |
|---|---|---|---|
| HCSR04-datasheet-version-1.pdf | https://www.robotistan.com/Data/EditorFiles/HCSR04-datasheet-version-1.pdf (Elecfreaks "Ultrasonic Ranging Module HC - SR04", linked as "Sensor Datasheet" on the shop page) | 1, 2 | 4ebdc3e1f70d84a1ca856d8fcd7f8b1f9e548a94e4012cd86d14ca0b30543b06 |

Local copy (not committed): `.local/datasheets/hc-sr04/HCSR04-datasheet-version-1.pdf`.
What it gives: 5 V supply, 15 mA, 40 kHz, 2 cm-4 m, 15°, a 10 µs trigger pulse, distance in cm =
echo time in µs / 58, at least 60 ms between measurements (p. 1-2). It doesn't give the ECHO pin's
output voltage.
