// Linux with no keyring: the warning that no OpenAI key is saved, and why.
import { describe, expect, it } from "vitest";
import { showKeyringNotice } from "../src/ui/KeyringNotice";

describe("no-keyring warning", () => {
  it("shows when the computer can't protect a key, until Got it", () => {
    expect(showKeyringNotice("No keyring was found on this computer…", false)).toBe(true);
    expect(showKeyringNotice("No keyring was found on this computer…", true)).toBe(false);
  });

  it("never shows when a keyring (or the macOS keychain, or Windows) protects the key", () => {
    expect(showKeyringNotice(null, false)).toBe(false);
    expect(showKeyringNotice(undefined, false)).toBe(false);
  });
});
