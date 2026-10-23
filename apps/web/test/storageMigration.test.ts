// Browser settings saved under the old names (HardwareEdu "hwedu.*", OpenBreadboard "openbreadboard.*")
// move to "breadpilot.*".
import { describe, expect, it } from "vitest";
import { migrateStorage } from "../src/storageMigration";

function memoryStorage(entries: Record<string, string>): Storage {
  const m = new Map(Object.entries(entries));
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
  };
}

const dump = (s: Storage) => Object.fromEntries(Array.from({ length: s.length }, (_, i) => s.key(i)!).map((k) => [k, s.getItem(k)]));

describe("storage migration after the renames", () => {
  it("moves every old key, keeps newer values and other sites' keys", () => {
    const s = memoryStorage({ "hwedu.power": "direct", "hwedu.ai": "openai", "hwedu.code.abc": "print(1)", "hwedu.project": "old", "breadpilot.project": "new", other: "x" });
    migrateStorage(s);
    expect(dump(s)).toEqual({ "breadpilot.power": "direct", "breadpilot.ai": "openai", "breadpilot.code.abc": "print(1)", "breadpilot.project": "new", other: "x" });
    migrateStorage(s); // a second run changes nothing
    expect(dump(s)["breadpilot.power"]).toBe("direct");
  });

  it("the OpenBreadboard name wins over the older HardwareEdu one", () => {
    const s = memoryStorage({ "openbreadboard.ai": "openai", "hwedu.ai": "local", "openbreadboard.tutorial.completed": "1", "hwedu.power": "direct" });
    migrateStorage(s);
    expect(dump(s)).toEqual({ "breadpilot.ai": "openai", "breadpilot.tutorial.completed": "1", "breadpilot.power": "direct" });
  });
});
