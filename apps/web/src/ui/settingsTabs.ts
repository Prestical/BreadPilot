// The Settings dialog's tabs (user, 11/11/2026: "make the settings more organized"): one subject
// per tab, each with a line saying what it is for, instead of every setting in one long list.

import type { IconName } from "./Icon";

export type SettingsTab = "local" | "openai" | "general" | "privacy";

export const SETTINGS_TABS: { id: SettingsTab; label: string; icon: IconName; intro: string }[] = [
  { id: "local", label: "Local AI", icon: "monitor", intro: "The free AI that runs on this computer. Pick and download its model here." },
  { id: "openai", label: "OpenAI", icon: "sparkle", intro: "Optional: a stronger paid AI from OpenAI, used when you pick it in the model menu." },
  { id: "general", label: "General", icon: "settings", intro: "How BreadPilot looks, new versions, and the tour." },
  { id: "privacy", label: "Privacy", icon: "lock", intro: "Where your projects and keys are kept, and opening BreadPilot in a web browser." },
];

/** Arrow keys, Home and End move between the tabs (WAI-ARIA tabs pattern); other keys: null. */
export function tabForKey(current: SettingsTab, key: string): SettingsTab | null {
  const i = SETTINGS_TABS.findIndex((t) => t.id === current);
  const n = SETTINGS_TABS.length;
  const at = (k: number) => SETTINGS_TABS[(k + n) % n]!.id;
  if (key === "ArrowDown" || key === "ArrowRight") return at(i + 1);
  if (key === "ArrowUp" || key === "ArrowLeft") return at(i - 1);
  if (key === "Home") return at(0);
  if (key === "End") return at(n - 1);
  return null;
}
