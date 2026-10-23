# Third-party notices

These parts of the repository are not covered by BreadPilot's Apache-2.0 license (`LICENSE`).
They keep their own licenses and owners.

| What | Where | Owner | License |
|---|---|---|---|
| MicroPython v1.29.0 firmware for the Pico 2 W | `data/firmware/RPI_PICO2_W-20260824-v1.29.0.uf2` | Damien P. George and the MicroPython contributors | MIT, see below |
| MicroPython rp2 port source files (read as facts) | `docs/software/micropython-v1.29.0/` | Damien P. George and the MicroPython contributors | MIT (notice inside each file) |
| littlefs WebAssembly build (npm `littlefs` 0.1.0) | installed by npm | Uri Shaked / Wokwi | ISC |
| Raspberry Pi Pico 2 W datasheet and pinout | `docs/hardware/pico-2-w/` | Raspberry Pi Ltd | Their own terms; download from raspberrypi.com |
| SH1106 datasheet | `docs/hardware/components/SH1106.pdf` | Sino Wealth | Their own terms |
| npm packages (React, three.js, Fastify, …) | installed by npm | Their authors | See each package's license |

The datasheets are included for reference while the documentation search is set up. If you share
this project, check their owners' terms, or replace them with links to the official downloads.

## MicroPython license (MIT)

The MicroPython firmware is distributed under the MIT license. Its full copyright notice is in the
LICENSE file of the MicroPython repository at tag v1.29.0:
https://github.com/micropython/micropython/blob/v1.29.0/LICENSE

> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
> associated documentation files (the "Software"), to deal in the Software without restriction,
> including without limitation the rights to use, copy, modify, merge, publish, distribute,
> sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all copies or
> substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
> NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
> NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
> DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
> OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
