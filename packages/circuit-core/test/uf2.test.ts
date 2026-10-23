import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildUf2, firmwareInfo, parseUf2, Uf2Error, writeUf2 } from "../src/uf2";

const firmware = new Uint8Array(readFileSync(new URL("../../../data/firmware/RPI_PICO2_W-20260824-v1.29.0.uf2", import.meta.url)));

describe("UF2", () => {
  it("parses the official firmware and writes it back byte for byte", () => {
    const blocks = parseUf2(firmware);
    expect(blocks).toHaveLength(3465);
    expect(Buffer.compare(writeUf2(blocks), firmware)).toBe(0);
    // The boot-workaround block carries UF2 extension tags after its data; they must survive.
    expect(blocks[0]!.flags & 0x8000).toBe(0x8000);
  });

  it("finds the firmware's family, end and filesystem (binary info)", () => {
    const info = firmwareInfo(parseUf2(firmware));
    expect(info.family).toBe(0xe48bff59);
    expect(info.fs).toEqual({ name: "MicroPython", address: 0x10180000, size: 2621440 });
    expect(info.programName).toBe("MicroPython");
    expect(info.end).toBeGreaterThan(0x10000000);
    expect(info.end).toBeLessThan(0x10180000);
  });

  it("rejects files that aren't UF2", () => {
    expect(() => parseUf2(new Uint8Array(100))).toThrow(Uf2Error);
    expect(() => parseUf2(new Uint8Array(512))).toThrow(/bad magic/);
  });

  it("an image of the wrong size is refused", () => {
    expect(() => buildUf2(firmware, new Uint8Array(4096).fill(0xff), { fsBlockSize: 4096 })).toThrow(/image is 4096 bytes, but the firmware's filesystem is 2621440 bytes/);
  });

  it("an empty (erased) image adds only the superblock pair, and pages carry the image bytes", () => {
    const image = new Uint8Array(2621440).fill(0xff);
    image.set([1, 2, 3], 4096 * 10 + 256 * 3); // one page of data in block 10
    const { uf2, fsPages } = buildUf2(firmware, image, { fsBlockSize: 4096 });
    expect(fsPages).toBe(32 + 1);
    const page = parseUf2(uf2).find((b) => b.address === 0x10180000 + 4096 * 10 + 256 * 3)!;
    expect([...page.data.subarray(0, 4)]).toEqual([1, 2, 3, 0xff]);
  });
});
