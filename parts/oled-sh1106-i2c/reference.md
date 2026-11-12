# 1.3" I2C OLED (SH1106): reference documents

Not in this repository: the Sino Wealth datasheet gives no licence to republish it (removed from
`docs/hardware/components/` on 11/11/2026; it remains in older commits). The app doesn't need it: the
code AI uses the `sh1106.py` driver's API from this pack, and the facts below were read from it once.
The checksum is of the copy these facts were read from; the public link is a copy of the same V2.2
datasheet whose bytes weren't compared.

| File | Link | Pages used | SHA-256 |
|---|---|---|---|
| SH1106.pdf | https://ssd1306.readthedocs.io/en/1.5.0/_downloads/SH1106.pdf (Sino Wealth "SH1106 132 X 64 Dot Matrix OLED/PLED Segment/Common Driver with Controller", V2.2) | 1, 13, 14, 32 | db02ce14e09a1aacbf52ceb43d51ee1a1a14ea45018205ec34f8eb1f90427a45 |

Local copy (not committed): `.local/datasheets/oled-sh1106-i2c/SH1106.pdf`.
