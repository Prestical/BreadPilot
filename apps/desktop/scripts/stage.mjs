// Puts exactly the files the packaged app needs into apps/desktop/.stage (PLAN §19.4j, D7). An
// allowlist on purpose: nothing is copied because it happens to be in a folder. Private files that
// live in the repo folder but must never ship (.env with the OpenAI key, .local with saved projects
// and the development key, notes, assistant folders, .DS_Store) can't get in this way, and
// scripts/check-leaks.mjs checks the result anyway.
//
//   npm run build -w @breadpilot/api && npm run build -w @breadpilot/web
//   node scripts/stage.mjs

import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const DESKTOP = resolve(import.meta.dirname, "..");
const REPO = resolve(DESKTOP, "../..");
const STAGE = join(DESKTOP, ".stage");

/** The desktop app's own code (named, not "every file in src": src may hold other files). */
const APP_FILES = ["main.mjs", "keychain.mjs", "log.mjs", "menu.mjs", "problems.mjs", "windowState.mjs"];
/** Packages the engine loads at runtime (esbuild leaves them out of desktop.js). */
const ENGINE_PACKAGES = ["@electric-sql/pglite", "@electric-sql/pglite-pgvector", "@fastify/static", "fastify", "pdfjs-dist", "zod"];

/**
 * The oldest Electron the installers may carry: 44.10.1 has Node 24.22.1, the October 2026 Node
 * security release (Brotli decoder RCE CVE-2026-111497, TLS and DNS fixes). Raise it with each
 * security release; scripts/stage.mjs refuses anything older.
 */
const MIN_ELECTRON = "44.10.1";

const hidden = (name) => name.startsWith(".");

const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => v.split(".").map(Number));
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
};

/** The installers use electron-builder.yml's electronVersion: it must match the tested one and be new enough. */
async function checkElectron(desktopPkg) {
  const tested = desktopPkg.devDependencies.electron;
  const packaged = /^electronVersion:\s*(\S+)/m.exec(await readFile(join(DESKTOP, "electron-builder.yml"), "utf8"))?.[1];
  if (packaged !== tested) throw new Error(`electron-builder.yml packages Electron ${packaged} but the app is developed and tested with ${tested}: make them the same.`);
  if (newer(MIN_ELECTRON, tested)) throw new Error(`Electron ${tested} is older than ${MIN_ELECTRON}, which has the latest Node security fixes: update it.`);
}

/** Copies `from` → `to` recursively, keeping only files `keep(name)` accepts; hidden entries never. */
async function copyTree(from, to, keep) {
  let count = 0;
  for (const entry of await readdir(from, { withFileTypes: true })) {
    if (hidden(entry.name)) continue;
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) count += await copyTree(src, dst, keep);
    else if (entry.isFile() && keep(entry.name)) {
      await mkdir(dirname(dst), { recursive: true });
      await copyFile(src, dst);
      count++;
    }
  }
  return count;
}

async function copyOne(from, to) {
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

/**
 * Packages from npm carry files the app never loads: source maps, type definitions and hidden
 * entries, including whatever their authors published by mistake (thread-stream 4.2.0 ships its
 * authors' .claude/settings.local.json). None of it goes into the app.
 */
async function prune(dir) {
  let removed = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (hidden(entry.name) || (entry.isFile() && /\.(map|d\.[cm]?ts)$/.test(entry.name))) {
      await rm(path, { recursive: true, force: true });
      removed++;
    } else if (entry.isDirectory()) removed += await prune(path);
  }
  return removed;
}

const installedVersion = async (pkg) => JSON.parse(await readFile(join(REPO, "node_modules", pkg, "package.json"), "utf8")).version;

async function main() {
  const desktopPkg = JSON.parse(await readFile(join(DESKTOP, "package.json"), "utf8"));
  await checkElectron(desktopPkg);
  for (const built of ["apps/api/dist/desktop.js", "apps/web/dist/index.html"]) {
    await stat(join(REPO, built)).catch(() => {
      throw new Error(`${built} is missing: run npm run build -w @breadpilot/api and -w @breadpilot/web first.`);
    });
  }

  await rm(STAGE, { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });

  for (const f of APP_FILES) await copyOne(join(DESKTOP, "src", f), join(STAGE, f));
  // The engine without its source map or the comment naming it (maps can carry build paths; the app
  // doesn't need them).
  const engine = await readFile(join(REPO, "apps/api/dist/desktop.js"), "utf8");
  await mkdir(join(STAGE, "engine"), { recursive: true });
  await writeFile(join(STAGE, "engine/desktop.js"), engine.replace(/\n\/\/# sourceMappingURL=\S+\s*$/, "\n"));
  const web = await copyTree(join(REPO, "apps/web/dist"), join(STAGE, "web"), (n) => !n.endsWith(".map"));
  const sql = await copyTree(join(REPO, "db/migrations"), join(STAGE, "migrations"), (n) => n.endsWith(".sql"));
  // Documentation to index: the datasheet PDFs and the verified pinout text, nothing else.
  const pdfs = await copyTree(join(REPO, "docs/hardware"), join(STAGE, "rag/docs/hardware"), (n) => n.endsWith(".pdf"));
  for (const n of await readdir(join(REPO, "data/boards"))) {
    if (n.endsWith(".pinout.generated.md")) await copyOne(join(REPO, "data/boards", n), join(STAGE, "rag/data/boards", n));
  }
  for (const f of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]) await copyOne(join(REPO, f), join(STAGE, f));
  const template = join(DESKTOP, "build/template.tar.gz");
  const hasTemplate = await stat(template).then(() => true, () => false);
  if (hasTemplate) await copyOne(template, join(STAGE, "template.tar.gz"));

  // The app's package.json: written from scratch (no workspace paths, scripts or emails), with the
  // engine's packages at exactly the versions the tests ran with.
  const dependencies = Object.fromEntries(await Promise.all(ENGINE_PACKAGES.map(async (p) => [p, await installedVersion(p)])));
  const pkg = {
    name: "breadpilot",
    productName: "BreadPilot",
    version: desktopPkg.version,
    description: "Describe a hardware project in plain words; build it step by step on a 3D breadboard.",
    license: "Apache-2.0",
    author: "BreadPilot contributors",
    homepage: "https://github.com/Prestical/BreadPilot",
    type: "module",
    main: "main.mjs",
    dependencies,
  };
  await writeFile(join(STAGE, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

  // Production packages only, no install scripts, no optional native extras (pdfjs's canvas: the
  // engine only reads text), no lock file in the app.
  execFileSync("npm", ["install", "--omit=dev", "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", "--workspaces=false"], {
    cwd: STAGE,
    stdio: "inherit",
    env: { ...process.env, npm_config_cache: process.env.npm_config_cache ?? join(process.env.TMPDIR ?? "/tmp", "breadpilot-npm-cache") },
  });

  const pruned = await prune(join(STAGE, "node_modules"));

  console.log(`staged ${STAGE} (${pruned} unneeded package files removed): ${APP_FILES.length} app files, engine, ${web} web files, ${sql} migrations, ${pdfs} PDFs, template: ${hasTemplate ? "yes" : "no (docs are indexed on first start)"}, packages: ${Object.entries(dependencies).map(([k, v]) => `${k}@${v}`).join(", ")}`);
}

main().catch((err) => {
  console.error(`stage failed: ${err.message}`);
  process.exit(1);
});
