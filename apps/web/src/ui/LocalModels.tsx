import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../projects/api";
import type { LocalModel, LocalModelsView, PullState, SettingsView } from "../projects/types";
import { useApp } from "../store";
import { actionsFor, computerLine, formatBytes, groupModels, optionText, tooBigWarning, warningShort } from "./modelList";

const PULL_MS = 1000;
const AFTER_DOWNLOAD_MS = 3000;
const AFTER_DOWNLOAD_TRIES = 40;

function Progress({ pull }: { pull: PullState }) {
  const pct = pull.total ? Math.floor((pull.completed / pull.total) * 100) : 0;
  return (
    <div className="pull-progress">
      <div className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`Downloading ${pull.model}`}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <span className="muted small">{pull.total ? `${pct}% · ${formatBytes(pull.completed)} of ${formatBytes(pull.total)}` : pull.message}</span>
    </div>
  );
}

/**
 * The local model picker (PLAN §13.2) for the first-run setup and Settings: one dropdown grouped by
 * size, each option with its download size, memory and a warning for this computer (Ollama's sizes
 * built into BreadPilot; memory measured here by the local Ollama). Picking a downloaded model uses
 * it at once; a model that isn't downloaded gets a "Download and use" button. `onSaved` gets the
 * settings after a model is picked. `initialView` shows a list before the first answer (previews).
 */
export function LocalModels({ active = true, onSaved, initialView = null }: { active?: boolean; onSaved?: (v: SettingsView) => void; initialView?: LocalModelsView | null }) {
  const loadAiOptions = useApp((s) => s.loadAiOptions);
  const [view, setView] = useState<LocalModelsView | null>(initialView);
  const [choice, setChoice] = useState<string | null>(initialView?.selected ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pulls, setPulls] = useState<PullState[]>([]);
  const [measuring, setMeasuring] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Downloaded on request: used as soon as the download finishes. */
  const useAfterDownload = useRef<string | null>(null);
  /** A model just downloaded: the engine checks its memory by itself; the list waits for that. */
  const [waitingFor, setWaitingFor] = useState<string | null>(null);
  const seenDone = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const v = await api.getLocalModels();
      setView(v);
      setChoice((c) => c ?? v.selected);
      setLoadError(null);
      return v;
    } catch (err) {
      setLoadError((err as Error).message);
      return null;
    }
  }, []);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  const select = useCallback(
    async (m: LocalModel) => {
      setBusy(true);
      setError(null);
      try {
        const saved = await api.saveSettings({ local: { model: m.tag } });
        onSaved?.(saved);
        await Promise.all([load(), loadAiOptions()]);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load, loadAiOptions, onSaved],
  );

  // Download progress, every second while one runs (and once at the start to pick up running ones).
  const pulling = pulls.some((p) => p.status === "pulling");
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const poll = async () => {
      try {
        const p = await api.getPulls();
        if (stop) return;
        setPulls(p);
        const done = p.find((x) => x.status === "done" && !seenDone.current.has(x.model));
        if (done) {
          seenDone.current.add(done.model);
          setWaitingFor(done.model);
          const v = await load();
          const m = v && [...v.models, ...v.others].find((x) => x.tag === done.model);
          if (m && useAfterDownload.current === done.model) {
            useAfterDownload.current = null;
            await select(m);
          }
        }
      } catch {
        /* the next poll tries again */
      }
    };
    void poll();
    if (!pulling) return () => void (stop = true);
    const timer = setInterval(() => void poll(), PULL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [active, pulling, load, select]);

  // After a download: reload until the engine has saved the model's memory (or gives up).
  useEffect(() => {
    if (!active || !waitingFor) return;
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      const v = await load();
      const m = v && [...v.models, ...v.others].find((x) => x.tag === waitingFor);
      if (!m || m.measured || m.fit.kind === "too-big" || tries >= AFTER_DOWNLOAD_TRIES) setWaitingFor(null);
    }, AFTER_DOWNLOAD_MS);
    return () => clearInterval(timer);
  }, [active, waitingFor, load]);

  if (!view) return loadError ? <p className="settings-note note-bad">{loadError}</p> : <p className="muted small">Loading the models…</p>;

  const all = [...view.models, ...view.others];
  const chosen = all.find((m) => m.tag === choice) ?? all.find((m) => m.selected) ?? null;

  const pick = (tag: string) => {
    const m = all.find((x) => x.tag === tag);
    if (!m) return;
    setError(null);
    // A downloaded model is used right away (asking first when it's too big); others wait for Download.
    if (m.installed && !m.selected) {
      if (m.fit.kind === "too-big" && !window.confirm(tooBigWarning(m))) return;
      setChoice(tag);
      void select(m);
    } else setChoice(tag);
  };

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const download = (m: LocalModel) =>
    act(async () => {
      if (m.fit.kind === "too-big" && !window.confirm(tooBigWarning(m))) return;
      seenDone.current.delete(m.tag);
      useAfterDownload.current = m.tag;
      const s = await api.startPull(m.tag);
      setPulls((ps) => [...ps.filter((p) => p.model !== m.tag), s]);
    });
  const check = (m: LocalModel) =>
    act(async () => {
      setMeasuring(m.tag);
      try {
        await api.measureModel(m.tag);
        await load();
      } finally {
        setMeasuring(null);
      }
    });
  const remove = (m: LocalModel) =>
    act(async () => {
      if (!window.confirm(`Remove ${m.name} from this computer?\n\nYou can download it again later.`)) return;
      await api.removeModel(m.tag);
      setChoice(null);
      await load();
    });

  const offline = !!view.ollamaError;
  const pull = chosen ? pulls.find((p) => p.model === chosen.tag) : undefined;
  const actions = chosen ? actionsFor(chosen, { pull, measuring: measuring ?? (waitingFor === chosen.tag ? chosen.tag : null), numCtx: view.numCtx }) : [];

  return (
    <div className="local-models">
      <label className="field">
        Model
        <select value={chosen?.tag ?? ""} onChange={(e) => pick(e.target.value)} disabled={busy}>
          {groupModels(view).map((g) => (
            <optgroup key={g.id} label={g.title}>
              {g.models.map((m) => (
                <option key={m.tag} value={m.tag}>
                  {optionText(m, view.numCtx)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {chosen && warningShort(chosen) && <p className={`small ${chosen.fit.kind === "too-big" ? "fit-text-bad" : "fit-text-warn"}`}>{chosen.fit.reason}</p>}
      {chosen && (
        <div className="model-row-actions">
          {actions.map((a) => {
            if (a === "downloading") return pull ? <Progress key={a} pull={pull} /> : null;
            if (a === "in-use") return <span key={a} className="ok-line small">✓ In use</span>;
            if (a === "checking") return <span key={a} className="muted small">Checking its memory…</span>;
            if (a === "use") return null; // picking it in the dropdown uses it
            const label = { download: pull?.status === "error" ? "Try again" : "Download and use", check: "Check memory", remove: "Remove" }[a];
            const run = { download, check, remove }[a];
            return (
              <button key={a} type="button" className={`btn small-btn${a === "download" ? " primary" : ""}${a === "remove" ? " danger" : ""}`} disabled={busy || offline} onClick={() => void run(chosen)}>
                {label}
              </button>
            );
          })}
        </div>
      )}
      {pull?.status === "error" && <p className="settings-note note-bad">{pull.message}</p>}
      {error && <p className="settings-note note-bad">{error}</p>}
      {offline && <p className="settings-note note-bad">Ollama isn't answering, so models can't be downloaded right now.</p>}
      <p className="muted small">{computerLine(view)} Memory is checked on this computer after a download.</p>
    </div>
  );
}
