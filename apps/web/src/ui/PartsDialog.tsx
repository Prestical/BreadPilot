// M11 (user, 11/11/2026): "Supported parts": every part BreadPilot can wire, with its 3D model,
// what it's for and how many fit in one project, read from the part packs. Replaces the parts line
// that was on the start card. Only parts the engine can plan and wire (user, 25/11/2026); a part not
// yet tried on a real Pico gets a caution tag (pack.json triedOnPico).
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { PACKS } from "@breadpilot/circuit-core";
import { useApp } from "../store";
import { Icon } from "./Icon";

const PartPreview = lazy(() => import("../scene/PartPreview"));

/** The parts the AI can put in a plan, in the packs' order. */
export const SUPPORTED_PARTS = PACKS.filter((p) => p.meta.kind && p.agent).map((p) => {
  const line = p.agent!.plan.line;
  const i2c = p.part.legs.some((l) => l.kind === "i2c_sda");
  return { kind: p.meta.kind!, name: p.part.name, category: p.part.category, i2c, tried: p.meta.triedOnPico === true, text: line.charAt(0).toUpperCase() + line.slice(1) };
});

/**
 * The supported parts in three lists: every card is its own 3D canvas and a browser keeps only
 * about 16 alive, so one list shows at most 14.
 */
export const SUPPORTED_GROUPS = [
  { id: "supported", label: "Parts", parts: SUPPORTED_PARTS.filter((p) => !p.i2c && p.category !== "sensor") },
  { id: "supported-sensors", label: "Sensors", parts: SUPPORTED_PARTS.filter((p) => !p.i2c && p.category === "sensor") },
  { id: "supported-i2c", label: "I2C modules", parts: SUPPORTED_PARTS.filter((p) => p.i2c) },
].filter((g) => g.parts.length > 0);

export function PartsDialog() {
  const open = useApp((s) => s.partsOpen);
  const setOpen = useApp((s) => s.setPartsOpen);
  const ref = useRef<HTMLDialogElement>(null);
  // One list at a time: every preview is its own 3D canvas, and a browser keeps only about 16 alive.
  const [list, setList] = useState(SUPPORTED_GROUPS[0]!.id);
  const group = SUPPORTED_GROUPS.find((g) => g.id === list) ?? SUPPORTED_GROUPS[0]!;
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
          <Icon name="x" />
        </button>
      </header>
      <div className="settings-body">
        {SUPPORTED_GROUPS.length > 1 && (
          <div className="parts-switch" role="group" aria-label="Which parts to show">
            {SUPPORTED_GROUPS.map((g) => (
              <button key={g.id} type="button" aria-pressed={list === g.id} onClick={() => setList(g.id)}>
                {g.label} <span className="muted">{g.parts.length}</span>
              </button>
            ))}
          </div>
        )}
        <p className="muted small">
          BreadPilot can plan, wire and program these parts. Parts marked <span className="part-tag untested"><Icon name="alert" size={13} /> Not tried yet</span> are described from datasheets and the usual module, but haven't been tried on a real Pico yet: check their pins against the labels on your board. Drag a picture to turn the part.
        </p>
        {/* The 3D previews are only made while the list is open. */}
        {open && (
          <ul className="parts-grid">
            {group.parts.map((p) => (
              <li key={p.kind} className="part-card">
                <div className="part-3d">
                  <Suspense fallback={<span className="muted small">Loading…</span>}>
                    <PartPreview kind={p.kind} label={p.name} />
                  </Suspense>
                </div>
                <h3>{p.name}</h3>
                {!p.tried && (
                  <span className="part-tag untested" title="Not yet tried on a real Pico: described from datasheets and the usual module">
                    <Icon name="alert" size={13} /> Not tried yet
                  </span>
                )}
                <p className="small">{p.text}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}
