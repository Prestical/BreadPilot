import { describe, expect, it } from "vitest";
import { dataKeysText } from "../src/ui/dataKeys";

describe("Settings → Your data and keys", () => {
  it("names the macOS keychain entry, says why there's no password prompt, and the tradeoff", () => {
    const t = dataKeysText("darwin");
    const all = [t.intro, ...t.points].join(" ");
    expect(all).toContain("BreadPilot data key");
    expect(all).toMatch(/never needs to ask for your Mac password/);
    expect(all).toMatch(/Other programs you run on this Mac could read the key/);
    expect(all).toMatch(/BreadPilot never asks for a password in its own window/);
  });

  it("explains Windows and Linux in their own words", () => {
    expect(dataKeysText("win32").intro).toMatch(/protected by Windows/);
    expect(dataKeysText("linux").points.join(" ")).toMatch(/Without a keyring BreadPilot doesn't save an OpenAI key/);
  });

  it("every desktop text says the OpenAI key only goes to OpenAI", () => {
    for (const p of ["darwin", "win32", "linux"]) expect(dataKeysText(p).points[0], p).toMatch(/only ever sent to OpenAI/);
  });

  it("the development server says where its data is instead", () => {
    expect(dataKeysText(null).intro).toMatch(/development server/);
    expect(dataKeysText(null).points).toEqual([]);
  });
});
