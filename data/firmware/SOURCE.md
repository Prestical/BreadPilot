# MicroPython firmware used by "Build for Pico"

| File | `RPI_PICO2_W-20260824-v1.29.0.uf2` |
|---|---|
| What | Official MicroPython v1.29.0 (2026-08-24, latest stable on 21/10/2026) for the Raspberry Pi Pico 2 W |
| From | https://micropython.org/download/RPI_PICO2_W/ → https://micropython.org/resources/firmware/RPI_PICO2_W-20260824-v1.29.0.uf2 |
| SHA-256 | `c49c7ed93eb7eeaaa78436b17bd4329e5d4ccbaebc1e79503ad75e0a29c4530e` |
| Size | 1,774,080 bytes (3465 UF2 blocks) |
| License | MicroPython is MIT-licensed (https://github.com/micropython/micropython/blob/master/LICENSE) |
| Downloaded | 21/10/2026, with the user's OK |

Read from the file itself (tests in `packages/circuit-core/test/uf2.test.ts`): one boot-workaround
block of family `0xe48bff57` (with UF2 extension tags), then 3464 blocks of family `0xe48bff59`
(RP2350 Arm) from `0x10000000`; binary info declares the "MicroPython" filesystem at `0x10180000`,
2,621,440 bytes (640 × 4096).

To update: download a newer stable build, add it here, change `FIRMWARE` in
`apps/web/src/pico/build.ts`, and run the tests (the layout is read from the firmware, so it adapts).
