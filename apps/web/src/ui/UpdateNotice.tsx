// M11 11.6: "A new version is available", small, at the bottom of the project list. The desktop
// app asks GitHub at most once a day (Settings → Updates turns it off); "Not now" hides the notice
// until a still newer version comes out.
import { useEffect, useState } from "react";
import { getUpdate } from "../projects/api";
import type { UpdateInfo } from "../projects/types";

export const DISMISSED_KEY = "breadpilot.update-dismissed";

function dismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

/** Shown when a newer version exists and this one wasn't put off with "Not now". */
export function showNotice(info: UpdateInfo | null, hidden: string | null): boolean {
  return !!info?.available && !!info.latest && info.latest !== hidden;
}

export function UpdateNotice() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [hidden, setHidden] = useState<string | null>(dismissed);
  useEffect(() => {
    // Quiet when it can't be checked: the notice is a convenience.
    getUpdate().then(setInfo, () => {});
  }, []);
  if (!showNotice(info, hidden)) return null;
  const notNow = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, info!.latest!);
    } catch {
      /* storage blocked: hidden until the app restarts */
    }
    setHidden(info!.latest);
  };
  return (
    <section className="update-notice" aria-label="New version">
      <p>
        <strong>BreadPilot {info!.latest}</strong> is available. You have {info!.current}.
      </p>
      <div className="card-actions">
        {/* Opens in the normal browser (the desktop app sends other sites there). */}
        <a className="btn primary small-btn" href={info!.url} target="_blank" rel="noreferrer">
          Download
        </a>
        <button type="button" className="btn small-btn" onClick={notNow}>
          Not now
        </button>
      </div>
    </section>
  );
}
