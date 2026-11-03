// After a build has passed the leak check: keeps only the installers in apps/desktop/release
// (.dmg, .exe, .AppImage) and removes everything else electron-builder left there (the unpacked
// apps, its build logs with local paths, update block maps, icon caches) plus the .stage folder.
// Nothing outside these two folders is touched.
//
//   node scripts/clean-release.mjs

import { readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

const DESKTOP = resolve(import.meta.dirname, "..");
const RELEASE = join(DESKTOP, "release");
const INSTALLER = /\.(dmg|exe|AppImage)$/;

const kept = [];
let removed = 0;
for (const entry of await readdir(RELEASE, { withFileTypes: true }).catch(() => [])) {
  if (entry.isFile() && INSTALLER.test(entry.name)) {
    kept.push(entry.name);
    continue;
  }
  await rm(join(RELEASE, entry.name), { recursive: true, force: true });
  removed++;
}
await rm(join(DESKTOP, ".stage"), { recursive: true, force: true });

console.log(`release folder: ${kept.length ? kept.join(", ") : "no installers"} (${removed} build leftovers and the stage removed)`);
