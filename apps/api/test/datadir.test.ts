// The data folder lock: one program at a time, so two can't overwrite each other's saves.
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DataLockedError, devKey, lockDataDir, openDataDir } from "../src/datadir";

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "breadpilot-data-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("data folder", () => {
  it("refuses a second user while a running process holds the lock", async () => {
    await writeFile(join(dir, "data.lock"), String(process.ppid)); // the test runner's parent: alive
    await expect(lockDataDir(dir)).rejects.toBeInstanceOf(DataLockedError);
    await rm(join(dir, "data.lock"));
  });

  it("takes over a lock left by a process that has ended", async () => {
    await writeFile(join(dir, "data.lock"), "999999999");
    const release = await lockDataDir(dir);
    expect(await readFile(join(dir, "data.lock"), "utf8")).toBe(String(process.pid));
    await release();
    await expect(stat(join(dir, "data.lock"))).rejects.toThrow();
  });

  it(
    "opens the database, holds the lock until close, then frees it",
    async () => {
      const key = randomBytes(32);
      const data = await openDataDir({ dir: join(dir, "app"), key });
      expect((await stat(join(dir, "app"))).mode & 0o777).toBe(0o700);
      await expect(lockDataDir(join(dir, "app"))).rejects.toBeInstanceOf(DataLockedError); // even from this process
      await expect(openDataDir({ dir: join(dir, "app"), key })).rejects.toBeInstanceOf(DataLockedError);
      await data.close();
      await expect(stat(join(dir, "app", "data.lock"))).rejects.toThrow();
      await expect(stat(join(dir, "app", "data.enc"))).resolves.toBeTruthy();
    },
    60_000,
  );

  it("keeps one development key, readable only by its owner", async () => {
    const a = await devKey(join(dir, "dev"));
    const b = await devKey(join(dir, "dev"));
    expect(a.equals(b)).toBe(true);
    expect(a.length).toBe(32);
    expect((await stat(join(dir, "dev", "dev-key.hex"))).mode & 0o777).toBe(0o600);
  });
});
