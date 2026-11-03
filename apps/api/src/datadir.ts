// The data folder: the encrypted database (data.enc) plus a lock so only one program uses it at a
// time. PGlite keeps the database in memory and saves the whole file, so two programs on the same
// folder would overwrite each other's changes.

import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { KEY_BYTES } from "./secretbox";
import { openEncryptedDb, type EncryptedDb } from "./snapshot";

export class DataLockedError extends Error {
  constructor(public pid: number) {
    super(`The data folder is in use by another BreadPilot program (process ${pid}). Close it first.`);
  }
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM"; // exists, owned by someone else
  }
};

/** Takes data.lock (removing one left behind by a crashed process). Returns the release function. */
export async function lockDataDir(dir: string): Promise<() => Promise<void>> {
  const file = join(dir, "data.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await open(file, "wx", 0o600);
      await fh.writeFile(String(process.pid));
      await fh.close();
      return () => rm(file, { force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const pid = Number((await readFile(file, "utf8").catch(() => "")).trim());
      // This process counts too: a second database on the same folder would overwrite the first.
      if (pid && alive(pid)) throw new DataLockedError(pid);
      await rm(file, { force: true });
    }
  }
  throw new Error(`Couldn't take ${file}.`);
}

/**
 * Development and command-line tools only: a random key kept next to the data (0600). The desktop
 * app never uses this: its key is encrypted by the operating system (safeStorage).
 */
export async function devKey(dir: string): Promise<Buffer> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, "dev-key.hex");
  const existing = await readFile(file, "utf8").catch(() => null);
  if (existing) return Buffer.from(existing.trim(), "hex");
  const key = randomBytes(KEY_BYTES);
  const fh = await open(file, "wx", 0o600);
  await fh.writeFile(key.toString("hex"));
  await fh.close();
  return key;
}

export interface DataDirOptions {
  dir: string;
  key: Uint8Array;
  template?: string;
  onError?: (err: unknown) => void;
}

/** Opens the folder's database (creating folder and database when new) and holds the lock until close. */
export async function openDataDir(opts: DataDirOptions): Promise<EncryptedDb> {
  await mkdir(opts.dir, { recursive: true, mode: 0o700 });
  const release = await lockDataDir(opts.dir);
  try {
    const edb = await openEncryptedDb({ file: join(opts.dir, "data.enc"), key: opts.key, template: opts.template, onError: opts.onError });
    const close = async () => {
      try {
        await edb.close();
      } finally {
        await release();
      }
    };
    return { ...edb, db: { ...edb.db, close }, close };
  } catch (err) {
    await release();
    throw err;
  }
}
