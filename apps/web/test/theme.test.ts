// M11 11.5: the theme choice, and text contrast read straight from styles.css (WCAG 1.4.3: text
// >= 4.5:1), so a colour change that makes text hard to read fails here.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveTheme, setThemeChoice, THEME_KEY, themeChoice } from "../src/ui/theme";

describe("theme choice", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("system follows the computer, light and dark override it", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("is saved on this computer; system removes the saved value; blocked storage falls back to system", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
    const html = { dataset: {} as Record<string, string> };
    vi.stubGlobal("document", { documentElement: html });
    const events: string[] = [];
    vi.stubGlobal("window", { dispatchEvent: (e: Event) => events.push(e.type) });
    vi.stubGlobal("matchMedia", () => ({ matches: false }));

    expect(themeChoice()).toBe("system");
    setThemeChoice("dark");
    expect(store.get(THEME_KEY)).toBe("dark");
    expect(html.dataset.theme).toBe("dark");
    setThemeChoice("system");
    expect(store.has(THEME_KEY)).toBe(false);
    expect(html.dataset.theme).toBe("light");
    expect(events).toHaveLength(2);

    store.set(THEME_KEY, "purple");
    expect(themeChoice()).toBe("system");
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(themeChoice()).toBe("system");
  });
});

/** The colour tokens of :root (light) and :root[data-theme="dark"]. */
function tokens(): { light: Record<string, string>; dark: Record<string, string> } {
  const css = readFileSync(resolve(import.meta.dirname, "../src/styles.css"), "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    const body = css.slice(start, css.indexOf("}", start));
    return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((m) => [m[1]!, m[2]!.toLowerCase()]));
  };
  const light = block(":root");
  return { light, dark: { ...light, ...block(':root[data-theme="dark"]') } };
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

/** Text tokens and the surfaces the app puts them on. */
const TEXT_ON: Record<string, string[]> = {
  text: ["bg", "surface", "surface-2", "surface-3", "info-bg", "code-bg"],
  muted: ["bg", "surface", "surface-2", "surface-3", "info-bg", "code-bg"],
  "accent-ink": ["bg", "surface", "surface-2", "accent-soft", "info-bg"],
  ok: ["surface", "surface-2", "good-bg"],
  warn: ["surface", "surface-2"],
  bad: ["surface", "surface-2", "bad-bg"],
  "accent-text": ["accent"],
};

describe("text contrast in both themes", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme}: every text colour is at least 4.5:1 on its surfaces`, () => {
      const t = tokens()[theme];
      const low: string[] = [];
      for (const [fg, bgs] of Object.entries(TEXT_ON))
        for (const bg of bgs) {
          expect(t[fg], fg).toBeDefined();
          expect(t[bg], bg).toBeDefined();
          const r = contrast(t[fg]!, t[bg]!);
          if (r < 4.5) low.push(`${fg} on ${bg}: ${r.toFixed(2)}`);
        }
      expect(low).toEqual([]);
    });
  }
});
