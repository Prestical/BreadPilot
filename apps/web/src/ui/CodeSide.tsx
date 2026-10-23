import { useEffect } from "react";
import type { ApiProject } from "../projects/types";
import { CodePanel } from "../steps/CodePanel";
import { useApp } from "../store";

/**
 * The code view: slides in from the right over the 3D stage (and back out to the right), so the
 * code gets the whole width. Always mounted while the project has code, so it can animate both
 * ways; closed, it's hidden (also from the keyboard and screen readers).
 */
export function CodeSide({ p, open }: { p: ApiProject; open: boolean }) {
  const setCodeOpen = useApp((s) => s.setCodeOpen);

  // Escape goes back to the 3D view.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setCodeOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setCodeOpen]);

  return (
    <section className={`code-view${open ? " open" : ""}`} aria-label="Code" aria-hidden={!open}>
      <header className="code-view-head">
        <h2>{p.title}</h2>
        {/* Same spot and look as "</> Code", so the way back is where the way in was. */}
        <button type="button" className="tool-btn code-btn code-view-back" onClick={() => setCodeOpen(false)}>
          ← Back to 3D
        </button>
      </header>
      <CodePanel p={p} />
    </section>
  );
}
