# MicroPython v1.29.0 source files (reference for "Build for Pico")

Downloaded on 21/10/2026 with the user's OK from
`https://raw.githubusercontent.com/micropython/micropython/v1.29.0/ports/rp2/<path>` (MIT license).

| Saved as | Path in the MicroPython repo | Used for |
|---|---|---|
| `boards__RPI_PICO2_W__mpconfigboard.cmake` | `boards/RPI_PICO2_W/mpconfigboard.cmake` | `MICROPY_HW_FLASH_STORAGE_BYTES = 2621440` (4 MB − 1.5 MB) |
| `boards__RPI_PICO2_W__mpconfigboard.h` | `boards/RPI_PICO2_W/mpconfigboard.h` | board name, networking |
| `rp2_flash.c` | `rp2_flash.c` | filesystem base = flash size − storage bytes; 4096-byte blocks; binary-info block device |
| `modules___boot.py` | `modules/_boot.py` | mounts `vfs.VfsLfs2(rp2.Flash(), progsize=256)`, formats if mounting fails |
| `mpconfigport.h` | `mpconfigport.h` | default storage size for other boards |

Also checked (read, not saved): `lib/littlefs/lfs2.h` = LittleFS 2.11, disk format 2.1.
