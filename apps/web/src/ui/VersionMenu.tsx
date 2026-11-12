// M9: "Version N ▾" next to the project's title: every version with what was asked, which model
// made it and when; an older one can be looked at (read-only) or restored (as a new version, so
// nothing is ever lost). Shown once a project has more than one version.
import { useEffect, useRef, useState } from "react";
import type { ApiProject, ProjectVersion } from "../projects/types";
import { currentVersionOf, useApp } from "../store";
import { modelName } from "./labels";

/** "the first version", "“make it blink” (from version 1)" when made from an older one. */
export function versionLabel(v: ProjectVersion): string {
  if (v.request) return `“${v.request}”${v.parent && v.parent !== v.n - 1 ? ` (from version ${v.parent})` : ""}`;
  if (v.restoredFrom) return `restored from version ${v.restoredFrom}`;
  return "the first version";
}

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function VersionMenu({ p }: { p: ApiProject }) {
  const viewVersion = useApp((s) => s.viewVersion);
  const setViewVersion = useApp((s) => s.setViewVersion);
  const restoreVersion = useApp((s) => s.restoreVersion);
  const busy = useApp((s) => s.agent.busy);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const versions = p.versions ?? [];
  if (versions.length < 2) return null;
  const current = currentVersionOf(p)!;
  const shown = viewVersion ?? current;
  return (
    <div className="version-menu" ref={ref}>
      <button ref={buttonRef} type="button" className="version-button" aria-expanded={open} aria-controls="version-list" onClick={() => setOpen(!open)}>
        Version {shown}
        {shown !== current ? " (old)" : ""} <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <ul className="version-list" id="version-list" aria-label="Versions of this project">
          {[...versions].reverse().map((v) => (
            <li key={v.n} className={`version-item${v.n === shown ? " shown" : ""}`} aria-current={v.n === shown ? "true" : undefined}>
              <p>
                <strong>Version {v.n}</strong>
                {v.n === current && <span className="model-tag">Current</span>} {versionLabel(v)}
              </p>
              <p className="muted small">
                {v.model ? modelName(v.model) : v.llm === "openai" ? "OpenAI" : "Local AI"}
                {when(v.createdAt) ? ` · ${when(v.createdAt)}` : ""}
                {v.state === "HANDOFF" ? " · needed the handoff bundle" : ""}
              </p>
              {v.n !== current && (
                <div className="version-actions">
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => {
                      setViewVersion(v.n === viewVersion ? null : v.n);
                      setOpen(false);
                    }}
                  >
                    {v.n === viewVersion ? "Back to current" : "View"}
                  </button>
                  <button
                    type="button"
                    className="link-btn"
                    disabled={busy}
                    onClick={() => {
                      setOpen(false);
                      void restoreVersion(v.n);
                    }}
                  >
                    Restore
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
