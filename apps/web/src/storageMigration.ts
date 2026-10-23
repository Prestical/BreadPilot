// The project was called HardwareEdu ("hwedu.*", until 22/10/2026) and then OpenBreadboard
// ("openbreadboard.*", until 24/10/2026). Browser settings (tutorial progress, last project, power
// wiring, AI choice, code edits) saved under either old name move to "breadpilot.*" once, so the
// renames don't lose them. Imported first by main.tsx.

/** Old prefixes, newest first: a value saved under a newer name wins over an older one. */
const OLD_PREFIXES = ["openbreadboard.", "hwedu."];
const NEW_PREFIX = "breadpilot.";

export function migrateStorage(storage: Storage): void {
  for (const prefix of OLD_PREFIXES) {
    const old: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(prefix)) old.push(key);
    }
    for (const key of old) {
      const value = storage.getItem(key);
      const next = NEW_PREFIX + key.slice(prefix.length);
      // A value already saved under a newer name is newer: keep it.
      if (value !== null && storage.getItem(next) === null) storage.setItem(next, value);
      storage.removeItem(key);
    }
  }
}

try {
  migrateStorage(localStorage);
} catch {
  /* storage blocked: nothing to move */
}
