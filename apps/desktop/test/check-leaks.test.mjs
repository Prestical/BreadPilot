// The leak check must actually catch leaks: plant each kind in a throwaway folder and expect a
// failure naming the file and the rule (never the value).
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = resolve(import.meta.dirname, "../scripts/check-leaks.mjs");
let dir;

const run = (target) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT, target], { encoding: "utf8", stdio: "pipe" }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout}${err.stderr}` };
  }
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "breadpilot-leaks-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("check-leaks", () => {
  it("passes a clean folder", async () => {
    const clean = join(dir, "clean");
    await mkdir(join(clean, "web"), { recursive: true });
    await writeFile(join(clean, "web", "index.html"), "<!doctype html><title>BreadPilot</title>");
    const r = run(clean);
    expect(r.code).toBe(0);
    expect(r.out).toContain("leak check passed");
  });

  it("fails on each planted leak, and never prints the value", async () => {
    const bad = join(dir, "bad");
    const fakeKey = `sk-proj-${"Q".repeat(40)}`;
    await mkdir(join(bad, "rag", ".claude"), { recursive: true });
    await mkdir(join(bad, "engine"), { recursive: true });
    await writeFile(join(bad, ".env"), "OPENAI_API_KEY=");
    await writeFile(join(bad, "engine", "desktop.js"), `const where = ${JSON.stringify(join(homedir(), "Desktop", "x"))};`);
    await writeFile(join(bad, "engine", "desktop.js.map"), "{}");
    await writeFile(join(bad, "notes.txt"), `key: ${fakeKey}`);
    await writeFile(join(bad, "template.tar.gz"), gzipSync(Buffer.from(`home ${homedir()} inside`)));
    await writeFile(join(bad, "MEMORY.md"), "private");
    const r = run(bad);
    expect(r.code).toBe(1);
    for (const line of [
      ".env: private file name",
      ".claude: private file name",
      "desktop.js.map: private file name",
      "MEMORY.md: private file name",
      "desktop.js: contains the home folder path",
      "notes.txt: contains something shaped like an OpenAI key",
      "template.tar.gz (unpacked): contains the home folder path",
    ]) {
      expect(r.out, line).toContain(line);
    }
    expect(r.out).not.toContain(fakeKey);
    expect(r.out).not.toContain(homedir());
  });

  it("doesn't mistake words that end in sk- for keys, but still finds a real-looking key", async () => {
    const words = join(dir, "words");
    await mkdir(words, { recursive: true });
    await writeFile(join(words, "engine.bin"), "SubgroupEqMask-SubgroupEqMask-04370 kiosk-appUpdaterInformatie HRsk-SKsq-ALsv-SEth-THtr-TRur");
    expect(run(words).code).toBe(0);
    await writeFile(join(words, "config.js"), `const k = "sk-${"A1b2".repeat(8)}";`);
    const r = run(words);
    expect(r.code).toBe(1);
    expect(r.out).toContain("config.js: contains something shaped like an OpenAI key");
  });

  it("checks the installers themselves in a release folder, not only the app folders", async () => {
    const release = join(dir, "release");
    await mkdir(join(release, "win-unpacked", "resources"), { recursive: true });
    await writeFile(join(release, "win-unpacked", "resources", "main.mjs"), "clean");
    await writeFile(join(release, "builder-debug.yml"), "log");
    await writeFile(join(release, "BreadPilot-0.0.0-Setup.exe"), `MZ…${`sk-${"Z".repeat(30)}`}…`);
    const r = run(release);
    expect(r.code).toBe(1);
    expect(r.out).toContain("BreadPilot-0.0.0-Setup.exe: contains something shaped like an OpenAI key");
    expect(r.out).toContain("Never upload: builder-debug.yml");
  });
});
