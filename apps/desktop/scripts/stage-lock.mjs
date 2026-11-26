// The packaged app's lock file, cut out of the repository's package-lock.json (security review
// 16/11/2026). The app installs its runtime packages in .stage with `npm ci`, so every package in
// an installer, down to the last dependency of a dependency, is the version (and the tarball hash)
// the tests ran with. Without it npm picks the newest matching versions on the day of the build.

/** `name` as Node finds it from the package at `from` (a lock path): nearest node_modules first. */
function resolveIn(packages, from, name) {
  let dir = from;
  for (;;) {
    const path = `${dir ? `${dir}/` : ""}node_modules/${name}`;
    if (packages[path]) return path;
    if (!dir) return undefined;
    const i = dir.lastIndexOf("/node_modules/");
    dir = i === -1 ? "" : dir.slice(0, i);
  }
}

/**
 * Builds a lockfileVersion 3 lock for an app whose dependencies are `wanted` (name → exact
 * version), from the repository's lock. Every package `wanted` reaches (dependencies, optional
 * ones and peers) keeps its path, version, `resolved` URL and `integrity` hash. Throws when a
 * wanted version isn't the locked one or a package can't be found in the lock.
 */
export function stageLock(rootLock, wanted, meta = { name: "breadpilot", version: "0.0.0" }) {
  if (rootLock.lockfileVersion !== 3 || !rootLock.packages) throw new Error("package-lock.json must be lockfileVersion 3: run npm install with npm 9 or newer.");
  const all = rootLock.packages;
  const out = {};
  const todo = [];
  for (const [name, version] of Object.entries(wanted)) {
    const path = `node_modules/${name}`;
    const entry = all[path];
    if (!entry) throw new Error(`${name} is not in package-lock.json: run npm install.`);
    if (entry.version !== version) throw new Error(`${name}: the app wants ${version} but package-lock.json has ${entry.version}.`);
    todo.push(path);
  }
  while (todo.length) {
    const path = todo.pop();
    if (out[path]) continue;
    const entry = all[path];
    if (entry.link) throw new Error(`${path} is a workspace link, not a package from npm.`);
    if (!entry.resolved || !entry.integrity) throw new Error(`${path} has no download address or hash in package-lock.json.`);
    // The flags describe the repository (dev tools, test-only packages); in the app everything here is
    // a runtime package. Optional stays optional (--omit=optional skips it).
    const { dev, devOptional, peer, ...rest } = entry;
    out[path] = devOptional ? { ...rest, optional: true } : rest;
    const peersOptional = entry.peerDependenciesMeta ?? {};
    const deps = [
      ...Object.keys(entry.dependencies ?? {}).map((n) => [n, false]),
      ...Object.keys(entry.optionalDependencies ?? {}).map((n) => [n, true]),
      ...Object.keys(entry.peerDependencies ?? {}).map((n) => [n, Boolean(peersOptional[n]?.optional)]),
    ];
    for (const [name, optional] of deps) {
      const found = resolveIn(all, path, name);
      if (found) todo.push(found);
      else if (!optional) throw new Error(`${path} needs ${name}, which is not in package-lock.json.`);
    }
  }
  const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
  return {
    name: meta.name,
    version: meta.version,
    lockfileVersion: 3,
    requires: true,
    packages: { "": { name: meta.name, version: meta.version, dependencies: wanted }, ...sorted },
  };
}
