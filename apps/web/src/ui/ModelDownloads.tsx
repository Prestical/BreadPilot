import { useEffect, useState } from "react";
import { fetchHealth, type HealthReport } from "../health";
import * as api from "../projects/api";
import type { PullState, SettingsView } from "../projects/types";
import { localAiState, pullCommand } from "./setupState";

const HEALTH_MS = 3000;
const PULL_MS = 1000;

const mb = (bytes: number) => `${Math.round(bytes / 1_000_000).toLocaleString()} MB`;

/** One line of download progress: a bar with the percentage, or Ollama's current step. */
function Progress({ pull }: { pull: PullState }) {
  const pct = pull.total ? Math.floor((pull.completed / pull.total) * 100) : 0;
  return (
    <div className="pull-progress">
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`Downloading ${pull.model}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="muted small">{pull.total ? `${pct}% · ${mb(pull.completed)} of ${mb(pull.total)}` : pull.message}</span>
    </div>
  );
}

/**
 * The local AI's state with one-click model downloads (D5): Ollama missing → its download page;
 * models missing → Download buttons with progress; ready → ✓. Rechecks by itself, so installing
 * Ollama or finishing a download shows up without a click. Used by the setup and by Settings.
 */
export function ModelDownloads({ local, active = true }: { local: SettingsView["local"]; active?: boolean }) {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [pulls, setPulls] = useState<PullState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const state = localAiState(report, local);
  const pulling = pulls.some((p) => p.status === "pulling");

  useEffect(() => {
    if (!active) return;
    let stop = false;
    const check = async () => {
      try {
        const r = await fetchHealth();
        if (!stop) setReport(r);
      } catch {
        /* the next check tries again */
      }
    };
    void check();
    const timer = setInterval(() => void check(), HEALTH_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [active, local.model, local.embedModel, local.baseUrl]);

  // Progress: every second while a download runs (once more at the start, to pick up running ones).
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const load = async () => {
      try {
        const p = await api.getPulls();
        if (stop) return;
        setPulls(p);
        // A finished download: check the models again right away.
        if (p.some((x) => x.status === "done")) setReport(await fetchHealth());
      } catch {
        /* shown by the next poll */
      }
    };
    void load();
    if (!pulling) return () => void (stop = true);
    const timer = setInterval(() => void load(), PULL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [active, pulling]);

  const download = async (model: string) => {
    setError(null);
    try {
      const s = await api.startPull(model);
      setPulls((ps) => [...ps.filter((p) => p.model !== model), s]);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className={`setup-status status-${state.kind}`} role="status" aria-live="polite">
      {state.kind === "checking" && <p>Checking for Ollama…</p>}
      {state.kind === "offline" && (
        <>
          <p>
            <strong>Ollama isn't running.</strong> Install it, open it, and this notices by itself.
          </p>
          <a className="btn primary small-btn" href="https://ollama.com/download" target="_blank" rel="noreferrer">
            Download Ollama
          </a>
        </>
      )}
      {state.kind === "missing" && (
        <>
          <p>
            <strong>Ollama is running.</strong> Download {state.models.length === 1 ? "this model" : "these models"} once (about 3 GB the first time):
          </p>
          <ul className="pull-list">
            {state.models.map((m) => {
              const p = pulls.find((x) => x.model === m);
              return (
                <li key={m}>
                  <code>{m}</code>
                  {p?.status === "pulling" ? (
                    <Progress pull={p} />
                  ) : (
                    <button type="button" className="btn primary small-btn" onClick={() => void download(m)}>
                      {p?.status === "error" ? "Try again" : "Download"}
                    </button>
                  )}
                  {p?.status === "error" && <p className="settings-note note-bad">{p.message}</p>}
                </li>
              );
            })}
          </ul>
          {error && <p className="settings-note note-bad">{error}</p>}
          <details className="settings-more">
            <summary>Use the Terminal instead</summary>
            <ul className="pull-list">
              {state.models.map((m) => (
                <li key={m}>
                  <code>{pullCommand(m)}</code>
                  <button type="button" className="btn small-btn" onClick={() => void copy(pullCommand(m))}>
                    {copied === pullCommand(m) ? "Copied ✓" : "Copy"}
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
      {state.kind === "ready" && (
        <p className="ok-line">
          ✓ <strong>Local AI is ready</strong> ({local.model}).
        </p>
      )}
    </div>
  );
}
