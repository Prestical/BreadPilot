// "Build for Pico": MicroPython firmware + a filesystem with main.py (and driver files) as one UF2.
// Everything here is code; the agent isn't involved. The firmware is the official build, pinned:
// data/firmware/RPI_PICO2_W-20260824-v1.29.0.uf2 (micropython.org).
import { buildUf2, firmwareInfo, parseUf2, type FirmwareInfo } from "@breadpilot/circuit-core";
import { makeFsImage, type FsFile, type LittleFsModule } from "./fsImage";
import DEBUG_RUNNER from "./debug_main.py?raw";

export const FIRMWARE = {
  board: "RPI_PICO2_W",
  version: "v1.29.0",
  file: "RPI_PICO2_W-20260824-v1.29.0.uf2",
  /** From data/firmware/SOURCE.md; checked before every build, so a swapped or damaged file is refused. */
  sha256: "c49c7ed93eb7eeaaa78436b17bd4329e5d4ccbaebc1e79503ad75e0a29c4530e",
} as const;

/** Hex SHA-256 of the bytes (Web Crypto: the browser and Node both have it). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** MicroPython rp2 filesystem settings (rp2_flash.c: 4096-byte blocks; _boot.py: progsize=256). */
export const FS = { blockSize: 4096, progSize: 256 } as const;

export interface PicoBuild {
  uf2: Uint8Array;
  info: FirmwareInfo;
  files: string[];
  fsPages: number;
}

/**
 * The files on the Pico: the debug runner as main.py (MicroPython starts it at power-up; it shows the
 * program's state on the on-board LED and reports errors), the project's code as app.py, and drivers.
 */
export function picoFiles(code: string, drivers: FsFile[]): FsFile[] {
  return [{ name: "main.py", content: DEBUG_RUNNER }, { name: "app.py", content: code }, ...drivers];
}

/** Pure assembly (used by the browser and by tests in Node). */
export function assemblePicoUf2(lfsm: LittleFsModule, firmware: Uint8Array, files: FsFile[]): PicoBuild {
  const info = firmwareInfo(parseUf2(firmware));
  const image = makeFsImage(lfsm, files, { blockSize: FS.blockSize, blockCount: info.fs.size / FS.blockSize, progSize: FS.progSize });
  const { uf2, fsPages } = buildUf2(firmware, image, { fsBlockSize: FS.blockSize });
  return { uf2, info, files: files.map((f) => f.name), fsPages };
}

let cache: Promise<{ lfsm: LittleFsModule; firmware: Uint8Array }> | null = null;

/** Loads the firmware and the LittleFS WebAssembly once (about 1.9 MB, only when the user builds). */
function loadTools(): Promise<{ lfsm: LittleFsModule; firmware: Uint8Array }> {
  cache ??= (async () => {
    const [{ default: littlefs }, { default: wasmUrl }, { default: firmwareUrl }] = await Promise.all([
      import("littlefs"),
      import("littlefs/dist/littlefs.wasm?url"),
      import("../../../../data/firmware/RPI_PICO2_W-20260824-v1.29.0.uf2?url"),
    ]);
    const get = async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Couldn't load ${url} (HTTP ${res.status}).`);
      return new Uint8Array(await res.arrayBuffer());
    };
    const [wasmBinary, firmware] = await Promise.all([get(wasmUrl), get(firmwareUrl)]);
    if ((await sha256Hex(firmware)) !== FIRMWARE.sha256) throw new Error(`The MicroPython firmware file doesn't match its checksum (${FIRMWARE.file}), so nothing was built. Reinstall the app.`);
    // The wasm bytes are passed in, so the module never fetches anything itself.
    const lfsm = (await littlefs({ wasmBinary: wasmBinary.buffer })) as LittleFsModule;
    return { lfsm, firmware };
  })().catch((err: unknown) => {
    cache = null;
    throw err;
  });
  return cache;
}

export async function buildPicoUf2(files: FsFile[]): Promise<PicoBuild> {
  const { lfsm, firmware } = await loadTools();
  return assemblePicoUf2(lfsm, firmware, files);
}
