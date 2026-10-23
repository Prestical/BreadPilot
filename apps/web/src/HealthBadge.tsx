import { useEffect, useState } from "react";
import { fetchHealth, type HealthReport } from "./health";
import { useApp } from "./store";
import { statusView } from "./ui/status";

const POLL_MS = 15_000;

/** System status in plain words for the AI the user picked; a click shows each part. */
export function HealthBadge() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  const ai = useApp((s) => s.ai);

  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      fetchHealth(controller.signal)
        .then((r) => {
          setReport(r);
          setError(false);
        })
        .catch((e: unknown) => {
          if ((e as Error).name !== "AbortError") setError(true);
        });
    void load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, []);

  const view = statusView(report, error, ai);
  return (
    <div className="status">
      <button type="button" className={`status-btn tone-${view.tone}`} aria-expanded={open} onClick={() => setOpen(!open)} disabled={!view.details.length}>
        <span className="status-dot" aria-hidden="true" />
        <span>{view.text}</span>
      </button>
      {open && (
        <ul className="status-details" aria-label="System status details">
          {view.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
