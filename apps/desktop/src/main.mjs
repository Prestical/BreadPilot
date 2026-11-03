// BreadPilot desktop app (PLAN §19): starts the API in a utility process (apps/api/dist/desktop.js)
// with the encrypted database in the app-data folder, then shows it in a window signed in with this
// launch's session token. No Docker, no database server.
//
//   npm run dev -w @breadpilot/desktop      (builds the API and the web app first)
//
// D6: the window keeps its size and place, everything goes to logs/breadpilot.log, and problems
// get a dialog with real choices (problems.mjs) instead of a dead end.

import { app, BrowserWindow, dialog, Menu, safeStorage, screen, shell, utilityProcess } from "electron";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { brokenName, openLog } from "./log.mjs";
import { KeychainError, macKeychain } from "./keychain.mjs";
import { buildMenu } from "./menu.mjs";
import { crashProblem, filesToSetAside, keyMoveNotice, startupProblem } from "./problems.mjs";
import { readWindowState, restoreBounds, writeWindowState } from "./windowState.mjs";

// Where the app's parts are: next to this file in the packaged app (scripts/stage.mjs puts them
// there), or in the repo while developing.
const HERE = import.meta.dirname;
const STAGED = existsSync(join(HERE, "engine", "desktop.js"));
const REPO = resolve(HERE, "../../..");
const PATHS = STAGED
  ? { engine: join(HERE, "engine/desktop.js"), web: join(HERE, "web"), migrations: join(HERE, "migrations"), docs: join(HERE, "rag"), template: join(HERE, "template.tar.gz") }
  : { engine: join(REPO, "apps/api/dist/desktop.js"), web: join(REPO, "apps/web/dist"), migrations: join(REPO, "db/migrations"), docs: REPO, template: join(REPO, "apps/desktop/build/template.tar.gz") };
// The ready-made database (docs already indexed) for a first start; without it the docs are indexed then.
const TEMPLATE = existsSync(PATHS.template) ? PATHS.template : undefined;
const DEV = !app.isPackaged;

// The name sets the app-data folder and the keychain entry ("<name> Safe Storage"). Development
// runs are "BreadPilot Dev": their projects, key and keychain entry never mix with an installed
// BreadPilot on the same computer.
const NAME = DEV ? "BreadPilot Dev" : "BreadPilot";
app.setName(NAME);
app.setPath("userData", join(app.getPath("appData"), NAME));
const USER_DIR = app.getPath("userData");
const DATA_DIR = join(USER_DIR, "data");
const KEY_FILE = join(USER_DIR, "key.bin");
/** macOS: the keychain entry with the data key (keychain.mjs). */
const KEYCHAIN_SERVICE = `${NAME} data key`;
const WINDOW_FILE = join(USER_DIR, "window.json");

let win = null;
let api = null; // the utility process
let stopping = false;
let log = { path: "", write: (_source, text) => console.log(text), close: async () => {} };
// This launch's session token: the window (and a paired browser) need it for every request.
const token = randomBytes(32).toString("hex");

// One BreadPilot at a time: a second launch brings the open window forward.
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

class KeyError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/**
 * Saved projects or settings exist, so a key must too: a new one would only make them unreadable
 * (and the user would be asked once per file). Said plainly instead, before anything is changed.
 */
function refuseNewKeyForOldData() {
  const found = ["data.enc", "settings.enc"].filter((f) => existsSync(join(DATA_DIR, f)));
  if (found.length) throw new KeyError("key-missing", `no data key, but ${found.join(" and ")} exist`);
}

/**
 * The database key: 32 random bytes made on first start, stored only encrypted by the operating
 * system: the macOS login keychain through Apple's security tool (keychain.mjs: no password prompt
 * after updates), Windows DPAPI or a Linux keyring through safeStorage (key.bin).
 */
async function dataKey() {
  if (process.platform === "darwin") return macDataKey();
  if (!safeStorage.isEncryptionAvailable()) throw new KeyError("storage", "Secure storage isn't available.");
  const stored = await readFile(KEY_FILE).catch((err) => (err.code === "ENOENT" ? null : Promise.reject(err)));
  if (stored) {
    try {
      return safeStorage.decryptString(stored);
    } catch (err) {
      throw new KeyError("key", `The key file couldn't be decrypted: ${err.message}`);
    }
  }
  refuseNewKeyForOldData();
  const key = randomBytes(32).toString("hex");
  await mkdir(USER_DIR, { recursive: true, mode: 0o700 });
  const fh = await open(KEY_FILE, "wx", 0o600);
  await fh.writeFile(safeStorage.encryptString(key));
  await fh.close();
  log.write("main", "made a new data key (first start)");
  return key;
}

async function macDataKey() {
  const keychain = macKeychain({ service: KEYCHAIN_SERVICE });
  try {
    const saved = await keychain.get();
    if (saved) return saved;
    // Builds before 0.2.0 kept the key in key.bin through safeStorage: moved once (macOS may ask for
    // the login password this one last time), then key.bin is deleted.
    const old = await readFile(KEY_FILE).catch((err) => (err.code === "ENOENT" ? null : Promise.reject(err)));
    let key;
    if (old) {
      if ((await ask(keyMoveNotice(NAME), NAME, "info")) !== "continue") throw new KeyError("cancelled", "the key move was cancelled");
      try {
        key = safeStorage.decryptString(old);
      } catch (err) {
        throw new KeyError("key", `The key file couldn't be decrypted: ${err.message}`);
      }
    } else {
      refuseNewKeyForOldData();
      key = randomBytes(32).toString("hex");
    }
    await keychain.set(key);
    if (old) await rm(KEY_FILE, { force: true });
    log.write("main", old ? "moved the data key from key.bin to the keychain" : "made a new data key (first start)");
    return key;
  } catch (err) {
    if (err instanceof KeychainError) throw new KeyError(err.kind, err.message);
    throw err;
  }
}

/**
 * Linux without a keyring (GNOME Keyring, KWallet…): safeStorage still "works" but encrypts with a
 * password built into Electron, so anyone with a copy of the files could decrypt them. The database
 * still opens (projects stay on this computer), but the engine refuses to keep an OpenAI key.
 */
function weakKeyStorage() {
  if (process.platform !== "linux") return false;
  const backend = safeStorage.getSelectedStorageBackend();
  if (backend === "basic_text" || backend === "unknown") {
    log.write("main", `no keyring (safeStorage backend: ${backend}): an OpenAI key won't be saved`);
    return true;
  }
  return false;
}

/** The engine's output goes to the log (and to the terminal while developing). */
function pipeToLog(stream) {
  let rest = "";
  stream?.on("data", (chunk) => {
    const lines = (rest + chunk.toString()).split("\n");
    rest = lines.pop() ?? "";
    for (const l of lines) {
      log.write("engine", l);
      if (DEV) process.stdout.write(`${l}\n`);
    }
  });
}

/** Starts the engine; resolves with { type: "ready", url, pairingUrl } or { type: "error", kind, message }. */
async function startEngine() {
  let key;
  try {
    key = await dataKey();
  } catch (err) {
    return { type: "error", kind: err instanceof KeyError ? err.kind : "other", message: err.message };
  }
  api = utilityProcess.fork(PATHS.engine, [], { serviceName: "BreadPilot API", stdio: "pipe" });
  pipeToLog(api.stdout);
  pipeToLog(api.stderr);
  const child = api;
  return new Promise((ok) => {
    child.once("message", ok);
    child.once("exit", (code) => ok({ type: "error", kind: "exit", message: `The engine stopped while starting (code ${code}).` }));
    child.postMessage({ type: "start", dataDir: DATA_DIR, key, token, webDir: PATHS.web, repoDir: PATHS.docs, migrationsDir: PATHS.migrations, template: TEMPLATE, weakKeyStorage: weakKeyStorage() });
  });
}

/** Shows a problem dialog; resolves with the chosen action. */
async function ask(problem, title, type = "warning") {
  log.write("main", `${title}: ${problem.message}`);
  const { response } = await dialog.showMessageBox(win ?? undefined, {
    type,
    title,
    message: problem.message,
    detail: problem.detail,
    buttons: problem.buttons.map((b) => b.label),
    defaultId: 0,
    cancelId: problem.buttons.findIndex((b) => b.action === "quit"),
    noLink: true,
  });
  return problem.buttons[response]?.action ?? "quit";
}

/** "Start fresh": the unreadable files are renamed (…broken-DATE), never deleted. */
async function setAside(kind) {
  const { response } = await dialog.showMessageBox(win ?? undefined, {
    type: "question",
    title: "Start fresh?",
    message: kind === "settings" ? "Start with default settings?" : "Start with no saved projects?",
    detail: "The old files stay in BreadPilot's data folder under a new name, so they can still be recovered later.",
    buttons: ["Start fresh", "Cancel"],
    defaultId: 1,
    cancelId: 1,
  });
  if (response !== 0) return false;
  for (const rel of filesToSetAside(kind)) {
    const file = join(USER_DIR, rel);
    await rename(file, brokenName(file)).then(
      () => log.write("main", `kept ${rel} aside as ${brokenName(rel)}`),
      (err) => err.code !== "ENOENT" && log.write("main", `couldn't move ${rel}: ${err.message}`),
    );
  }
  // macOS keeps the key in the keychain, not in key.bin: an unusable one is replaced there.
  if (kind === "key" && process.platform === "darwin") {
    await macKeychain({ service: KEYCHAIN_SERVICE })
      .set(randomBytes(32).toString("hex"))
      .then(
        () => log.write("main", "replaced the unusable key in the keychain"),
        (err) => log.write("main", `couldn't replace the key in the keychain: ${err.message}`),
      );
  }
  return true;
}

/** Starts the engine until it runs, letting the user decide on every problem. Resolves with "ready" or quits. */
async function startWithChoices(title) {
  for (;;) {
    const r = await startEngine();
    if (r.type === "ready") return r;
    if (r.kind === "cancelled") {
      app.exit(0);
      return null;
    }
    api?.kill();
    api = null;
    for (;;) {
      const action = await ask(startupProblem(r.kind, r.message, process.platform), title);
      if (action === "quit") {
        app.exit(1);
        return null;
      }
      if (action === "folder") void shell.openPath(USER_DIR);
      else if (action === "log") shell.showItemInFolder(log.path);
      else if (action === "fresh" && !(await setAside(r.kind))) continue;
      if (action === "retry" || action === "fresh") break; // start again
    }
  }
}

/** The engine stopped while the window was open: offer to restart it. */
function watchEngine() {
  api?.once("exit", async (code) => {
    if (stopping) return;
    log.write("main", `engine stopped unexpectedly (code ${code})`);
    api = null;
    for (;;) {
      const action = await ask(crashProblem(), NAME);
      if (action === "quit") return app.quit();
      if (action === "log") {
        shell.showItemInFolder(log.path);
        continue;
      }
      const ready = await startWithChoices("BreadPilot can't restart");
      if (!ready) return;
      setOrigin(ready.url);
      watchEngine();
      await win?.loadURL(ready.pairingUrl);
      return;
    }
  });
}

let origin = "";
const setOrigin = (url) => (origin = new URL(url).origin);

async function createWindow(pairingUrl) {
  const saved = await readWindowState(WINDOW_FILE);
  const { bounds, maximized } = restoreBounds(saved, screen.getAllDisplays().map((d) => d.workArea));
  win = new BrowserWindow({
    ...bounds,
    minWidth: 760,
    minHeight: 520,
    title: NAME,
    backgroundColor: "#0b0d12",
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  if (maximized) win.maximize();
  win.once("ready-to-show", () => win?.show());

  // Size and place, saved shortly after a change and when the window closes.
  let timer;
  const save = () => {
    if (!win || win.isMinimized()) return;
    void writeWindowState(WINDOW_FILE, { ...win.getNormalBounds(), maximized: win.isMaximized() }).catch(() => {});
  };
  for (const ev of ["resize", "move", "maximize", "unmaximize"]) {
    win.on(ev, () => {
      clearTimeout(timer);
      timer = setTimeout(save, 500);
    });
  }
  win.on("close", save);

  // Other sites open in the normal browser; the window never leaves the app or opens new windows.
  const external = (url) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
  };
  win.webContents.setWindowOpenHandler(({ url }) => {
    external(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (new URL(url).origin !== origin) {
      e.preventDefault();
      external(url);
    }
  });
  win.webContents.on("console-message", (e) => {
    if (e.level === "error") log.write("page", `${e.message} (${e.sourceId}:${e.lineNumber})`);
  });
  // Logged only: reloading by itself could loop if the page keeps crashing (View → Reload in development).
  win.webContents.on("render-process-gone", (_e, d) => log.write("page", `the page stopped: ${d.reason}`));
  win.on("closed", () => (win = null));
  await win.loadURL(pairingUrl);
}

app.whenReady().then(async () => {
  log = await openLog(join(USER_DIR, "logs")).catch(() => log);
  log.write("main", `BreadPilot ${app.getVersion()} starting (Electron ${process.versions.electron}, ${process.platform}-${process.arch})`);
  Menu.setApplicationMenu(
    buildMenu({
      isMac: process.platform === "darwin",
      dev: DEV,
      actions: { openLog: () => shell.showItemInFolder(log.path), openDataFolder: () => void shell.openPath(USER_DIR) },
    }),
  );
  const ready = await startWithChoices("BreadPilot can't start");
  if (!ready) return;
  log.write("main", "engine ready");
  setOrigin(ready.url);
  watchEngine();
  await createWindow(ready.pairingUrl);
});

// Save the database before quitting: ask the API process to stop and wait for it (up to 10 s).
app.on("before-quit", (e) => {
  if (!api || stopping) return;
  e.preventDefault();
  stopping = true;
  log.write("main", "quitting: saving the projects");
  const done = () => void log.close().finally(() => app.exit(0));
  const timer = setTimeout(done, 10_000);
  api.on("message", (m) => {
    if (m.type === "stopped") {
      clearTimeout(timer);
      done();
    }
  });
  api.once("exit", () => {
    clearTimeout(timer);
    done();
  });
  api.postMessage({ type: "stop" });
});

app.on("window-all-closed", () => app.quit());
