// M11 (user, 11/11/2026): "Supported parts": every part BreadPilot can wire, with its 3D model,
// what it's for and how many fit in one project, read from the part packs. Replaces the parts line
// that was on the start card.
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { PACKS } from "@breadpilot/circuit-core";
import { BOARD_MODELS } from "../scene/boards";
import { UPCOMING_GROUPS } from "../scene/upcoming";
import { useApp } from "../store";
import { Icon } from "./Icon";

const PartPreview = lazy(() => import("../scene/PartPreview"));
const BoardPreview = lazy(() => import("../scene/BoardPreview"));

/** The parts the AI can put in a plan, in the packs' order. */
export const SUPPORTED_PARTS = PACKS.filter((p) => p.meta.kind && p.agent).map((p) => {
  const line = p.agent!.plan.line;
  const i2c = p.part.legs.some((l) => l.kind === "i2c_sda");
  return { kind: p.meta.kind!, name: p.part.name, category: p.part.category, i2c, text: line.charAt(0).toUpperCase() + line.slice(1) };
});

/**
 * The supported parts in three lists (M17, 31 parts): every card is its own 3D canvas and a browser
 * keeps only about 16 alive, so one list shows at most 14.
 */
export const SUPPORTED_GROUPS = [
  { id: "supported", label: "Supported", parts: SUPPORTED_PARTS.filter((p) => !p.i2c && p.category !== "sensor") },
  { id: "supported-sensors", label: "Supported sensors", parts: SUPPORTED_PARTS.filter((p) => !p.i2c && p.category === "sensor") },
  { id: "supported-i2c", label: "Supported I2C modules", parts: SUPPORTED_PARTS.filter((p) => p.i2c) },
].filter((g) => g.parts.length > 0);

export function PartsDialog() {
  const open = useApp((s) => s.partsOpen);
  const setOpen = useApp((s) => s.setPartsOpen);
  const ref = useRef<HTMLDialogElement>(null);
  // One list at a time: every preview is its own 3D canvas, and a browser keeps only about 16 alive.
  const [list, setList] = useState("supported");
  const upcoming = UPCOMING_GROUPS.find((g) => g.id === list);
  const supported = SUPPORTED_GROUPS.find((g) => g.id === list);
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
        {(UPCOMING_GROUPS.length > 0 || SUPPORTED_GROUPS.length > 1) && (
          <div className="parts-switch" role="group" aria-label="Which parts to show">
            {SUPPORTED_GROUPS.map((g) => (
              <button key={g.id} type="button" aria-pressed={list === g.id} onClick={() => setList(g.id)}>
                {g.label} <span className="muted">{g.parts.length}</span>
              </button>
            ))}
            {UPCOMING_GROUPS.map((g) => (
              <button key={g.id} type="button" aria-pressed={list === g.id} onClick={() => setList(g.id)}>
                {g.label} <span className="muted">{g.models.length}</span>
              </button>
            ))}
            {BOARD_MODELS.length > 0 && (
              <button type="button" aria-pressed={list === "boards"} onClick={() => setList("boards")}>
                Next: boards <span className="muted">{BOARD_MODELS.length}</span>
              </button>
            )}
          </div>
        )}
        <p className="muted small">
          {list === "boards" ? "The 3D models of boards that may come after the Pico 2 W. BreadPilot can't use these yet." : !upcoming ? "BreadPilot can plan, wire and program these parts." : "The 3D models of the next parts. BreadPilot can't plan or wire these yet."} Drag a picture to turn the part.
        </p>
        {/* The 3D previews are only made while the list is open. */}
        {open && list === "boards" && (
          <ul className="parts-grid">
            {BOARD_MODELS.map((b) => (
              <li key={b.id} className="part-card">
                <div className="part-3d">
                  <Suspense fallback={<span className="muted small">Loading…</span>}>
                    <BoardPreview board={b} />
                  </Suspense>
                </div>
                <h3>{b.name}</h3>
                <p className="small">3D model only, no pin names yet.</p>
              </li>
            ))}
          </ul>
        )}
        {open && supported && (
          <ul className="parts-grid">
            {supported.parts.map((p) => (
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
        {open && upcoming && (
          <ul className="parts-grid">
            {upcoming.models.map((m) => (
              <li key={m.id} className="part-card">
                <div className="part-3d">
                  <Suspense fallback={<span className="muted small">Loading…</span>}>
                    <PartPreview model={m} label={m.name} />
                  </Suspense>
                </div>
                <h3>{m.name}</h3>
                <p className="small">3D model only.</p>
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
