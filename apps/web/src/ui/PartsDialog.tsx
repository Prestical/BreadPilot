// M11 (user, 11/11/2026): "Supported parts": every part BreadPilot can wire, with its 3D model,
// what it's for and how many fit in one project, read from the part packs. Replaces the parts line
// that was on the start card.
import { lazy, Suspense, useEffect, useRef } from "react";
import { PACKS } from "@breadpilot/circuit-core";
import { useApp } from "../store";

const PartPreview = lazy(() => import("../scene/PartPreview"));

/** The parts the AI can put in a plan, in the packs' order. */
export const SUPPORTED_PARTS = PACKS.filter((p) => p.meta.kind && p.agent).map((p) => {
  const line = p.agent!.plan.line;
  return { kind: p.meta.kind!, name: p.part.name, text: line.charAt(0).toUpperCase() + line.slice(1) };
});

export function PartsDialog() {
  const open = useApp((s) => s.partsOpen);
  const setOpen = useApp((s) => s.setPartsOpen);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog ref={ref} className="settings parts-dialog" aria-labelledby="parts-title" onClose={() => setOpen(false)}>
      <header className="settings-head">
        <h2 id="parts-title">Supported parts</h2>
        <button type="button" className="icon-btn" aria-label="Close the parts list" onClick={() => setOpen(false)}>
          ✕
        </button>
      </header>
      <div className="settings-body">
        <p className="muted small">BreadPilot can plan, wire and program these parts. Drag a picture to turn the part.</p>
        {/* The 3D previews are only made while the list is open. */}
        {open && (
          <ul className="parts-grid">
            {SUPPORTED_PARTS.map((p) => (
              <li key={p.kind} className="part-card">
                <div className="part-3d">
                  <Suspense fallback={<span className="muted small">Loading…</span>}>
                    <PartPreview kind={p.kind} label={p.name} />
                  </Suspense>
                </div>
                <h3>{p.name}</h3>
                <p className="small">{p.text}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="small part-onboard">
          <strong>Built into the Pico 2 W</strong>, no extra parts: its own LED, Wi-Fi, the chip's temperature sensor, and printing to the computer over USB.
        </p>
      </div>
    </dialog>
  );
}
