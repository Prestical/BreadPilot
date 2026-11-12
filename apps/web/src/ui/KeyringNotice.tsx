// Linux with no keyring (GNOME Keyring, KWallet…): BreadPilot still starts (its key in a user-only
// file, apps/desktop/src/keyfile.mjs), but it never saves an OpenAI key there. This small warning
// says so and why, at the bottom of the project list, until "Got it". Once a keyring is installed
// the next start moves the key into it and the warning no longer shows. Settings → OpenAI keeps the
// full explanation.
import { useEffect, useState } from "react";
import { useApp } from "../store";
import { getSettings } from "../projects/api";
import { Icon } from "./Icon";

export const KEYRING_DISMISSED_KEY = "breadpilot.keyring-notice-dismissed";

function dismissed(): boolean {
  try {
    return localStorage.getItem(KEYRING_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Shown when the computer can't protect a key and the warning wasn't put away with "Got it". */
export function showKeyringNotice(keyRefused: string | null | undefined, hidden: boolean): boolean {
  return !!keyRefused && !hidden;
}

export function KeyringNotice() {
  const [refused, setRefused] = useState<string | null>(null);
  const [hidden, setHidden] = useState(dismissed);
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);
  useEffect(() => {
    // Quiet when the settings can't be read: the status line already says when the server is down.
    getSettings().then((v) => setRefused(v.openai.keyRefused ?? null), () => {});
  }, []);
  if (!showKeyringNotice(refused, hidden)) return null;
  const gotIt = () => {
    try {
      localStorage.setItem(KEYRING_DISMISSED_KEY, "1");
    } catch {
      /* storage blocked: hidden until the app restarts */
    }
    setHidden(true);
  };
  return (
    <section className="keyring-notice" role="note" aria-label="No keyring found">
      <p>
        <Icon name="alert" /> <strong>No keyring found.</strong>
      </p>
      <p>
        BreadPilot won't save an OpenAI key on this computer. Without a keyring (such as GNOME Keyring or KWallet), it can't lock its files away safely, so anyone who got a copy could use the key. The local AI works as usual. Install or unlock a keyring and restart BreadPilot to use OpenAI.
      </p>
      <div className="card-actions">
        <button type="button" className="btn small-btn" onClick={() => setSettingsOpen(true, "openai")}>
          How to fix
        </button>
        <button type="button" className="btn small-btn" onClick={gotIt}>
          Got it
        </button>
      </div>
    </section>
  );
}
