// The macOS key storage (keychain.mjs) against a fake `security` tool that behaves like the real one:
// exit 44 for a missing entry, -i reads commands from standard input and fails only as text.
import { describe, expect, it } from "vitest";
import { KeychainError, macKeychain } from "../src/keychain.mjs";

const KEY = "ab".repeat(32);
const SERVICE = "BreadPilot data key";

function fakeSecurity({ locked = false, stored = new Map() } = {}) {
  const calls = [];
  const run = async (args, input = "") => {
    calls.push({ args, input });
    if (locked) return { code: 51, stdout: "", stderr: "security: SecKeychainSearchCopyNext: User interaction is not allowed." };
    if (args[0] === "find-generic-password") {
      const value = stored.get(`${args[2]}|${args[4]}`);
      return value === undefined ? { code: 44, stdout: "", stderr: "The specified item could not be found in the keychain." } : { code: 0, stdout: `${value}\n`, stderr: "" };
    }
    if (args[0] === "-i") {
      const m = /^add-generic-password -U -s "([^"]+)" -a (\S+) -l "[^"]+" -w (\S+)\n$/.exec(input);
      if (!m) return { code: 0, stdout: "", stderr: "unknown command" };
      stored.set(`${m[1]}|${m[2]}`, m[3]);
      return { code: 0, stdout: "", stderr: "" };
    }
    return { code: 1, stdout: "", stderr: "unexpected" };
  };
  return { run, calls, stored };
}

describe("macKeychain", () => {
  it("has no key before the first start", async () => {
    const { run } = fakeSecurity();
    expect(await macKeychain({ service: SERVICE, run }).get()).toBeNull();
  });

  it("saves the key through standard input, never in the arguments, and reads it back", async () => {
    const fake = fakeSecurity();
    const chain = macKeychain({ service: SERVICE, run: fake.run });
    await chain.set(KEY);
    expect(await chain.get()).toBe(KEY);
    for (const c of fake.calls) expect(c.args.join(" ")).not.toContain(KEY);
    expect(fake.calls.find((c) => c.args[0] === "-i")?.input).toContain(KEY);
  });

  it("keeps the development app's key apart", async () => {
    const fake = fakeSecurity();
    await macKeychain({ service: "BreadPilot Dev data key", run: fake.run }).set(KEY);
    expect(await macKeychain({ service: SERVICE, run: fake.run }).get()).toBeNull();
  });

  it("fails as 'storage' when the keychain can't be used, without the key in the message", async () => {
    const chain = macKeychain({ service: SERVICE, run: fakeSecurity({ locked: true }).run });
    await expect(chain.get()).rejects.toMatchObject({ kind: "storage" });
    const err = await chain.set(KEY).catch((e) => e);
    expect(err).toBeInstanceOf(KeychainError);
    expect(err.kind).toBe("storage");
    expect(err.message).not.toContain(KEY);
  });

  it("notices a save that silently didn't happen", async () => {
    const fake = fakeSecurity();
    const run = (args, input) => (args[0] === "-i" ? Promise.resolve({ code: 0, stdout: "", stderr: "" }) : fake.run(args, input));
    await expect(macKeychain({ service: SERVICE, run }).set(KEY)).rejects.toMatchObject({ kind: "storage" });
  });

  it("refuses an entry that isn't a BreadPilot key", async () => {
    const fake = fakeSecurity({ stored: new Map([[`${SERVICE}|breadpilot`, "hunter2"]]) });
    await expect(macKeychain({ service: SERVICE, run: fake.run }).get()).rejects.toMatchObject({ kind: "key" });
  });
});
