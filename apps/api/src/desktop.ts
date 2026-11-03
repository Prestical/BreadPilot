// The API inside the desktop app: Electron starts this file in a utility process
// (utilityProcess.fork) and talks to it through messages. The database key arrives in a message,
// never on the command line or in the environment, where other programs could read it.
//
// main → here:  { type: "start", dataDir, key (hex), token, webDir, repoDir, migrationsDir, template?, weakKeyStorage? }
//               { type: "stop" }
// here → main:  { type: "ready", url, pairingUrl }   { type: "error", kind, message }   { type: "stopped" }
// Browser access is a setting (PUT /api/settings), saved in settings.enc.

import { join } from "node:path";
import { loadConfig } from "./config";
import { DataLockedError, openDataDir } from "./datadir";
import { defaultSettings, fileSettings, SettingsFileError } from "./settings";
import { SnapshotError } from "./snapshot";
import { startApi, type RunningApi } from "./start";
import type { EncryptedDb } from "./snapshot";

interface ParentPort {
  on(event: "message", listener: (e: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}
const parent = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!parent) throw new Error("desktop.ts runs only inside the BreadPilot desktop app.");

/** Shown in Settings when the operating system has no keyring to protect the OpenAI key with. */
const WEAK_KEY_STORAGE =
  "This computer has no keyring (such as GNOME Keyring or KWallet), so BreadPilot can't keep an OpenAI key safe here and won't save one. Install or unlock a keyring, then restart BreadPilot. The local AI works without a key.";

/** True when settings.enc exists and this key can't open it. */
async function settingsLocked(file: string, key: Buffer): Promise<boolean> {
  try {
    await fileSettings({ file, key, defaults: defaultSettings(loadConfig({}), { withKey: false }) });
    return false;
  } catch (err) {
    return err instanceof SettingsFileError;
  }
}

type Message =
  | { type: "start"; dataDir: string; key: string; token: string; webDir: string; repoDir: string; migrationsDir: string; template?: string; weakKeyStorage?: boolean }
  | { type: "stop" };

let data: EncryptedDb | null = null;
let api: RunningApi | null = null;

const kindOf = (err: unknown) =>
  err instanceof SnapshotError ? `snapshot-${err.reason}` : err instanceof DataLockedError ? "locked" : err instanceof SettingsFileError ? "settings" : "other";

parent.on("message", async ({ data: raw }) => {
  const msg = raw as Message;
  try {
    if (msg.type === "start" && !api) {
      // Only the folders come from outside: AI settings and the OpenAI key live in settings.enc
      // (the Settings screen), never in environment variables or a .env file.
      const config = loadConfig({ DATA_DIR: msg.dataDir, REPO_DIR: msg.repoDir, MIGRATIONS_DIR: msg.migrationsDir });
      const key = Buffer.from(msg.key, "hex");
      // A first start begins from the ready-made database (docs indexed, no projects) when there is one.
      data = await openDataDir({ dir: msg.dataDir, key, template: msg.template, onError: (err) => console.error("saving the database failed:", err) });
      // No keyring to protect the key with (Linux): the OpenAI key isn't kept at all.
      const keyRefused = msg.weakKeyStorage ? WEAK_KEY_STORAGE : null;
      const settings = await fileSettings({ file: join(msg.dataDir, "settings.enc"), key, defaults: defaultSettings(config, { withKey: false }), keyRefused });
      // Messages go to stdout, which the desktop app writes to its log file (no request logs).
      api = await startApi({ config, db: data.db, settings, port: 0, webDir: msg.webDir, accessToken: msg.token, logger: true, requestLogs: false, desktop: true });
      parent.postMessage({ type: "ready", url: api.url, pairingUrl: api.pairingUrl });
    } else if (msg.type === "stop") {
      await api?.close();
      await data?.close();
      api = null;
      data = null;
      parent.postMessage({ type: "stopped" });
    }
  } catch (err) {
    await data?.close().catch(() => {});
    data = null;
    let kind = kindOf(err);
    // The projects can't be unlocked: if the settings can't either, it's the key (one problem, not two).
    if (kind === "snapshot-auth" && msg.type === "start" && (await settingsLocked(join(msg.dataDir, "settings.enc"), Buffer.from(msg.key, "hex")))) kind = "wrong-key";
    parent.postMessage({ type: "error", kind, message: err instanceof Error ? err.message : String(err) });
  }
});
