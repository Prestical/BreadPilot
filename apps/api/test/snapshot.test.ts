// The desktop app's encrypted database file (PLAN §19.2b) and the encryption it uses.
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db";
import { createPglite, pgliteDb } from "../src/pglite";
import { BoxError, openBox, sealBox } from "../src/secretbox";
import { openEncryptedDb, SnapshotError } from "../src/snapshot";

const MIGRATIONS = resolve(import.meta.dirname, "../../../db/migrations");
const SLOW = 60_000;
const key = randomBytes(32);
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "breadpilot-snap-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("secretbox", () => {
  const plain = Buffer.from("my OpenAI key sk-test-123");

  it("round-trips and never contains the plain text", () => {
    const box = sealBox(key, "BPST1", plain);
    expect(box.includes(plain)).toBe(false);
    expect(openBox(key, "BPST1", box).equals(plain)).toBe(true);
  });

  it("uses a fresh nonce for every write", () => {
    expect(sealBox(key, "BPST1", plain).equals(sealBox(key, "BPST1", plain))).toBe(false);
  });

  it("refuses a wrong key, a changed byte and a different kind of file", () => {
    const box = sealBox(key, "BPST1", plain);
    const reason = (f: () => unknown) => {
      try {
        f();
      } catch (err) {
        return err instanceof BoxError ? err.reason : "other";
      }
      return "opened";
    };
    expect(reason(() => openBox(randomBytes(32), "BPST1", box))).toBe("auth");
    const flipped = Buffer.from(box);
    flipped[flipped.length - 1]! ^= 1;
    expect(reason(() => openBox(key, "BPST1", flipped))).toBe("auth");
    expect(reason(() => openBox(key, "BPDB1", box))).toBe("format");
    expect(reason(() => openBox(key, "BPST1", box.subarray(0, 10)))).toBe("format");
    expect(() => sealBox(randomBytes(16), "BPST1", plain)).toThrow(/32 bytes/);
  });
});

describe("encrypted database file", () => {
  it(
    "saves on close and reopens with everything in it",
    async () => {
      const file = join(dir, "data.enc");
      const first = await openEncryptedDb({ file, key });
      await migrate(first.db, MIGRATIONS, () => {});
      await first.db.query("INSERT INTO projects (title, idea, data) VALUES ($1, $2, $3)", ["Blink", "blink an LED on GP15", JSON.stringify({ n: 1 })]);
      await first.close();

      const raw = await readFile(file);
      expect(raw.subarray(0, 5).toString()).toBe("BPDB1");
      expect(raw.includes(Buffer.from("blink an LED on GP15"))).toBe(false);
      expect((await stat(file)).mode & 0o777).toBe(0o600);

      const again = await openEncryptedDb({ file, key });
      const rows = await again.db.query<{ title: string; data: { n: number } }>("SELECT title, data FROM projects");
      expect(rows.rows).toEqual([{ title: "Blink", data: { n: 1 } }]);
      const applied: string[] = [];
      await migrate(again.db, MIGRATIONS, (m) => applied.push(m));
      expect(applied).toEqual([]); // the migrations were saved too
      await again.close();
    },
    SLOW,
  );

  it(
    "refuses a wrong key or a damaged file and leaves the file untouched",
    async () => {
      const file = join(dir, "data.enc");
      const before = await readFile(file);
      await expect(openEncryptedDb({ file, key: randomBytes(32) })).rejects.toMatchObject({ reason: "auth", file });
      expect((await readFile(file)).equals(before)).toBe(true);

      const damaged = join(dir, "damaged.enc");
      const copy = Buffer.from(before);
      copy[copy.length - 50]! ^= 1;
      await writeFile(damaged, copy);
      await expect(openEncryptedDb({ file: damaged, key })).rejects.toBeInstanceOf(SnapshotError);

      const other = join(dir, "other.enc");
      await writeFile(other, "not a database");
      await expect(openEncryptedDb({ file: other, key })).rejects.toMatchObject({ reason: "format" });
    },
    SLOW,
  );

  it(
    "saves by itself shortly after a change",
    async () => {
      const file = join(dir, "auto.enc");
      const edb = await openEncryptedDb({ file, key, saveDelayMs: 30 });
      await edb.save(); // the new, empty database
      const t0 = (await stat(file)).mtimeMs;
      await edb.db.exec("CREATE TABLE notes (t text)");
      await edb.db.query("INSERT INTO notes VALUES ($1)", ["hello"]);
      // No save() call: the file must change on its own.
      const deadline = Date.now() + 5000;
      while ((await stat(file)).mtimeMs === t0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
      expect((await stat(file)).mtimeMs).toBeGreaterThan(t0);
      await edb.save(); // let a save that is still running finish
      // A read doesn't mark the database as changed.
      const t1 = (await stat(file)).mtimeMs;
      await edb.db.query("SELECT * FROM notes");
      await new Promise((r) => setTimeout(r, 80));
      expect((await stat(file)).mtimeMs).toBe(t1);
      await edb.close();
      const reopened = await openEncryptedDb({ file, key });
      expect((await reopened.db.query("SELECT t FROM notes")).rows).toEqual([{ t: "hello" }]);
      await reopened.close();
    },
    SLOW,
  );

  it(
    "starts from a template when there is no file yet",
    async () => {
      const source = await createPglite();
      const sdb = pgliteDb(source);
      await migrate(sdb, MIGRATIONS, () => {});
      await sdb.query("INSERT INTO documents (title, board, path, hash) VALUES ('Datasheet', 'pico-2-w', 'docs/a.pdf', 'h')");
      const template = join(dir, "template.tar.gz");
      await writeFile(template, Buffer.from(await (await source.dumpDataDir("gzip")).arrayBuffer()));
      await sdb.close();

      const file = join(dir, "from-template.enc");
      const edb = await openEncryptedDb({ file, key, template });
      expect((await edb.db.query("SELECT path FROM documents")).rows).toEqual([{ path: "docs/a.pdf" }]);
      await edb.close();
      const raw = await readFile(file); // saved encrypted right away
      expect(raw.subarray(0, 5).toString()).toBe("BPDB1");
    },
    SLOW,
  );
});
