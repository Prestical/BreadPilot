// UF2 files for "Build for Pico" (Milestone 6, user request 21/10/2026): the official MicroPython
// firmware plus a filesystem holding main.py (and driver files), as ONE file the user drops on the
// Pico 2 W in BOOTSEL mode. Pure code, no dependencies; the filesystem image itself is made by the
// caller (LittleFS, see apps/web/src/pico/).
//
// Facts used, all read from the firmware file itself (data/firmware/RPI_PICO2_W-*-v1.29.0.uf2) and
// MicroPython's source (docs/software/micropython-v1.29.0/):
//   - UF2 block: 512 bytes, magics 0x0A324655 / 0x9E5D5157 / 0x0AB16F30, 256-byte payloads,
//     flag 0x2000 = family ID present.
//   - The firmware is one group of family 0xe48bff59 (RP2350 Arm) at 0x10000000, preceded by a
//     one-block group of family 0xe48bff57 ("absolute", the RP2350 boot workaround), kept as is.
//   - MicroPython declares its filesystem in the firmware's binary info (type 7, block device
//     "MicroPython"): 0x10180000, 2621440 bytes = 640 blocks of 4096 (rp2_flash.c), mounted by
//     _boot.py as LittleFS v2 with progsize=256.

export const UF2 = { magic0: 0x0a324655, magic1: 0x9e5d5157, magicEnd: 0x0ab16f30, blockBytes: 512, payload: 256, flagFamily: 0x2000, flagExtensionTags: 0x8000 } as const;
const BI_HEADER = 0x7188ebf2;
const BI_FOOTER = 0xe71aa390;
const BI_TYPE_ID_AND_STRING = 6;
const BI_TYPE_BLOCK_DEVICE = 7;
const BI_ID_PROGRAM_NAME = 0x02031c86;
const BI_ID_PROGRAM_VERSION = 0x5360b3ab;

export interface Uf2Block {
  flags: number;
  address: number;
  size: number;
  blockNo: number;
  numBlocks: number;
  family: number;
  /** The block's data (`size` bytes). */
  data: Uint8Array;
  /**
   * The whole 476-byte payload area as read. Bytes after `data` can hold UF2 extension tags
   * (flag 0x8000, e.g. on the firmware's RP2350 boot-workaround block), so they're written back as is.
   */
  payload?: Uint8Array;
}

export class Uf2Error extends Error {}

export function parseUf2(bytes: Uint8Array): Uf2Block[] {
  if (bytes.length === 0 || bytes.length % UF2.blockBytes) throw new Uf2Error("Not a UF2 file (its size isn't a multiple of 512 bytes).");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const blocks: Uf2Block[] = [];
  for (let off = 0; off < bytes.length; off += UF2.blockBytes) {
    const u32 = (i: number) => view.getUint32(off + i, true);
    if (u32(0) !== UF2.magic0 || u32(4) !== UF2.magic1 || u32(508) !== UF2.magicEnd) throw new Uf2Error(`UF2 block ${off / UF2.blockBytes} has bad magic numbers.`);
    const size = u32(16);
    if (size > 476) throw new Uf2Error(`UF2 block ${off / UF2.blockBytes} claims ${size} bytes of data.`);
    const payload = bytes.slice(off + 32, off + 508);
    blocks.push({ flags: u32(8), address: u32(12), size, blockNo: u32(20), numBlocks: u32(24), family: u32(28), data: payload.subarray(0, size), payload });
  }
  return blocks;
}

export function writeUf2(blocks: Uf2Block[]): Uint8Array {
  const out = new Uint8Array(blocks.length * UF2.blockBytes);
  const view = new DataView(out.buffer);
  blocks.forEach((b, i) => {
    const off = i * UF2.blockBytes;
    [UF2.magic0, UF2.magic1, b.flags, b.address, b.size, b.blockNo, b.numBlocks, b.family].forEach((v, k) => view.setUint32(off + k * 4, v >>> 0, true));
    if (b.payload) out.set(b.payload, off + 32);
    out.set(b.data.subarray(0, b.size), off + 32);
    view.setUint32(off + 508, UF2.magicEnd, true);
  });
  return out;
}

export interface FirmwareInfo {
  /** Family of the firmware's main block group (RP2350 Arm: 0xe48bff59). */
  family: number;
  /** End address of the firmware's main group (exclusive). */
  end: number;
  /** MicroPython's filesystem, from the firmware's own binary info. */
  fs: { name: string; address: number; size: number };
  programName?: string;
  programVersion?: string;
}

/** Reads the firmware's main family and MicroPython's filesystem location from its binary info. */
export function firmwareInfo(blocks: Uf2Block[]): FirmwareInfo {
  const counts = new Map<number, number>();
  for (const b of blocks) counts.set(b.family, (counts.get(b.family) ?? 0) + 1);
  const family = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (family === undefined) throw new Uf2Error("The firmware UF2 is empty.");
  const main = blocks.filter((b) => b.family === family);
  const base = Math.min(...main.map((b) => b.address));
  const end = Math.max(...main.map((b) => b.address + b.size));
  const flat = new Uint8Array(end - base);
  for (const b of main) flat.set(b.data, b.address - base);
  const view = new DataView(flat.buffer);
  const u16 = (addr: number) => view.getUint16(addr - base, true);
  const u32 = (addr: number) => view.getUint32(addr - base, true);
  const inImage = (addr: number, n = 4) => addr >= base && addr + n <= end;
  const cstr = (addr: number) => {
    if (!inImage(addr, 1)) return "";
    let s = "";
    for (let a = addr; inImage(a, 1) && flat[a - base] !== 0 && s.length < 64; a++) s += String.fromCharCode(flat[a - base]!);
    return s;
  };

  // Binary info header: [0x7188ebf2, start of entry pointers, end, mapping table, 0xe71aa390]
  let header = -1;
  for (let a = base; a + 20 <= end && a < base + 0x1000; a += 4) {
    if (u32(a) === BI_HEADER && u32(a + 16) === BI_FOOTER) {
      header = a;
      break;
    }
  }
  if (header < 0) throw new Uf2Error("The firmware has no binary info, so the filesystem location is unknown.");
  const start = u32(header + 4);
  const stop = u32(header + 8);
  let fs: FirmwareInfo["fs"] | undefined;
  let programName: string | undefined;
  let programVersion: string | undefined;
  for (let p = start; p < stop && inImage(p); p += 4) {
    const entry = u32(p);
    if (!inImage(entry, 16)) continue;
    const type = u16(entry);
    if (type === BI_TYPE_BLOCK_DEVICE) {
      const name = cstr(u32(entry + 4));
      if (!fs || name === "MicroPython") fs = { name, address: u32(entry + 8), size: u32(entry + 12) };
    } else if (type === BI_TYPE_ID_AND_STRING) {
      const id = u32(entry + 4);
      if (id === BI_ID_PROGRAM_NAME) programName = cstr(u32(entry + 8));
      if (id === BI_ID_PROGRAM_VERSION) programVersion = cstr(u32(entry + 8));
    }
  }
  if (!fs) throw new Uf2Error("The firmware doesn't declare a filesystem (no block device in its binary info).");
  if (fs.address < end) throw new Uf2Error("The firmware's filesystem overlaps the firmware itself.");
  return { family, end, fs, ...(programName ? { programName } : {}), ...(programVersion ? { programVersion } : {}) };
}

export interface BuildOptions {
  /** LittleFS block size (MicroPython rp2: 4096). The first two blocks (the superblock pair) are always written. */
  fsBlockSize: number;
}

/**
 * Firmware + filesystem image → one UF2. The image's 256-byte pages are added to the firmware's
 * main block group, which is renumbered so all its blocks agree on numBlocks and count up from 0.
 * Pages that are all 0xFF (erased) are skipped, except in the first two filesystem blocks: LittleFS
 * keeps its superblock there as a pair, and an old copy left on the Pico must be overwritten.
 */
export function buildUf2(firmware: Uint8Array, fsImage: Uint8Array, opts: BuildOptions): { uf2: Uint8Array; info: FirmwareInfo; fsPages: number } {
  const blocks = parseUf2(firmware);
  const info = firmwareInfo(blocks);
  if (fsImage.length !== info.fs.size) throw new Uf2Error(`The filesystem image is ${fsImage.length} bytes, but the firmware's filesystem is ${info.fs.size} bytes.`);
  if (info.fs.size % opts.fsBlockSize) throw new Uf2Error("The filesystem size isn't a whole number of blocks.");

  const pages: Uf2Block[] = [];
  for (let off = 0; off < fsImage.length; off += UF2.payload) {
    const data = fsImage.subarray(off, off + UF2.payload);
    const superblockPair = off < 2 * opts.fsBlockSize;
    if (!superblockPair && data.every((x) => x === 0xff)) continue;
    pages.push({ flags: UF2.flagFamily, address: info.fs.address + off, size: UF2.payload, blockNo: 0, numBlocks: 0, family: info.family, data: data.slice() });
  }

  const main = blocks.filter((b) => b.family === info.family);
  const total = main.length + pages.length;
  let n = 0;
  const out = [...blocks, ...pages].map((b) => (b.family === info.family ? { ...b, blockNo: n++, numBlocks: total } : b));
  return { uf2: writeUf2(out), info, fsPages: pages.length };
}
