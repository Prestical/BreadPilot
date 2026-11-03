// The desktop app's database: PGlite in memory, saved as ONE encrypted file (PLAN §19.2b). PGlite
// can't encrypt its own files, so the whole data directory is dumped, gzipped and sealed with
// AES-256-GCM. Saved shortly after every change and on close; written to a temp file and renamed,
// so a crash leaves either the old file or the new one, never half of one.

import { open, readFile, rename, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import type { Db, Queryable } from "./db";
import { createPglite, pgliteDb } from "./pglite";
import { BoxError, openBox, sealBox } from "./secretbox";

const MAGIC = "BPDB1";
const zip = promisify(gzip);
const unzip = promisify(gunzip);

export class SnapshotError extends Error {
  constructor(
    message: string,
    /** The file that couldn't be read; it is left exactly as it was. */
    public file: string,
    public reason: "format" | "auth" | "corrupt",
  ) {
    super(message);
  }
}

export interface EncryptedDb {
  db: Db;
  /** Writes the snapshot now (waits for a save that is already running). */
  save(): Promise<void>;
  /** Saves unsaved changes, then closes the database. */
  close(): Promise<void>;
}

export interface EncryptedDbOptions {
  file: string;
  /** 32 bytes. The desktop app keeps it encrypted by the OS (safeStorage). */
  key: Uint8Array;
  /** Start from this data-directory dump (tar.gz, not encrypted: public docs only) when `file` doesn't exist yet. */
  template?: string;
  /** Wait after the last change before saving. */
  saveDelayMs?: number;
  /** Save failures are reported here; the next change tries again. */
  onError?: (err: unknown) => void;
}

/** Statements that only read; anything else marks the database as changed. */
const READ_ONLY = /^\s*(SELECT|WITH|EXPLAIN|SHOW)\b/i;

export async function openEncryptedDb(opts: EncryptedDbOptions): Promise<EncryptedDb> {
  const { file, key, saveDelayMs = 1000, onError = () => {} } = opts;

  let dump: Uint8Array | undefined;
  const existing = await readFile(file).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (existing) {
    try {
      dump = await unzip(openBox(key, MAGIC, existing));
    } catch (err) {
      const reason = err instanceof BoxError ? err.reason : "corrupt";
      throw new SnapshotError(err instanceof BoxError ? err.message : "The database file is damaged.", file, reason);
    }
  } else if (opts.template) {
    dump = await unzip(await readFile(opts.template));
  }

  const pg = await createPglite(dump);
  const inner = pgliteDb(pg);

  let dirty = !existing; // a new database is saved as soon as possible
  let timer: NodeJS.Timeout | undefined;
  let saving: Promise<void> | null = null;

  const write = async () => {
    dirty = false;
    const tmp = `${file}.tmp`;
    try {
      // "none" is the fastest dump for PGlite (the database waits for it); gzip runs off the main thread.
      const tar = new Uint8Array(await (await pg.dumpDataDir("none")).arrayBuffer());
      const sealed = sealBox(key, MAGIC, await zip(tar));
      const fh = await open(tmp, "w", 0o600);
      try {
        await fh.writeFile(sealed);
        await fh.sync();
      } finally {
        await fh.close();
      }
      await rename(tmp, file);
    } catch (err) {
      dirty = true;
      await rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  };

  // Returns only when no save is running and nothing is unsaved, so close() never cuts a dump short.
  const save = async (): Promise<void> => {
    clearTimeout(timer);
    timer = undefined;
    for (;;) {
      if (saving) {
        await saving.catch(() => {});
        continue;
      }
      if (!dirty) return;
      const run = (saving = write().finally(() => {
        saving = null;
      }));
      await run; // a failure keeps the changes marked unsaved and reaches the caller
    }
  };

  const changed = () => {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      save().catch(onError);
    }, saveDelayMs);
    timer.unref?.();
  };

  const track = (q: Queryable): Queryable => ({
    query: async (sql, params) => {
      const res = await q.query(sql, params);
      if (!READ_ONLY.test(sql)) changed();
      return res as never;
    },
    exec: async (sql) => {
      await q.exec(sql);
      changed();
    },
  });

  const db: Db = {
    ...track(inner),
    transaction: async (fn) => {
      const result = await inner.transaction((tx) => fn(track(tx)));
      return result;
    },
    close: async () => {
      await save();
      await inner.close();
    },
  };

  if (dirty) changed();
  return { db, save, close: db.close };
}
