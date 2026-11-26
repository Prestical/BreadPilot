// The packaged app's lock (security review 16/11/2026): every runtime package at the version and
// hash in the repository's package-lock.json.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { stageLock } from "../scripts/stage-lock.mjs";

const pkg = (version, extra = {}) => ({ version, resolved: `https://registry.npmjs.org/x/-/x-${version}.tgz`, integrity: `sha512-${version}`, ...extra });
const lock = (packages) => ({ lockfileVersion: 3, packages: { "": { name: "repo" }, ...packages } });

describe("stageLock", () => {
  it("keeps only what the wanted packages reach, with their versions, URLs and hashes", () => {
    const out = stageLock(
      lock({
        "node_modules/app": pkg("1.0.0", { dependencies: { dep: "^2.0.0" } }),
        "node_modules/dep": pkg("2.0.1", { dev: true }),
        "node_modules/vitest": pkg("3.0.0", { dev: true }),
        "apps/api": { name: "api" },
      }),
      { app: "1.0.0" },
    );
    expect(Object.keys(out.packages)).toEqual(["", "node_modules/app", "node_modules/dep"]);
    expect(out.packages["node_modules/dep"]).toEqual(pkg("2.0.1")); // the repository's "dev" flag is dropped
    expect(out.packages[""]).toEqual({ name: "breadpilot", version: "0.0.0", dependencies: { app: "1.0.0" } });
  });

  it("finds a nested copy before the hoisted one, as Node does", () => {
    const out = stageLock(
      lock({
        "node_modules/a": pkg("1.0.0", { dependencies: { c: "^1" } }),
        "node_modules/a/node_modules/c": pkg("1.5.0"),
        "node_modules/b": pkg("1.0.0", { dependencies: { c: "^2" } }),
        "node_modules/c": pkg("2.0.0"),
      }),
      { a: "1.0.0", b: "1.0.0" },
    );
    expect(out.packages["node_modules/a/node_modules/c"].version).toBe("1.5.0");
    expect(out.packages["node_modules/c"].version).toBe("2.0.0");
  });

  it("keeps optional packages marked optional and follows peers", () => {
    const out = stageLock(
      lock({
        "node_modules/a": pkg("1.0.0", { optionalDependencies: { native: "1", gone: "1" }, peerDependencies: { p: "1", q: "1" }, peerDependenciesMeta: { q: { optional: true } } }),
        "node_modules/native": pkg("1.0.0", { devOptional: true }),
        "node_modules/p": pkg("1.0.0", { peer: true }),
      }),
      { a: "1.0.0" },
    );
    expect(out.packages["node_modules/native"].optional).toBe(true);
    expect(out.packages["node_modules/native"].devOptional).toBeUndefined();
    expect(out.packages["node_modules/p"].peer).toBeUndefined();
  });

  it("refuses a version the lock doesn't have, a missing package, a workspace link or no hash", () => {
    const base = { "node_modules/a": pkg("1.0.0") };
    expect(() => stageLock(lock(base), { a: "1.0.1" })).toThrow(/wants 1.0.1 but package-lock.json has 1.0.0/);
    expect(() => stageLock(lock(base), { b: "1.0.0" })).toThrow(/not in package-lock.json/);
    expect(() => stageLock(lock({ "node_modules/a": pkg("1.0.0", { dependencies: { m: "1" } }) }), { a: "1.0.0" })).toThrow(/needs m/);
    expect(() => stageLock(lock({ "node_modules/a": { version: "1.0.0", link: true, resolved: "apps/a" } }), { a: "1.0.0" })).toThrow(/workspace link/);
    expect(() => stageLock(lock({ "node_modules/a": { version: "1.0.0" } }), { a: "1.0.0" })).toThrow(/no download address or hash/);
    expect(() => stageLock({ lockfileVersion: 2, packages: {} }, {})).toThrow(/lockfileVersion 3/);
  });

  it("builds the real app's lock from the repository's package-lock.json", () => {
    const root = JSON.parse(readFileSync(join(resolve(import.meta.dirname, "../../.."), "package-lock.json"), "utf8"));
    const engine = ["@electric-sql/pglite", "@electric-sql/pglite-pgvector", "@fastify/static", "fastify", "pdfjs-dist", "zod"];
    const wanted = Object.fromEntries(engine.map((p) => [p, root.packages[`node_modules/${p}`].version]));
    const out = stageLock(root, wanted);
    const paths = Object.keys(out.packages).filter(Boolean);
    expect(paths.length).toBeGreaterThan(engine.length);
    for (const p of paths) {
      expect(out.packages[p].integrity, p).toMatch(/^sha512-/);
      expect(out.packages[p].dev, p).toBeUndefined();
    }
    // Nothing from the build tools or tests gets in.
    for (const tool of ["vitest", "typescript", "electron", "esbuild", "vite"]) expect(paths, tool).not.toContain(`node_modules/${tool}`);
  });
});
