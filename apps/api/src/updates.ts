// M11 11.6: "a new version is available". Only the desktop app checks (it knows its own version),
// at most once a day, when it starts, and only while Settings → Updates allows it. The check is
// one GET of the latest release's details from GitHub: the request carries nothing about the user,
// this computer or the projects (no version, no id; a fixed User-Agent, which GitHub requires).
// Without a connection it stays quiet and tries again at the next start.
//
//   GET /api/update → UpdateInfo, or { current: null } in development

import type { FastifyInstance } from "fastify";
import type { SettingsStore } from "./settings";

export const RELEASES_API = "https://api.github.com/repos/Prestical/BreadPilot/releases/latest";
/** Where the notice sends the user: the release page, where the installers are. */
export const RELEASES_PAGE = "https://github.com/Prestical/BreadPilot/releases/latest";
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

export interface UpdateInfo {
  /** This app's version; null in development (no check). */
  current: string | null;
  /** The newest release's version as last seen, or null (never checked, no release yet, or off). */
  latest: string | null;
  available: boolean;
  url: string;
}

/** "v1.2.3" / "1.2.3" → [1, 2, 3]; anything else (e.g. "1.2.3-beta") → null. */
export function parseVersion(v: string | null | undefined): [number, number, number] | null {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(v?.trim() ?? "");
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(latest: string | null, current: string | null): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}

/**
 * The newest published release's version (drafts and pre-releases aren't "latest" on GitHub);
 * null when the repository has no release yet. Throws when GitHub can't be reached or answers oddly.
 */
export async function fetchLatest(fetchFn: typeof fetch = fetch): Promise<string | null> {
  const res = await fetchFn(RELEASES_API, {
    headers: { accept: "application/vnd.github+json", "user-agent": "BreadPilot" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "follow",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const body = (await res.json()) as { tag_name?: unknown };
  const tag = typeof body.tag_name === "string" ? body.tag_name.trim() : "";
  const v = parseVersion(tag);
  if (!v) throw new Error(`the latest release's tag isn't a version number ("${tag.slice(0, 40)}")`);
  return v.join(".");
}

export interface UpdateDeps {
  /** The desktop app's version; null/undefined = development, never checks. */
  appVersion?: string | null;
  settings: SettingsStore;
  /** Saves the check's time and result (the settings writer's queue). */
  save(fn: (s: ReturnType<SettingsStore["get"]>) => ReturnType<SettingsStore["get"]>): Promise<void>;
  fetchLatest?: () => Promise<string | null>;
  now?: () => Date;
  log?: (msg: string) => void;
}

export function updateChecker(deps: UpdateDeps) {
  const now = () => deps.now?.() ?? new Date();
  let running: Promise<void> | null = null;

  const info = (): UpdateInfo => {
    const current = deps.appVersion ?? null;
    const u = deps.settings.get().updates;
    const latest = current && u.check ? u.latest : null;
    return { current, latest, available: isNewer(latest, current), url: RELEASES_PAGE };
  };

  /** Asks GitHub if it's on, in the desktop app, and the last answer is a day old; else does nothing. */
  const check = async (): Promise<UpdateInfo> => {
    const u = deps.settings.get().updates;
    const last = u.lastCheck ? Date.parse(u.lastCheck) : NaN;
    const due = !Number.isFinite(last) || now().getTime() - last >= CHECK_EVERY_MS || last > now().getTime();
    if (deps.appVersion && u.check && due) {
      // Two pages asking at once share one request.
      running ??= (async () => {
        try {
          const latest = await (deps.fetchLatest ?? fetchLatest)();
          const at = now().toISOString();
          await deps.save((s) => ({ ...s, updates: { ...s.updates, lastCheck: at, latest } }));
          if (isNewer(latest, deps.appVersion ?? null)) deps.log?.(`updates: version ${latest} is available`);
        } catch (err) {
          deps.log?.(`updates: couldn't check for a new version (${(err as Error).message}); trying again at the next start`);
        }
      })();
      await running;
    }
    return info();
  };

  return { check, info };
}

export function registerUpdateRoutes(app: FastifyInstance, checker: ReturnType<typeof updateChecker>) {
  app.get("/api/update", async () => checker.check());
}
