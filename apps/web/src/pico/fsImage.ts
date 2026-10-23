// LittleFS image with the project's files, in exactly the format MicroPython mounts on the Pico:
// _boot.py (docs/software/micropython-v1.29.0/modules___boot.py) uses vfs.VfsLfs2(bdev, progsize=256)
// on rp2.Flash() (4096-byte blocks). The image is made by the reference LittleFS compiled to
// WebAssembly (npm "littlefs" 0.1.0, Wokwi; LittleFS 2.4, disk format 2.0, which MicroPython's
// LittleFS 2.11 mounts). tests: apps/web/test/picoBuild.test.ts (+ a littlefs-python 2.11 check).

/** The parts of the littlefs-wasm module we use (its published build exports only these). */
export interface LittleFsModule {
  HEAPU8: Uint8Array;
  HEAPU32: Uint32Array;
  addFunction(fn: (...args: number[]) => number, signature: string): number;
  cwrap(name: string, ret: null, args: string[]): (...args: unknown[]) => void;
  _new_lfs(): number;
  _new_lfs_config(read: number, prog: number, erase: number, sync: number, blockCount: number, blockSize: number): number;
  _lfs_format(lfs: number, cfg: number): number;
  _lfs_mount(lfs: number, cfg: number): number;
  _lfs_unmount(lfs: number): number;
  _free(ptr: number): void;
}

export interface FsFile {
  name: string;
  content: string;
}

export interface FsOptions {
  blockSize: number;
  blockCount: number;
  /** MicroPython's progsize (256). */
  progSize: number;
}

export class FsImageError extends Error {}

// lfs_config field offsets in littlefs-wasm's 32-bit build (checked against the values the package
// sets before we change anything: read 256, prog 32, block size, block count, cycles 100, cache 1024).
const CFG = { readSize: 20, progSize: 24, blockSize: 28, blockCount: 32, blockCycles: 36, cacheSize: 40 };

export function makeFsImage(lfsm: LittleFsModule, files: FsFile[], opts: FsOptions): Uint8Array {
  const { blockSize, blockCount, progSize } = opts;
  const flash = new Uint8Array(blockSize * blockCount).fill(0xff);
  let badProg = false;
  const read = lfsm.addFunction((_c, block, off, buf, size) => {
    lfsm.HEAPU8.set(flash.subarray(block * blockSize + off, block * blockSize + off + size), buf);
    return 0;
  }, "iiiiii");
  const prog = lfsm.addFunction((_c, block, off, buf, size) => {
    if (off % progSize || size % progSize) badProg = true;
    flash.set(lfsm.HEAPU8.subarray(buf, buf + size), block * blockSize + off);
    return 0;
  }, "iiiiii");
  const erase = lfsm.addFunction((_c, block) => {
    flash.fill(0xff, block * blockSize, (block + 1) * blockSize);
    return 0;
  }, "iii");
  const sync = lfsm.addFunction(() => 0, "ii");

  const cfg = lfsm._new_lfs_config(read, prog, erase, sync, blockCount, blockSize);
  const lfs = lfsm._new_lfs();
  try {
    const field = (off: number) => lfsm.HEAPU32[(cfg + off) >> 2]!;
    // Only patch prog_size if the struct is laid out as expected; otherwise refuse.
    const expected = [256, 32, blockSize, blockCount, 100, 1024];
    const actual = [CFG.readSize, CFG.progSize, CFG.blockSize, CFG.blockCount, CFG.blockCycles, CFG.cacheSize].map(field);
    if (actual.join() !== expected.join()) throw new FsImageError(`Unexpected littlefs config layout (${actual.join(", ")}).`);
    lfsm.HEAPU32[(cfg + CFG.progSize) >> 2] = progSize;

    if (lfsm._lfs_format(lfs, cfg) !== 0) throw new FsImageError("LittleFS couldn't format the image.");
    if (lfsm._lfs_mount(lfs, cfg) !== 0) throw new FsImageError("LittleFS couldn't mount the new image.");
    const write = lfsm.cwrap("lfs_write_file", null, ["number", "string", "array", "number"]);
    for (const f of files) {
      if (!/^[\w.-]{1,64}$/.test(f.name)) throw new FsImageError(`Bad file name "${f.name}".`);
      const bytes = new TextEncoder().encode(f.content);
      write(lfs, f.name, bytes, bytes.length);
    }
    if (lfsm._lfs_unmount(lfs) !== 0) throw new FsImageError("LittleFS couldn't finish the image.");
  } finally {
    lfsm._free(lfs);
    lfsm._free(cfg);
  }
  if (badProg) throw new FsImageError(`LittleFS wrote data not aligned to ${progSize} bytes.`);
  checkImage(flash, files, blockSize);
  return flash;
}

/**
 * The published littlefs-wasm can't read files back and its write call returns no error, so we
 * check what we can: the superblock pair is there and every file's content is in the image.
 */
function checkImage(flash: Uint8Array, files: FsFile[], blockSize: number): void {
  const text = (start: number, end: number) => new TextDecoder("latin1").decode(flash.subarray(start, end));
  const superblocks = text(0, 2 * blockSize);
  if (!superblocks.includes("littlefs")) throw new FsImageError("The image has no LittleFS superblock.");
  const all = text(0, flash.length);
  for (const f of files) {
    if (!superblocks.includes(f.name) && !all.includes(f.name)) throw new FsImageError(`${f.name} isn't in the image.`);
    // File bytes are stored in order within a block (later blocks of a big file start with small
    // pointer headers), so check its start, and its end only when the whole file fits in one block.
    const bytes = new TextEncoder().encode(f.content);
    const pieces = [bytes.subarray(0, 48)];
    if (bytes.length <= blockSize - 64) pieces.push(bytes.subarray(Math.max(0, bytes.length - 48)));
    for (const piece of pieces) {
      if (piece.length && !all.includes(new TextDecoder("latin1").decode(piece))) throw new FsImageError(`${f.name} wasn't written completely (no space left?).`);
    }
  }
}
