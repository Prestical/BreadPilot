// M11 11.6: the daily new-version check. Only the desktop app asks, at most once a day, only while
// it's on in Settings, and the request carries nothing but a fixed User-Agent.
import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config";
import { defaultSettings, memorySettings, type Settings } from "../src/settings";
import { fetchLatest, isNewer, parseVersion, RELEASES_API, updateChecker } from "../src/updates";

const settingsWith = (updates: Partial<Settings["updates"]> = {}) => {
  const s = defaultSettings(loadConfig({}), { withKey: false });
  return memorySettings({ ...s, updates: { ...s.updates, ...updates } });
};

function checker(opts: { appVersion?: string | null; latest?: string | null | Error; now?: string; updates?: Partial<Settings["updates"]> }) {
  const settings = settingsWith(opts.updates);
  const fetchLatest = vi.fn(async () => {
    if (opts.latest instanceof Error) throw opts.latest;
    return opts.latest ?? null;
  });
  const log = vi.fn();
  const c = updateChecker({
    appVersion: opts.appVersion,
    settings,
    save: async (fn) => settings.set(fn(settings.get())),
    fetchLatest,
    now: () => new Date(opts.now ?? "2026-11-11T09:00:00Z"),
    log,
  });
  return { c, settings, fetchLatest, log };
}

describe("version numbers", () => {
  it("reads v1.2.3 and 1.2.3, nothing else", () => {
    expect(parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(parseVersion("0.10.0")).toEqual([0, 10, 0]);
    expect(parseVersion("1.2")).toBeNull();
    expect(parseVersion("1.2.3-beta")).toBeNull();
    expect(parseVersion(null)).toBeNull();
  });

  it("compares by number, not as text", () => {
    expect(isNewer("0.10.0", "0.9.9")).toBe(true);
    expect(isNewer("0.2.0", "0.2.0")).toBe(false);
    expect(isNewer("0.1.9", "0.2.0")).toBe(false);
    expect(isNewer("1.0.0", null)).toBe(false);
    expect(isNewer(null, "0.2.0")).toBe(false);
  });
});

describe("the check", () => {
  it("development (no app version) never asks GitHub", async () => {
    const { c, fetchLatest } = checker({ appVersion: null, latest: "9.9.9" });
    expect(await c.check()).toMatchObject({ current: null, latest: null, available: false });
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it("turned off in Settings: never asks, never shows a notice", async () => {
    const { c, fetchLatest } = checker({ appVersion: "0.2.0", latest: "0.3.0", updates: { check: false, latest: "0.3.0", lastCheck: null } });
    expect(await c.check()).toMatchObject({ latest: null, available: false });
    expect(fetchLatest).not.toHaveBeenCalled();
  });

  it("asks once, saves the answer, and shows the notice for a newer version", async () => {
    const { c, settings, fetchLatest } = checker({ appVersion: "0.2.0", latest: "0.3.0" });
    const [a, b] = await Promise.all([c.check(), c.check()]);
    expect(fetchLatest).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ current: "0.2.0", latest: "0.3.0", available: true, url: "https://github.com/Prestical/BreadPilot/releases/latest" });
    expect(b.available).toBe(true);
    expect(settings.get().updates).toEqual({ check: true, lastCheck: "2026-11-11T09:00:00.000Z", latest: "0.3.0" });
  });

  it("within a day of the last answer it doesn't ask again; after a day it does", async () => {
    const recent = checker({ appVersion: "0.2.0", latest: "0.4.0", now: "2026-11-11T20:00:00Z", updates: { lastCheck: "2026-11-11T09:00:00Z", latest: "0.3.0" } });
    expect(await recent.c.check()).toMatchObject({ latest: "0.3.0", available: true });
    expect(recent.fetchLatest).not.toHaveBeenCalled();
    const old = checker({ appVersion: "0.2.0", latest: "0.4.0", now: "2026-11-12T09:00:00Z", updates: { lastCheck: "2026-11-11T09:00:00Z", latest: "0.3.0" } });
    expect(await old.c.check()).toMatchObject({ latest: "0.4.0" });
    expect(old.fetchLatest).toHaveBeenCalledTimes(1);
  });

  it("the same or an older release, or none yet: no notice", async () => {
    expect((await checker({ appVersion: "0.2.0", latest: "0.2.0" }).c.check()).available).toBe(false);
    expect((await checker({ appVersion: "0.3.0", latest: "0.2.0" }).c.check()).available).toBe(false);
    expect((await checker({ appVersion: "0.2.0", latest: null }).c.check()).available).toBe(false);
  });

  it("offline: stays quiet, keeps the last answer, and tries again at the next start", async () => {
    const { c, settings, log } = checker({ appVersion: "0.2.0", latest: new Error("fetch failed"), updates: { lastCheck: "2026-11-01T09:00:00Z", latest: "0.3.0" } });
    expect(await c.check()).toMatchObject({ latest: "0.3.0", available: true });
    expect(settings.get().updates.lastCheck).toBe("2026-11-01T09:00:00Z");
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/couldn't check for a new version \(fetch failed\)/));
  });
});

describe("what is sent to GitHub", () => {
  it("one GET to the latest-release address with only Accept and a fixed User-Agent", async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ tag_name: "v0.3.0", body: "notes" }), { status: 200 }));
    expect(await fetchLatest(fetchFn as unknown as typeof fetch)).toBe("0.3.0");
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(RELEASES_API);
    expect(init?.method ?? "GET").toBe("GET");
    expect(init?.body).toBeUndefined();
    expect(init?.headers).toEqual({ accept: "application/vnd.github+json", "user-agent": "BreadPilot" });
  });

  it("no release yet (404) is null; a tag that isn't a version or another error throws", async () => {
    const answer = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
    expect(await fetchLatest(answer(404))).toBeNull();
    await expect(fetchLatest(answer(200, { tag_name: "nightly" }))).rejects.toThrow(/isn't a version number/);
    await expect(fetchLatest(answer(403))).rejects.toThrow(/GitHub answered 403/);
  });
});
