# MicroPython v1.29.0 source files (reference for "Build for Pico")

Downloaded on 21/10/2026 with the user's OK from
`https://raw.githubusercontent.com/micropython/micropython/v1.29.0/<path>` (MIT license); the
first five files are under `ports/rp2/`, the drawing files under `docs/` and `extmod/` as listed.

| Saved as | Path in the MicroPython repo | Used for |
|---|---|---|
| `boards__RPI_PICO2_W__mpconfigboard.cmake` | `boards/RPI_PICO2_W/mpconfigboard.cmake` | `MICROPY_HW_FLASH_STORAGE_BYTES = 2621440` (4 MB − 1.5 MB) |
| `boards__RPI_PICO2_W__mpconfigboard.h` | `boards/RPI_PICO2_W/mpconfigboard.h` | board name, networking |
| `rp2_flash.c` | `rp2_flash.c` | filesystem base = flash size − storage bytes; 4096-byte blocks; binary-info block device |
| `modules___boot.py` | `modules/_boot.py` | mounts `vfs.VfsLfs2(rp2.Flash(), progsize=256)`, formats if mounting fails |
| `mpconfigport.h` | `mpconfigport.h` | default storage size for other boards |
| `docs__library__framebuf.rst` | `docs/library/framebuf.rst` | drawing on displays: `FrameBuffer` methods (fill, pixel, hline, vline, line, rect with fill flag, ellipse, poly, text with the fixed 8x8 font, scroll, blit), formats (MONO_VLSB …). Downloaded 07/11/2026 with the user's OK |
| `extmod__modframebuf.c` | `extmod/modframebuf.c` | what the v1.29.0 firmware really has: the method table also keeps `fill_rect` (not in the docs any more, still works). Downloaded 07/11/2026 with the user's OK |

| `extmod__modmachine.c` | `extmod/modmachine.c` | names of the `machine` module (`machine_module_globals_table`, with the build flags that switch them on; rp2's values in `mpconfigport.h`). Code check C015 (`MACHINE_MODULE_NAMES`). Downloaded 08/11/2026 with the user's OK |
| `ports__rp2__modmachine.c` | `ports/rp2/modmachine.c` | the Pico port's extra `machine` names (`MICROPY_PY_MACHINE_EXTRA_GLOBALS`: Pin, RTC, Timer, PWRON_RESET, WDT_RESET). Downloaded 08/11/2026 with the user's OK |

Also checked (read, not saved): `lib/littlefs/lfs2.h` = LittleFS 2.11, disk format 2.1.
