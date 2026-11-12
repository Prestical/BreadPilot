// The Settings dialog's tabs: every subject has a tab with a line saying what it's for, and the
// arrow keys move between them (WAI-ARIA tabs pattern).
import { describe, expect, it } from "vitest";
import { SETTINGS_TABS, tabForKey } from "../src/ui/settingsTabs";

describe("settings tabs", () => {
  it("has the four subjects in order, each with an intro", () => {
    expect(SETTINGS_TABS.map((t) => t.id)).toEqual(["local", "openai", "general", "privacy"]);
    for (const t of SETTINGS_TABS) expect(t.intro.length).toBeGreaterThan(20);
  });

  it("arrow keys wrap around; Home and End jump; other keys do nothing", () => {
    expect(tabForKey("local", "ArrowDown")).toBe("openai");
    expect(tabForKey("privacy", "ArrowDown")).toBe("local");
    expect(tabForKey("local", "ArrowUp")).toBe("privacy");
    expect(tabForKey("openai", "ArrowRight")).toBe("general");
    expect(tabForKey("general", "Home")).toBe("local");
    expect(tabForKey("local", "End")).toBe("privacy");
    expect(tabForKey("local", "Enter")).toBeNull();
  });
});
