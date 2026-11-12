// The installed app must contain every file main.mjs imports: scripts/stage.mjs copies a fixed list
// (a new file once went missing from it, so the installed app wouldn't have started).
import { describe, expect, it } from "vitest";

describe("the installer ships every file the app imports", () => {
  it("scripts/stage.mjs lists each ./*.mjs that main.mjs needs", async () => {
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const src = resolve(import.meta.dirname, "../src");
    const listed = JSON.parse(/const APP_FILES = (\[[^\]]*\])/.exec(await readFile(resolve(import.meta.dirname, "../scripts/stage.mjs"), "utf8"))[1]);
    const seen = new Set(["main.mjs"]);
    const queue = ["main.mjs"];
    while (queue.length) {
      const file = queue.pop();
      for (const m of (await readFile(resolve(src, file), "utf8")).matchAll(/from "\.\/([\w.-]+\.mjs)"/g)) {
        if (!seen.has(m[1])) {
          seen.add(m[1]);
          queue.push(m[1]);
        }
      }
    }
    expect([...seen].sort().filter((f) => !listed.includes(f))).toEqual([]);
  });
});
