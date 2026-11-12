// M11 11.5: light / dark. "system" follows the computer's setting; Light or Dark (Settings →
// Appearance) overrides it on this computer. The page always carries the theme in use as
// <html data-theme="light|dark">, which styles.css reads; the 3D view reads it through useDark().
import { useSyncExternalStore } from "react";

export type ThemeChoice = "system" | "light" | "dark";
export const THEME_KEY = "breadpilot.theme";
const CHANGED = "breadpilot-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function themeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const systemDark = () => typeof matchMedia !== "undefined" && matchMedia(DARK_QUERY).matches;

/** The theme in use: the choice, or the computer's setting for "system". */
export function resolveTheme(choice: ThemeChoice, dark: boolean): "light" | "dark" {
  return choice === "system" ? (dark ? "dark" : "light") : choice;
}

export function applyTheme(): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolveTheme(themeChoice(), systemDark());
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* storage blocked: the choice lasts until the page reloads */
    document.documentElement.dataset.theme = resolveTheme(choice, systemDark());
    window.dispatchEvent(new Event(CHANGED));
    return;
  }
  applyTheme();
  window.dispatchEvent(new Event(CHANGED));
}

/** Keeps <html data-theme> in step with the computer's setting while "system" is chosen. */
export function watchSystemTheme(): void {
  if (typeof matchMedia === "undefined") return;
  matchMedia(DARK_QUERY).addEventListener("change", () => {
    applyTheme();
    window.dispatchEvent(new Event(CHANGED));
  });
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGED, onChange);
  return () => window.removeEventListener(CHANGED, onChange);
}

const isDark = () => typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";

/** True while the dark theme is in use; re-renders when it changes. */
export function useDark(): boolean {
  return useSyncExternalStore(subscribe, isDark, () => false);
}

/** The Settings choice, re-rendering when it changes. */
export function useThemeChoice(): ThemeChoice {
  return useSyncExternalStore(subscribe, themeChoice, () => "system");
}
