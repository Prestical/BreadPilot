// macOS: the database key in the login keychain, written and read by Apple's own `security` tool
// (PLAN §19.4k). Electron's safeStorage ties its keychain entry to the exact app build; without an
// Apple Developer ID every update is a "new app" and macOS asks for the login password. The
// `security` tool's identity never changes, so it never asks. The entry is still encrypted with the
// login password (a stolen disk or a backup can't open it); what it gives up is that another program
// running as the same user could read it without a prompt. A Developer ID would replace this.
//
// No Electron here, so it's unit-tested with a fake tool.

import { spawn } from "node:child_process";

const SECURITY = "/usr/bin/security";
const ACCOUNT = "breadpilot";
/** errSecItemNotFound, the tool's exit code when there's no entry. */
const NOT_FOUND = 44;
const KEY_SHAPE = /^[0-9a-f]{64}$/;

export class KeychainError extends Error {
  /** @param {"storage" | "key"} kind  as in problems.mjs */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/** Runs the tool; `input` goes to its standard input (never to its arguments, which other programs can see). */
export function runSecurity(args, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(SECURITY, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

/** The tool's own message without anything that could be the key (it never prints it on errors, but still). */
const reason = (r) => (r.stderr.trim().replace(/[0-9a-f]{16,}/gi, "…") || `exit code ${r.code}`);

/**
 * The key entry for this app name ("BreadPilot data key", or "BreadPilot Dev data key" while
 * developing). get() → the key or null when there's none; set() saves it and reads it back.
 */
export function macKeychain({ service, run = runSecurity }) {
  const get = async () => {
    const r = await run(["find-generic-password", "-s", service, "-a", ACCOUNT, "-w"]);
    if (r.code === NOT_FOUND) return null;
    if (r.code !== 0) throw new KeychainError("storage", `The keychain couldn't be read: ${reason(r)}`);
    const key = r.stdout.trim();
    if (!KEY_SHAPE.test(key)) throw new KeychainError("key", `The keychain entry "${service}" isn't a BreadPilot key.`);
    return key;
  };

  const set = async (key) => {
    if (!KEY_SHAPE.test(key)) throw new Error("not a 32-byte hex key");
    // Interactive mode reads the command from standard input, so the key never appears in a process
    // list. It reports failures only as text, hence the read-back below.
    const r = await run(["-i"], `add-generic-password -U -s "${service}" -a ${ACCOUNT} -l "${service}" -w ${key}\n`);
    let back = null;
    try {
      back = await get();
    } catch {
      // reported below
    }
    if (back !== key) throw new KeychainError("storage", `The key couldn't be saved in the keychain: ${reason(r)}`);
  };

  return { get, set };
}
