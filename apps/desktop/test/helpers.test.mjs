import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { brokenName, openLog, redact } from "../src/log.mjs";
import { crashProblem, filesToSetAside, keyMoveNotice, startupProblem } from "../src/problems.mjs";
import { DEFAULT_SIZE, readWindowState, restoreBounds, writeWindowState } from "../src/windowState.mjs";

let dir;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "breadpilot-desktop-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("window state", () => {
  const laptop = [{ x: 0, y: 25, width: 1440, height: 875 }];
  const twoScreens = [...laptop, { x: 1440, y: 0, width: 1920, height: 1080 }];

  it("reopens where it was, maximized or not", () => {
    expect(restoreBounds({ x: 100, y: 80, width: 1200, height: 800, maximized: true }, laptop)).toEqual({ bounds: { x: 100, y: 80, width: 1200, height: 800 }, maximized: true });
    expect(restoreBounds({ x: 1600, y: 100, width: 1300, height: 900 }, twoScreens).bounds.x).toBe(1600);
  });

  it("falls back to the default size when the screen it was on is gone, or nothing was saved", () => {
    expect(restoreBounds({ x: 1600, y: 100, width: 1300, height: 900 }, laptop)).toEqual({ bounds: DEFAULT_SIZE, maximized: false });
    expect(restoreBounds(null, laptop)).toEqual({ bounds: DEFAULT_SIZE, maximized: false });
    expect(restoreBounds({ x: "a", y: 0, width: 10, height: 10 }, laptop).bounds).toEqual(DEFAULT_SIZE);
  });

  it("shrinks a window that's bigger than the screen it's on", () => {
    expect(restoreBounds({ x: 0, y: 25, width: 3000, height: 2000 }, laptop).bounds).toEqual({ x: 0, y: 25, width: 1440, height: 875 });
  });

  it("is saved and read back; a damaged file means the default", async () => {
    const file = join(dir, "window.json");
    await writeWindowState(file, { x: 1, y: 2, width: 900, height: 700, maximized: false });
    expect(await readWindowState(file)).toEqual({ x: 1, y: 2, width: 900, height: 700, maximized: false });
    await writeFile(file, "{not json");
    expect(await readWindowState(file)).toBeNull();
  });
});

describe("log file", () => {
  it("masks session tokens and API keys", () => {
    expect(redact("GET /pair?t=abc123def&x=1")).toBe("GET /pair?t=REDACTED&x=1");
    expect(redact("key sk-proj-AbC_123-xyz used")).toBe("key sk-REDACTED used");
    expect(redact("GP16 out, 3 parts")).toBe("GP16 out, 3 parts");
  });

  it("writes stamped lines, readable only by the user, and starts a new file when the old one is full", async () => {
    const logs = join(dir, "logs");
    const log = await openLog(logs, { maxBytes: 400 });
    log.write("main", "starting\n\nengine ready");
    log.write("engine", "token ?t=secret in a link");
    await log.close();
    const text = await readFile(log.path, "utf8");
    expect(text).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z \[main\] starting\n.+\[main\] engine ready\n.+\[engine\] token \?t=REDACTED in a link\n$/);
    expect((await stat(log.path)).mode & 0o777).toBe(0o600);

    // One session filling it: a notice, then nothing more until the next launch.
    const busy = await openLog(logs, { maxBytes: 400 });
    for (let i = 0; i < 50; i++) busy.write("engine", `line ${i} ${"x".repeat(40)}`);
    await busy.close();
    expect(await readFile(busy.path, "utf8")).toContain("The log is full for this session");
    // Next launch: the full file becomes .1 and a new one starts.
    const next = await openLog(logs, { maxBytes: 400 });
    next.write("main", "fresh");
    await next.close();
    expect(await readFile(next.path, "utf8")).toMatch(/\[main\] fresh\n$/);
    expect(await readFile(`${next.path}.1`, "utf8")).toContain("The log is full");
  });

  it("names a file kept aside by “Start fresh” with the date", () => {
    expect(brokenName("/x/data.enc", new Date("2026-10-26T18:05:09.123Z"))).toBe("/x/data.enc.broken-2026-10-26T18-05-09");
  });
});

describe("problem dialogs", () => {
  const actions = (p) => p.buttons.map((b) => b.action);

  it("offer Start fresh only for files that can't be read, and always a way out", () => {
    for (const kind of ["snapshot-auth", "wrong-key", "snapshot-format", "snapshot-corrupt", "settings", "key", "key-missing"]) {
      expect(actions(startupProblem(kind)), kind).toEqual(["fresh", "folder", "quit"]);
    }
    expect(actions(startupProblem("locked"))).toEqual(["retry", "quit"]);
    expect(actions(startupProblem("storage"))).toEqual(["quit"]);
    expect(actions(startupProblem("exit", "code 1"))).toEqual(["retry", "log", "quit"]);
    expect(startupProblem("other", "disk full").detail).toContain("disk full");
    expect(actions(crashProblem())).toEqual(["retry", "log", "quit"]);
  });

  it("say that nothing is deleted when starting fresh", () => {
    for (const kind of ["snapshot-auth", "wrong-key", "snapshot-corrupt", "settings", "key", "key-missing"]) expect(startupProblem(kind).detail, kind).toMatch(/nothing is deleted/);
  });

  it("set aside only what can't be read", () => {
    expect(filesToSetAside("snapshot-corrupt")).toEqual(["data/data.enc"]); // the settings (and OpenAI key) stay
    expect(filesToSetAside("settings")).toEqual(["data/settings.enc"]); // the projects stay
    expect(filesToSetAside("key")).toEqual(["key.bin", "key.plain", "data/data.enc", "data/settings.enc"]); // both need the lost key
    expect(filesToSetAside("locked")).toEqual([]);
  });
});

describe("macOS key messages", () => {
  it("a locked keychain says how to unlock it and offers to try again", () => {
    const p = startupProblem("storage", "", "darwin");
    expect(p.message).toMatch(/login keychain/);
    expect(p.detail).toMatch(/Keychain Access/);
    expect(p.buttons.map((b) => b.action)).toEqual(["retry", "quit"]);
    expect(startupProblem("storage", "", "linux").detail).toMatch(/GNOME Keyring/);
  });

  it("the one-time key move warns about the system prompt before it comes", () => {
    const n = keyMoveNotice();
    expect(n.detail).toMatch(/login password/);
    expect(n.detail).toMatch(/Allow/);
    expect(n.detail).toMatch(/won't be asked again/);
    expect(n.buttons.map((b) => b.action)).toEqual(["continue", "quit"]);
    expect(n.detail).toContain("“BreadPilot Safe Storage”");
    expect(keyMoveNotice("BreadPilot Dev").detail).toContain("“BreadPilot Dev Safe Storage”");
  });
});

describe("a missing or wrong key is one problem, not one per file", () => {
  it("sets aside the projects and the settings together", () => {
    expect(filesToSetAside("wrong-key")).toEqual(["data/data.enc", "data/settings.enc"]);
    expect(filesToSetAside("key-missing")).toEqual(["data/data.enc", "data/settings.enc"]);
  });

  it("says the key is missing and where it was kept", () => {
    const mac = startupProblem("key-missing", "", "darwin");
    expect(mac.message).toMatch(/key to your saved projects is missing/);
    expect(mac.detail).toContain("BreadPilot data key");
    expect(mac.detail).toMatch(/weren't changed/);
    expect(startupProblem("key-missing", "", "win32").detail).toContain("key.bin");
  });
});
