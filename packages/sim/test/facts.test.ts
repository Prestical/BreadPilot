// M18 18.7a: the WebAssembly engine the simulator runs. If the package changes, these tests say so.

import { fileURLToPath } from "node:url";
import { loadMicroPython } from "@micropython/micropython-webassembly-pyscript";
import { describe, expect, it } from "vitest";
import { ENGINE } from "../src/index";

describe("the WebAssembly engine", () => {
  const load = async () => {
    const url = fileURLToPath(new URL(`../../../node_modules/${ENGINE.package}/${ENGINE.wasm}`, import.meta.url));
    let out = "";
    const mp = await loadMicroPython({ url, stdout: (s: string) => (out += s + "\n"), linebuffer: true });
    return { mp, out: () => out };
  };

  it("is MicroPython 1.29.0 with the real framebuf, and without machine/rp2 (the simulator adds them)", async () => {
    const { mp, out } = await load();
    mp.runPython(`
import sys
print(sys.implementation.version[:3])
for m in ("framebuf", "struct", "machine", "rp2", "_onewire"):
    try:
        __import__(m); print(m, "yes")
    except ImportError:
        print(m, "no")
`);
    expect(out()).toBe("(1, 29, 0)\nframebuf yes\nstruct yes\nmachine no\nrp2 no\n_onewire no\n");
  });

  it("a module put in sys.modules replaces the built-in one (how the virtual clock goes in)", async () => {
    const { mp, out } = await load();
    mp.runPython(`
import sys
class Clock:
    now = 0
    def sleep(self, s): Clock.now += int(s * 1000)
    def ticks_ms(self): return Clock.now
sys.modules["time"] = Clock()
import time
time.sleep(300)
print(time.ticks_ms())
`);
    expect(out()).toBe("300000\n");
  });
});
