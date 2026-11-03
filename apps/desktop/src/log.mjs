// The app's log file (logs/breadpilot.log in the app-data folder): what the desktop app and its
// engine report, for finding problems. The engine logs stages, timings, pins and errors, never the
// user's ideas, code or keys; as a safety net anything that looks like a secret is masked here too.

import { createWriteStream } from "node:fs";
import { mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";

export const MAX_LOG_BYTES = 5 * 1024 * 1024;

/** Masks the session token in links (?t=…) and anything shaped like an API key (sk-…). */
export function redact(line) {
  return line.replace(/([?&]t=)[^&\s"]+/g, "$1REDACTED").replace(/\bsk-[A-Za-z0-9_-]{8,}/g, "sk-REDACTED");
}

/**
 * Opens the log, moving a full one to breadpilot.log.1 first (one old file is kept). If one session
 * fills it (it shouldn't: request logs are off), it says so once and stops until the next launch.
 */
export async function openLog(dir, { maxBytes = MAX_LOG_BYTES } = {}) {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, "breadpilot.log");
  let size = await stat(path).then((s) => s.size, () => 0);
  if (size >= maxBytes) {
    await rename(path, `${path}.1`);
    size = 0;
  }
  const stream = createWriteStream(path, { flags: "a", mode: 0o600 });
  let full = false;
  const line = (source, text) => `${new Date().toISOString()} [${source}] ${text}\n`;
  return {
    path,
    /** Lines from `source` ("main", "engine", "page"). */
    write(source, text) {
      for (const l of String(text).split(/\r?\n/)) {
        if (full || !l.trim()) continue;
        const out = line(source, redact(l));
        size += Buffer.byteLength(out);
        if (size >= maxBytes) {
          full = true;
          stream.write(line("main", "The log is full for this session; it starts again on the next launch."));
          continue;
        }
        stream.write(out);
      }
    },
    close: () => new Promise((ok) => stream.end(ok)),
  };
}

/** The name a file is kept under when the user chooses "Start fresh": data.enc → data.enc.broken-2026-10-26T18-00-00. */
export function brokenName(file, now = new Date()) {
  return `${file}.broken-${now.toISOString().slice(0, 19).replace(/:/g, "-")}`;
}
