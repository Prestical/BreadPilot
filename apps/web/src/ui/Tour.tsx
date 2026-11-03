import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import * as api from "../projects/api";
import { useApp } from "../store";
import { placePopup, TOUR, visible, type Rect, type Side, type TourStep } from "./tourSteps";

/** Room around the highlighted element. */
const PAD = 6;

const rectOf = (target: string): Rect | null => {
  const el = document.querySelector(`[data-tour="${target}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
};

/**
 * The guided tour for first-time users: the page is dimmed, one part of the app is highlighted and
 * a short popup explains it. Starts once after the first-run setup; ⚙ Settings can replay it.
 */
export function Tour() {
  const open = useApp((s) => s.tourOpen);
  const setOpen = useApp((s) => s.setTourOpen);
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Rect | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number; side: Side } | null>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  // Steps whose part of the app is on screen right now (the sidebar is hidden on narrow windows).
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const shown = TOUR.filter((s) => visible(rectOf(s.target)));
      if (!shown.length) setOpen(false); // nothing to point at (tried again on the next start)
      setSteps(shown);
      setIndex(0);
    }, 300); // let the page finish laying out after the setup closes
    return () => clearTimeout(t);
  }, [open, setOpen]);

  const step = open ? steps[index] : undefined;

  const measure = useCallback(() => {
    if (!step) return;
    const r = rectOf(step.target);
    if (!visible(r)) return;
    const s = { top: r.top - PAD, left: r.left - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD };
    setSpot(s);
    const pop = popRef.current;
    if (pop) setPos(placePopup(s, { width: pop.offsetWidth, height: pop.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }));
  }, [step]);

  useLayoutEffect(() => {
    measure();
    // Again once the popup has its final size (its text changed with the step).
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [measure]);

  useEffect(() => {
    if (!step) return;
    window.addEventListener("resize", measure);
    nextRef.current?.focus();
    return () => window.removeEventListener("resize", measure);
  }, [step, measure]);

  const end = useCallback(() => {
    setOpen(false);
    setSteps([]);
    setSpot(null);
    setPos(null);
    // Finished or skipped: it doesn't start by itself again.
    void api.saveSettings({ tourDone: true }).catch(() => {});
  }, [setOpen]);

  if (!step) return null;
  const last = index === steps.length - 1;
  const next = () => (last ? end() : setIndex(index + 1));
  const back = () => setIndex(Math.max(0, index - 1));

  return (
    <div className="tour-layer">
      {spot && <div className="tour-spot" style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }} aria-hidden="true" />}
      <div
        ref={popRef}
        className={`tour-pop side-${pos?.side ?? "center"}`}
        style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-text"
        onKeyDown={(e) => {
          if (e.key === "Escape") end();
          else if (e.key === "ArrowRight") next();
          else if (e.key === "ArrowLeft") back();
          else if (e.key === "Tab") {
            // Keep the keyboard inside the popup while the rest of the page is dimmed.
            const items = [...(popRef.current?.querySelectorAll<HTMLElement>("button") ?? [])];
            const i = items.indexOf(document.activeElement as HTMLElement);
            const to = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
            e.preventDefault();
            items[to]?.focus();
          }
        }}
      >
        <p className="tour-count muted small">
          {index + 1} of {steps.length}
        </p>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-text">{step.text}</p>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={end}>
            Skip tour
          </button>
          <div className="tour-nav">
            {index > 0 && (
              <button type="button" className="btn small-btn" onClick={back}>
                Back
              </button>
            )}
            <button ref={nextRef} type="button" className="btn primary small-btn" onClick={next}>
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
