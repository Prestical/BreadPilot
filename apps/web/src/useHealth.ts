import { useEffect, useState } from "react";
import { fetchHealth, type HealthReport } from "./health";

const POLL_MS = 15_000;

/** The system's health, checked now and every 15 s: `error` = the app's server didn't answer. */
export function useHealth(): { report: HealthReport | null; error: boolean } {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState(false);

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

  return { report, error };
}
