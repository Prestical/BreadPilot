// Leak check for the staged app or a built installer (D7). Run before anything ships:
//
//   node scripts/check-leaks.mjs .stage        node scripts/check-leaks.mjs release
//
// Looks for private things that must never be inside a download, using the real values from this
// computer at scan time (none of them is written in this file): the home folder path and user
// name, the computer's name, the git e-mail address, every key, token and password in the repo's .env,
// the development database key from .local; anything shaped like an OpenAI key; private file and folder names. Compressed files
// (the ready-made database) are unpacked and checked too, and so are the installers themselves.
// Reports file + rule, never the value.
// Exit code 1 when anything is found.

import { execFileSync } from "node:child_process";
import { lstat, mkdtemp, readdir, readFile } from "node:fs/promises";
import { homedir, hostname, tmpdir, userInfo } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import { gunzipSync } from "node:zlib";

const REPO = resolve(import.meta.dirname, "../../..");

/** Names that are private wherever they appear (any path segment). */
const PRIVATE_NAMES = [
  /^\.env(\..*)?$/, // .env, .env.local … (the OpenAI key lives there)
  /^\.local$/, // saved projects, development database and key
  /^\.claude$/, /^\.cc-writes$/, // assistant workflow folders
  /^\.git$/, /^\.DS_Store$/,
  /^(MEMORY|CLAUDE)\.md$/, /^PLAN(-.*)?\.md$/, // private notes
  /^.*-eval\.json$/, // eval results
  /\.enc$/, /^key\.bin$/, /^dev-key\.hex$/, /^data\.lock$/, /^window\.json$/, // app data
  /\.map$/, // source maps (can carry build paths)
];

/**
 * Text that looks like an OpenAI secret key ("sk-…", "sk-proj-…"), not glued to a word before it:
 * Electron's own code has "Mask-SubgroupEqMask-…", "kiosk-app…" and language lists ("HRsk-SK…").
 */
const OPENAI_KEY_SHAPE = /(?<![A-Za-z0-9_-])sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/;

const quiet = (fn) => {
  try {
    return fn();
  } catch {
    return "";
  }
};

/** The private values of this computer, each with a label that's safe to print. */
async function secretsHere() {
  const out = [];
  const add = (label, value) => {
    if (value && value.length >= 6) out.push({ label, bytes: Buffer.from(value) });
  };
  add("home folder path", homedir());
  const user = quiet(() => userInfo().username);
  if (user) add("user name in a path", `${sep}${user}${sep}`);
  // Not the generic macOS default ("MacBook-Air") alone: that would match nothing personal.
  const host = quiet(() => hostname());
  if (host && !/^(MacBook|iMac|Mac(mini|-mini)|localhost)/i.test(host)) add("computer name", host);
  add("git e-mail address", quiet(() => execFileSync("git", ["config", "user.email"], { cwd: REPO, encoding: "utf8" }).trim()));
  // Every secret in .env, not only the OpenAI key (passwords, connection strings, tokens).
  const env = await readFile(join(REPO, ".env"), "utf8").catch(() => "");
  for (const [, name, value] of env.matchAll(/^([A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL)[A-Z0-9_]*)=["']?([^"'\s]+)/gm)) {
    add(`${name} from .env`, value);
  }
  add("development database key", (await readFile(join(REPO, ".local/data/dev-key.hex"), "utf8").catch(() => "")).trim());
  return out;
}

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    yield { path, name: entry.name, dir: entry.isDirectory() };
    // Symlinks aren't followed (node_modules/.bin): their targets are scanned where they live.
    if (entry.isDirectory() && !(await lstat(path)).isSymbolicLink()) yield* files(path);
  }
}

/**
 * electron-builder's output folder holds the installers, the unpacked apps they were made from, and
 * its own build logs. What goes to users is inside the unpacked apps (the installers are compressed
 * copies of them), so those are scanned; the logs carry local paths and must never be uploaded.
 */
async function releaseTargets(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  if (!entries.some((e) => e.name.startsWith("builder-"))) return null;
  const apps = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const sub = join(dir, e.name);
    if (e.name.endsWith("-unpacked")) apps.push(join(sub, "resources"));
    for (const inner of await readdir(sub).catch(() => [])) if (inner.endsWith(".app")) apps.push(join(sub, inner, "Contents", "Resources"));
  }
  const installers = entries.filter((e) => e.isFile() && /\.(dmg|exe|AppImage)$/.test(e.name)).map((e) => join(dir, e.name));
  const doNotUpload = entries.filter((e) => e.isFile() && !/\.(dmg|exe|AppImage|blockmap)$/.test(e.name)).map((e) => e.name);
  return { apps, installers, doNotUpload };
}

/**
 * The downloads themselves, not just the folders they were made from: every installer's raw bytes
 * (catches anything stored uncompressed), and on macOS each .dmg mounted read-only and scanned like
 * a folder. A .dmg that can't be opened fails the check rather than passing unchecked.
 */
async function scanInstallers(installers) {
  let failed = false;
  for (const file of installers) {
    failed = (await scanBytes(file)) || failed;
    if (!file.endsWith(".dmg")) continue;
    if (process.platform !== "darwin") {
      console.log(`${relative(REPO, file)}: not opened (only macOS can mount a .dmg); its app folder was checked`);
      continue;
    }
    const mount = await mkdtemp(join(tmpdir(), "breadpilot-dmg-"));
    try {
      execFileSync("hdiutil", ["attach", "-readonly", "-nobrowse", "-noautoopen", "-mountpoint", mount, file], { stdio: "pipe" });
    } catch (err) {
      console.error(`LEAK CHECK FAILED: couldn't open ${relative(REPO, file)} to check it (${String(err.stderr ?? err.message).trim()})`);
      failed = true;
      continue;
    }
    try {
      // The .dmg's own window layout (icon positions) is a .DS_Store at its top; its bytes are still checked.
      failed = (await scan(mount, { dmgLayout: true })) || failed;
    } finally {
      quiet(() => execFileSync("hdiutil", ["detach", mount, "-force"], { stdio: "pipe" }));
    }
  }
  return failed;
}

async function main() {
  const given = resolve(process.argv[2] ?? join(REPO, "apps/desktop/.stage"));
  const release = await releaseTargets(given);
  if (release) {
    if (!release.apps.length) throw new Error(`no packaged app found in ${given}`);
    let failed = false;
    for (const app of release.apps) failed = (await scan(app)) || failed;
    failed = (await scanInstallers(release.installers)) || failed;
    console.log(`\nUpload only the installers (.dmg, .exe, .AppImage) from ${given}. Never upload: ${release.doNotUpload.join(", ") || "(nothing else here)"}: build logs with local paths.`);
    if (failed) process.exit(1);
    return;
  }
  if (await scan(given)) process.exit(1);
}

/** Adds a finding for each private value or key-shaped text in `buf`. */
function check(secrets, findings, where, buf) {
  for (const s of secrets) if (buf.includes(s.bytes)) findings.push(`${where}: contains the ${s.label}`);
  if (OPENAI_KEY_SHAPE.test(buf.toString("latin1"))) findings.push(`${where}: contains something shaped like an OpenAI key`);
}

function report(findings) {
  if (findings.length) {
    console.error(`\nLEAK CHECK FAILED (${findings.length}):\n${findings.map((f) => `  - ${f}`).join("\n")}`);
    return true;
  }
  console.log("leak check passed: nothing private found");
  return false;
}

/** Scans one file's raw bytes (an installer); returns true when something was found. */
async function scanBytes(file) {
  const findings = [];
  check(await secretsHere(), findings, basename(file), await readFile(file));
  console.log(`checked the raw bytes of ${basename(file)}`);
  return report(findings);
}

/** Scans one folder; returns true when something was found. */
async function scan(target, { dmgLayout = false } = {}) {
  const secrets = await secretsHere();
  const findings = [];
  let scanned = 0;
  for await (const f of files(target)) {
    const rel = relative(target, f.path);
    const layoutFile = dmgLayout && rel === ".DS_Store";
    if (!layoutFile && PRIVATE_NAMES.some((re) => re.test(f.name))) findings.push(`${rel}: private file name`);
    if (f.dir) continue;
    const st = await lstat(f.path);
    if (!st.isFile()) continue;
    const buf = await readFile(f.path);
    scanned++;
    check(secrets, findings, rel, buf);
    if (f.name.endsWith(".gz")) check(secrets, findings, `${rel} (unpacked)`, quiet(() => gunzipSync(buf)) || Buffer.alloc(0));
  }
  console.log(`checked ${scanned} files in ${target} against ${secrets.length} private values from this computer, the OpenAI key shape and ${PRIVATE_NAMES.length} private names`);
  return report(findings);
}

main().catch((err) => {
  console.error(`leak check couldn't run: ${err.message}`);
  process.exit(1);
});
