// "Build for Pico": the real MicroPython v1.29.0 firmware + a LittleFS image made by the real
// littlefs WebAssembly, assembled into one UF2, checked block by block, then (when littlefs-python
// is available) mounted by LittleFS 2.11 exactly like MicroPython does.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import littlefs from "littlefs";
import { parseUf2, SH1106_DRIVER_FILE } from "./picoHelpers";
import { assemblePicoUf2, FIRMWARE, sha256Hex } from "../src/pico/build";
import type { LittleFsModule } from "../src/pico/fsImage";

const ROOT = new URL("../../../", import.meta.url);
const firmware = new Uint8Array(readFileSync(new URL(`data/firmware/${FIRMWARE.file}`, ROOT)));
const MAIN = "from machine import Pin\nimport time\n\nled = Pin(16, Pin.OUT)\n\nwhile True:\n    led.toggle()\n    time.sleep(0.5)\n";
let lfsm: LittleFsModule;

beforeAll(async () => {
  const wasmBinary = readFileSync(new URL("node_modules/littlefs/dist/littlefs.wasm", ROOT));
  lfsm = (await littlefs({ wasmBinary })) as LittleFsModule;
});

describe("Build for Pico (UF2)", () => {
  it("uses exactly the pinned official firmware (SHA-256 in data/firmware/SOURCE.md)", async () => {
    const source = readFileSync(new URL("data/firmware/SOURCE.md", ROOT), "utf8");
    expect(source).toContain(FIRMWARE.sha256);
    expect(await sha256Hex(firmware)).toBe(FIRMWARE.sha256);
    // One changed byte is caught.
    const tampered = firmware.slice();
    tampered[1000] = tampered[1000]! ^ 1;
    expect(await sha256Hex(tampered)).not.toBe(FIRMWARE.sha256);
  });

  it("reads MicroPython's filesystem location from the firmware itself", () => {
    const { info } = assemblePicoUf2(lfsm, firmware, [{ name: "main.py", content: MAIN }]);
    expect(info).toMatchObject({ family: 0xe48bff59, fs: { name: "MicroPython", address: 0x10180000, size: 2621440 }, programName: "MicroPython" });
    expect(info.end).toBeLessThan(info.fs.address);
  });

  it("keeps every firmware block, adds the filesystem pages, and numbers the main group consistently", () => {
    const files = [{ name: "main.py", content: MAIN }, SH1106_DRIVER_FILE];
    const build = assemblePicoUf2(lfsm, firmware, files);
    const before = parseUf2(firmware);
    const after = parseUf2(build.uf2);
    expect(after.length).toBe(before.length + build.fsPages);
    // The RP2350 boot-workaround block (family 0xe48bff57) is untouched and stays first.
    expect(after[0]).toEqual(before[0]);
    // Firmware data and addresses are unchanged.
    const main = after.filter((b) => b.family === 0xe48bff59);
    before.filter((b) => b.family === 0xe48bff59).forEach((b, i) => {
      expect(main[i]!.address).toBe(b.address);
      expect(main[i]!.data).toEqual(b.data);
    });
    // One group: blockNo 0..n-1, numBlocks n, all 256-byte pages with the family flag.
    expect(main.map((b) => b.blockNo)).toEqual(main.map((_, i) => i));
    expect(new Set(main.map((b) => b.numBlocks))).toEqual(new Set([main.length]));
    expect(main.every((b) => b.size === 256 && (b.flags & 0x2000) !== 0)).toBe(true);
    // Filesystem pages lie inside the filesystem, and the superblock pair (2 x 4096) is always written.
    const fsPages = main.filter((b) => b.address >= 0x10180000);
    expect(fsPages.every((b) => b.address + 256 <= 0x10180000 + 2621440)).toBe(true);
    expect(fsPages.filter((b) => b.address < 0x10180000 + 8192)).toHaveLength(32);
    // Small: the empty part of the 2.5 MB filesystem isn't in the file.
    expect(build.uf2.length).toBeLessThan(firmware.length + 64 * 1024);
  });

  it("refuses file names LittleFS paths can't hold", () => {
    expect(() => assemblePicoUf2(lfsm, firmware, [{ name: "../main.py", content: MAIN }])).toThrow(/Bad file name/);
  });

  const python = spawnSync("python3", ["-c", "import littlefs"], { env: { ...process.env, PYTHONPATH: process.env.LITTLEFS_PYTHON ?? "" } }).status === 0;
  it.skipIf(!python)("LittleFS 2.11 (as in MicroPython v1.29.0) mounts it over an old filesystem and reads every file", () => {
    const files = [
      { name: "main.py", content: MAIN },
      SH1106_DRIVER_FILE,
      { name: "big.py", content: Array.from({ length: 900 }, (_, i) => `# line ${i}: ${"x".repeat(i % 40)}`).join("\n") + "\n" }, // spans several blocks
    ];
    const build = assemblePicoUf2(lfsm, firmware, files);
    const dir = mkdtempSync(join(tmpdir(), "breadpilot-uf2-"));
    writeFileSync(join(dir, "build.uf2"), build.uf2);
    writeFileSync(join(dir, "spec.json"), JSON.stringify({ addr: build.info.fs.address, size: build.info.fs.size, files: Object.fromEntries(files.map((f) => [f.name, f.content])) }));
    const r = spawnSync("python3", [new URL("./lfs_image_check.py", import.meta.url).pathname, join(dir, "build.uf2"), join(dir, "spec.json")], {
      encoding: "utf8",
      env: { ...process.env, PYTHONPATH: process.env.LITTLEFS_PYTHON ?? "" },
    });
    rmSync(dir, { recursive: true, force: true });
    expect(r.stderr).toBe("");
    expect(r.stdout).toMatch(/^ok \d+ \['big\.py', 'main\.py', 'sh1106\.py'\]/);
  });
});

import { uf2Name } from "../src/steps/PicoBuild";

describe("UF2 file name", () => {
  it("is a safe version of the project title", () => {
    expect(uf2Name("Wi-Fi Network Scanner with OLED (Bars, Top 5)")).toBe("wi-fi-network-scanner-with-oled-bars-top-pico2w.uf2");
    expect(uf2Name("Blinking LED with a really long name that ends - here")).toBe("blinking-led-with-a-really-long-name-tha-pico2w.uf2");
    expect(uf2Name("A".repeat(39) + " B")).toBe(`${"a".repeat(39)}-pico2w.uf2`); // no double dash after cutting
    expect(uf2Name("???")).toBe("project-pico2w.uf2");
  });
});
