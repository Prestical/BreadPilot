// The database key on Windows and Linux (macOS uses keychain.mjs).
//
//   key.bin    the key encrypted by the operating system through Electron's safeStorage
//              (Windows DPAPI, or a Linux keyring: GNOME Keyring, KWallet…)
//   key.plain  Linux with no keyring only: the key as text, readable by this user only (0600).
//              Without a keyring, Electron could only encrypt with a password that is the same in
//              every copy of the app, which protects nothing, so the file says plainly what it is.
//              While this file is in use, BreadPilot never saves an OpenAI key (weak: true).
//
// Once a keyring appears (the user installs or unlocks one), the next start moves the key from
// key.plain into key.bin, deletes key.plain, and the OpenAI key can be saved again.
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";

export class KeyFileError extends Error {
  /** kind: "storage" (no secure storage at all), "key" (key.bin can't be read), "key-missing". */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/** Backends that mean "no real keyring": Electron's built-in password, or none it could identify. */
const NO_KEYRING = new Set(["basic_text", "unknown"]);

/** Whether the operating system can really protect the key. */
export function hasKeyring(platform, safe) {
  if (platform === "win32") return safe.isEncryptionAvailable();
  return safe.isEncryptionAvailable() && !NO_KEYRING.has(safe.getSelectedStorageBackend());
}

const isHexKey = (s) => /^[0-9a-f]{64}$/.test(s);

async function writeNew(file, data) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const fh = await open(file, "wx", 0o600);
  await fh.writeFile(data);
  await fh.close();
}

/**
 * The data key and whether it is only weakly kept (no keyring: no OpenAI key is saved).
 * `oldData` lists encrypted files that already exist: without a key file they would be unreadable
 * with a new key, so that is refused ("key-missing") instead of making one.
 */
export async function loadKey({ platform, safe, keyFile, plainFile, oldData = [], log = () => {} }) {
  const strong = hasKeyring(platform, safe);

  // A key kept without a keyring: moved into the keyring as soon as there is one.
  if (existsSync(plainFile)) {
    const key = (await readFile(plainFile, "utf8")).trim();
    if (!isHexKey(key)) throw new KeyFileError("key", `${plainFile} doesn't hold a key.`);
    if (!strong) return { key, weak: true };
    if (existsSync(keyFile)) await rm(keyFile); // can't happen in normal use: key.plain is the newer one
    await writeNew(keyFile, safe.encryptString(key));
    if (safe.decryptString(await readFile(keyFile)) !== key) throw new KeyFileError("key", "The keyring didn't give the key back.");
    await rm(plainFile);
    log(`a keyring is available now (${safe.getSelectedStorageBackend?.() ?? platform}): moved the data key from key.plain into it`);
    return { key, weak: false };
  }

  const stored = await readFile(keyFile).catch((err) => (err.code === "ENOENT" ? null : Promise.reject(err)));
  if (stored) {
    // Linux: a key.bin made with Electron's built-in password (older builds) still opens without a keyring.
    if (platform === "linux" && !safe.isEncryptionAvailable()) safe.setUsePlainTextEncryption(true);
    if (!safe.isEncryptionAvailable()) throw new KeyFileError("storage", "Secure storage isn't available.");
    try {
      return { key: safe.decryptString(stored), weak: !strong };
    } catch (err) {
      throw new KeyFileError("key", `The key file couldn't be decrypted: ${err.message}`);
    }
  }

  if (oldData.length) throw new KeyFileError("key-missing", `no data key, but ${oldData.join(" and ")} exist`);
  const key = randomBytes(32).toString("hex");
  if (strong) {
    await writeNew(keyFile, safe.encryptString(key));
    log("made a new data key (first start)");
    return { key, weak: false };
  }
  if (platform !== "linux") throw new KeyFileError("storage", "Secure storage isn't available.");
  await writeNew(plainFile, `${key}\n`);
  log(`made a new data key (first start) without a keyring (safeStorage backend: ${safe.getSelectedStorageBackend()}): kept in key.plain, readable by this user only`);
  return { key, weak: true };
}
