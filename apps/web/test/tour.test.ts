import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { placePopup, TOUR, visible } from "../src/ui/tourSteps";

const view = { width: 1280, height: 800 };
const popup = { width: 320, height: 160 };

describe("tour steps", () => {
  it("are short: one or two sentences each", () => {
    for (const s of TOUR) {
      expect(s.text.length, s.title).toBeLessThanOrEqual(170);
      expect(s.title.length, s.title).toBeLessThanOrEqual(24);
    }
  });

  it("each point at a data-tour mark that exists in the app", () => {
    const src = resolve(import.meta.dirname, "../src");
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith(".tsx")) files.push(p);
      }
    };
    walk(src);
    const marks = new Set(files.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/data-tour="([a-z-]+)"/g)].map((m) => m[1])));
    for (const s of TOUR) expect(marks.has(s.target), s.target).toBe(true);
    expect(new Set(TOUR.map((s) => s.target)).size).toBe(TOUR.length);
  });
});

describe("placePopup", () => {
  it("goes below a small target near the top", () => {
    const p = placePopup({ top: 40, left: 500, width: 120, height: 36 }, popup, view);
    expect(p.side).toBe("bottom");
    expect(p.top).toBe(40 + 36 + 14);
    expect(p.left).toBe(500 + 60 - 160);
  });

  it("goes above a target at the bottom (the prompt box)", () => {
    const p = placePopup({ top: 720, left: 300, width: 700, height: 60 }, popup, view);
    expect(p.side).toBe("top");
    expect(p.top + popup.height).toBeLessThanOrEqual(720);
  });

  it("goes beside a tall target (the sidebar's examples)", () => {
    const p = placePopup({ top: 60, left: 0, width: 260, height: 700 }, popup, view);
    expect(p.side).toBe("right");
    expect(p.left).toBe(260 + 14);
  });

  it("sits in the middle of a target that fills most of the window (the 3D stage)", () => {
    const p = placePopup({ top: 0, left: 260, width: 1020, height: 800 }, popup, view);
    expect(p.side).toBe("center");
    expect(p.left).toBe(260 + 510 - 160);
  });

  it("never leaves the window", () => {
    for (const target of [
      { top: 10, left: 1200, width: 60, height: 30 },
      { top: 770, left: 0, width: 40, height: 20 },
      { top: 400, left: -50, width: 80, height: 40 },
    ]) {
      const p = placePopup(target, popup, view);
      expect(p.left).toBeGreaterThanOrEqual(12);
      expect(p.left + popup.width).toBeLessThanOrEqual(view.width - 12);
      expect(p.top).toBeGreaterThanOrEqual(12);
      expect(p.top + popup.height).toBeLessThanOrEqual(view.height - 12);
    }
  });

  it("skips targets that aren't on screen", () => {
    expect(visible(null)).toBe(false);
    expect(visible({ top: 0, left: 0, width: 0, height: 0 })).toBe(false);
    expect(visible({ top: 0, left: 0, width: 10, height: 10 })).toBe(true);
  });
});
