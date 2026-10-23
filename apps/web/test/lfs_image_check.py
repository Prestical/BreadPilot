# Independent check of a "Build for Pico" UF2 with littlefs-python (LittleFS 2.11, disk format 2.1:
# the same LittleFS version as MicroPython v1.29.0). Started by test/picoBuild.test.ts when
# littlefs-python is importable (dev-only; it isn't part of the app). Prints "ok ..." on success.
#   argv: <uf2 file> <spec.json with addr, size, files{name: content}>
import json
import struct
import sys

from littlefs import LittleFS

uf2_path, spec_path = sys.argv[1], sys.argv[2]
spec = json.load(open(spec_path))
ADDR, SIZE, BS = spec["addr"], spec["size"], 4096
BC = SIZE // BS


def micropython_like():
    # _boot.py: vfs.VfsLfs2(rp2.Flash(), progsize=256); MicroPython's defaults: readsize 32, lookahead 32
    return LittleFS(block_size=BS, block_count=BC, prog_size=256, read_size=32, lookahead_size=32, mount=False)


# 1) Worst case on the real Pico: an older filesystem is already there, written many times so its
#    metadata blocks carry high revision counts. Pages our UF2 skips keep this old data.
old = micropython_like()
old.format()
old.mount()
for i in range(60):
    with old.open("old_%d.py" % (i % 6), "w") as f:
        f.write(("print(%d)\n" % i) * 120)
old.unmount()
flash = bytearray(old.context.buffer)

# 2) Apply the UF2 pages that fall into the filesystem region.
data = open(uf2_path, "rb").read()
applied = 0
for off in range(0, len(data), 512):
    m0, m1, flags, addr, size, bno, num, fam = struct.unpack("<8I", data[off : off + 32])
    assert (m0, m1) == (0x0A324655, 0x9E5D5157)
    if ADDR <= addr < ADDR + SIZE:
        flash[addr - ADDR : addr - ADDR + size] = data[off + 32 : off + 32 + size]
        applied += 1

# 3) Mount like MicroPython and compare every file.
fs = micropython_like()
fs.context.buffer = flash
fs.mount()
names = sorted(fs.listdir("/"))
assert names == sorted(spec["files"]), names
for name, content in spec["files"].items():
    with fs.open(name, "r") as f:
        got = f.read()
    assert got == content, (name, len(got), len(content))

# 4) The program can keep using the filesystem: write a file, remount, read everything back.
with fs.open("data.txt", "w") as f:
    f.write("x" * 5000)
fs.unmount()
fs.mount()
with fs.open("data.txt", "r") as f:
    assert f.read() == "x" * 5000
for name, content in spec["files"].items():
    with fs.open(name, "r") as f:
        assert f.read() == content, name

print("ok", applied, names)
