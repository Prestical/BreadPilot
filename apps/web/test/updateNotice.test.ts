// M11 11.6: when the "new version" notice shows.
import { describe, expect, it } from "vitest";
import { showNotice } from "../src/ui/UpdateNotice";

const info = (latest: string | null, available: boolean) => ({ current: "0.2.0", latest, available, url: "https://github.com/Prestical/BreadPilot/releases/latest" });

describe("update notice", () => {
  it("shows for a newer version until it's put off with Not now", () => {
    expect(showNotice(info("0.3.0", true), null)).toBe(true);
    expect(showNotice(info("0.3.0", true), "0.3.0")).toBe(false);
  });

  it("comes back for a still newer version", () => {
    expect(showNotice(info("0.4.0", true), "0.3.0")).toBe(true);
  });

  it("never shows without a newer version, or when the check didn't answer", () => {
    expect(showNotice(info("0.2.0", false), null)).toBe(false);
    expect(showNotice(info(null, false), null)).toBe(false);
    expect(showNotice(null, null)).toBe(false);
  });
});
