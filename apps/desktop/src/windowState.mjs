// The window's size and position between launches (window.json in the app-data folder). Pure
// functions plus small file helpers, no Electron, so they're unit-tested.

import { readFile, rename, writeFile } from "node:fs/promises";

export const DEFAULT_SIZE = { width: 1280, height: 820 };
/** Enough of the window must be on a screen to grab it, or the saved place is ignored. */
const MIN_VISIBLE = 100;

/**
 * Where to open the window: the saved bounds if they're still on one of the screens (a monitor may
 * have been unplugged), shrunk to fit it; otherwise the default size, centred by Electron.
 * `workAreas`: each display's work area ({ x, y, width, height }).
 */
export function restoreBounds(saved, workAreas) {
  const ok = saved && [saved.x, saved.y, saved.width, saved.height].every(Number.isFinite) && saved.width > 0 && saved.height > 0;
  if (ok) {
    for (const a of workAreas) {
      const w = Math.min(saved.x + saved.width, a.x + a.width) - Math.max(saved.x, a.x);
      const h = Math.min(saved.y + saved.height, a.y + a.height) - Math.max(saved.y, a.y);
      if (w >= MIN_VISIBLE && h >= MIN_VISIBLE) {
        const width = Math.min(saved.width, a.width);
        const height = Math.min(saved.height, a.height);
        return { bounds: { x: saved.x, y: saved.y, width, height }, maximized: !!saved.maximized };
      }
    }
  }
  return { bounds: { ...DEFAULT_SIZE }, maximized: !!saved?.maximized };
}

export async function readWindowState(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null; // first start or a damaged file: default size
  }
}

export async function writeWindowState(file, state) {
  await writeFile(`${file}.tmp`, JSON.stringify(state));
  await rename(`${file}.tmp`, file);
}
