// The app's line icons (ui/Icon.tsx) and the rule that the UI uses them instead of emoji
// (user, 12/11/2026: a more professional look; emoji differ on every computer).
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ICON_NAMES } from "../src/ui/Icon";

const SRC = join(__dirname, "../src");
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx$/.test(e.name) ? [join(dir, e.name)] : []));

describe("line icons", () => {
  it("every icon a screen asks for exists", () => {
    const used = new Set(files(SRC).flatMap((f) => [...readFileSync(f, "utf8").matchAll(/<Icon name="([a-z-]+)"/g)].map((m) => m[1]!)));
    expect(used.size).toBeGreaterThan(10);
    for (const name of used) expect(ICON_NAMES, name).toContain(name);
  });

  it("no emoji are left in what the screens show (plain check marks are text, not emoji)", () => {
    for (const f of files(SRC)) {
      const shown = readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l));
      for (const l of shown) expect(l, f).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2B00}-\u{2BFF}]/u);
    }
  });
});
