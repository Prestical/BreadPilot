// The data key on Windows and Linux (keyfile.mjs), with a fake safeStorage: Linux with no keyring
// starts with key.plain, and once a keyring appears the key moves into it.
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hasKeyring, KeyFileError, loadKey } from "../src/keyfile.mjs";

/** A stand-in for Electron's safeStorage: "keyring" (gnome_libsecret), "basic" (basic_text) or "none". */
function fakeSafe(mode) {
  let plainText = false;
  const backend = () => (mode === "keyring" ? "gnome_libsecret" : "basic_text");
  return {
    isEncryptionAvailable: () => mode === "keyring" || mode === "basic" || plainText,
    getSelectedStorageBackend: backend,
    setUsePlainTextEncryption: (v) => (plainText = v),
    encryptString: (s) => Buffer.from(`enc:${s}`),
    decryptString: (b) => {
      const s = b.toString();
      if (!s.startsWith("enc:")) throw new Error("bad data");
      return s.slice(4);
    },
  };
}

let dir;
let files;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "breadpilot-key-"));
  files = { keyFile: join(dir, "key.bin"), plainFile: join(dir, "key.plain") };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("Linux with no keyring", () => {
  it("starts with a user-only key.plain and says the key is weakly kept", async () => {
    const first = await loadKey({ platform: "linux", safe: fakeSafe("none"), ...files });
    expect(first.weak).toBe(true);
    expect(first.key).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(files.keyFile)).toBe(false);
    expect((await stat(files.plainFile)).mode & 0o777).toBe(0o600);
    // The next start without a keyring reads the same key.
    expect(await loadKey({ platform: "linux", safe: fakeSafe("none"), ...files })).toEqual(first);
    // Electron's built-in password (basic_text) isn't a keyring either.
    expect((await loadKey({ platform: "linux", safe: fakeSafe("basic"), ...files })).weak).toBe(true);
  });

  it("moves the key into the keyring once one is installed, and key.plain is gone", async () => {
    const before = await loadKey({ platform: "linux", safe: fakeSafe("none"), ...files });
    const logs = [];
    const after = await loadKey({ platform: "linux", safe: fakeSafe("keyring"), ...files, log: (t) => logs.push(t) });
    expect(after).toEqual({ key: before.key, weak: false });
    expect(existsSync(files.plainFile)).toBe(false);
    expect((await readFile(files.keyFile)).toString()).toBe(`enc:${before.key}`);
    expect(logs.join()).toMatch(/moved the data key from key.plain/);
    // And it stays there.
    expect(await loadKey({ platform: "linux", safe: fakeSafe("keyring"), ...files })).toEqual(after);
  });

  it("a damaged key.plain is a key problem, never silently replaced", async () => {
    await writeFile(files.plainFile, "hello\n");
    await expect(loadKey({ platform: "linux", safe: fakeSafe("none"), ...files })).rejects.toMatchObject({ kind: "key" });
  });

  it("no key file but saved projects: refused instead of a new key", async () => {
    const err = await loadKey({ platform: "linux", safe: fakeSafe("none"), ...files, oldData: ["data.enc"] }).catch((e) => e);
    expect(err).toBeInstanceOf(KeyFileError);
    expect(err.kind).toBe("key-missing");
  });
});

describe("with a keyring (or Windows)", () => {
  it("keeps the key encrypted in key.bin, never in key.plain", async () => {
    for (const platform of ["linux", "win32"]) {
      await rm(files.keyFile, { force: true });
      const first = await loadKey({ platform, safe: fakeSafe("keyring"), ...files });
      expect(first.weak).toBe(false);
      expect(existsSync(files.plainFile)).toBe(false);
      expect(await loadKey({ platform, safe: fakeSafe("keyring"), ...files })).toEqual(first);
    }
  });

  it("an older key.bin made with Electron's built-in password still opens with no keyring (weak)", async () => {
    await writeFile(files.keyFile, `enc:${"a".repeat(64)}`);
    expect(await loadKey({ platform: "linux", safe: fakeSafe("none"), ...files })).toEqual({ key: "a".repeat(64), weak: true });
  });

  it("Windows with no secure storage at all is still the storage problem", async () => {
    await expect(loadKey({ platform: "win32", safe: fakeSafe("none"), ...files })).rejects.toMatchObject({ kind: "storage" });
  });

  it("hasKeyring: a real keyring only", () => {
    expect(hasKeyring("linux", fakeSafe("keyring"))).toBe(true);
    expect(hasKeyring("linux", fakeSafe("basic"))).toBe(false);
    expect(hasKeyring("linux", fakeSafe("none"))).toBe(false);
  });
});
