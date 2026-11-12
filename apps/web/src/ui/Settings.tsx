import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { setThemeChoice, useThemeChoice, type ThemeChoice } from "./theme";
import * as api from "../projects/api";
import type { KeyCheck, ReasoningEffort, SettingsView } from "../projects/types";
import { useApp } from "../store";
import { LocalModels } from "./LocalModels";
import { ModelDownloads } from "./ModelDownloads";
import { dataKeysText } from "./dataKeys";
import { SETTINGS_TABS, tabForKey, type SettingsTab } from "./settingsTabs";
import { Icon } from "./Icon";

const EFFORTS: { id: ReasoningEffort; label: string }[] = [
  { id: "none", label: "None (fastest)" },
  { id: "low", label: "Low (recommended)" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High (slowest, most expensive)" },
];

type Note = { tone: "ok" | "bad" | "info"; text: string } | null;

/** One line of feedback under a section, read out by screen readers. */
function Feedback({ note }: { note: Note }) {
  return (
    <p className={`settings-note${note ? ` note-${note.tone}` : ""}`} role="status" aria-live="polite">
      {note?.text ?? ""}
    </p>
  );
}

function Section({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {intro && <p className="muted small">{intro}</p>}
      {children}
    </section>
  );
}

/** The ⚙ Settings dialog: a tab per subject (settingsTabs.ts). Everything is saved encrypted on this computer. */
export function SettingsDialog() {
  const open = useApp((s) => s.settingsOpen);
  const setOpen = useApp((s) => s.setSettingsOpen);
  const tab = useApp((s) => s.settingsTab);
  const setTab = useApp((s) => s.setSettingsTab);
  const loadAiOptions = useApp((s) => s.loadAiOptions);
  const setTourOpen = useApp((s) => s.setTourOpen);
  const ref = useRef<HTMLDialogElement>(null);
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});
  const [view, setView] = useState<SettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setLoadError(null);
      api
        .getSettings()
        .then(setView)
        .catch((err: Error) => setLoadError(err.message));
    } else if (!open && d.open) d.close();
  }, [open]);

  // Model menu and status follow at once.
  const changed = (v: SettingsView) => {
    setView(v);
    void loadAiOptions();
  };
  const current = SETTINGS_TABS.find((t) => t.id === tab)!;
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = tabForKey(tab, e.key);
    if (!next) return;
    e.preventDefault();
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <dialog ref={ref} className="settings settings-tabs" aria-labelledby="settings-title" onClose={() => setOpen(false)}>
      <header className="settings-head">
        <h2 id="settings-title">Settings</h2>
        <button type="button" className="icon-btn" aria-label="Close settings" onClick={() => setOpen(false)}>
          <Icon name="x" />
        </button>
      </header>
      <div className="settings-frame">
        <div className="settings-nav" role="tablist" aria-label="Settings" aria-orientation="vertical">
          {SETTINGS_TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`settings-tab-${t.id}`}
              aria-selected={t.id === tab}
              aria-controls="settings-panel"
              tabIndex={t.id === tab ? 0 : -1}
              className="settings-tab"
              onClick={() => setTab(t.id)}
              onKeyDown={onTabKey}
            >
              <span aria-hidden="true">{t.icon}</span> {t.label}
            </button>
          ))}
        </div>
        <div className="settings-body" role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`}>
          <p className="settings-intro">{current.intro}</p>
          {loadError && <p className="settings-note note-bad">{loadError}</p>}
          {!view && !loadError && <p className="muted">Loading…</p>}
          {view && tab === "local" && <LocalAiSection view={view} onChange={changed} />}
          {view && tab === "openai" && <OpenAiSection view={view} onChange={changed} title="Your API key" />}
          {view && tab === "general" && (
            <>
              <AppearanceSection />
              {view.updates?.version && <UpdatesSection view={view} onChange={changed} />}
              <Section title="Tour" intro="A short walk through the app, one part at a time.">
                <button type="button" className="btn small-btn tour-again" onClick={() => setTourOpen(true)}>
                  Show the tour again
                </button>
              </Section>
            </>
          )}
          {view && tab === "privacy" && (
            <>
              <DataSection dataHome={view.dataHome} />
              <BrowserSection view={view} onChange={changed} />
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}

/** M11 11.6: the daily new-version check (desktop app only). */
function UpdatesSection({ view, onChange }: { view: SettingsView; onChange: (v: SettingsView) => void }) {
  const u = view.updates!;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const apply = async (check: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      onChange(await api.saveSettings({ updates: { check } }));
    } catch (err) {
      setNote({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      title="Updates"
      intro={`You have BreadPilot ${u.version}. Once a day, when it starts, BreadPilot can ask GitHub for the newest version number and tell you when there is a new one. Nothing about you, this computer or your projects is sent.`}
    >
      <label className="switch">
        <input type="checkbox" checked={u.check} disabled={busy} onChange={(e) => void apply(e.target.checked)} />
        <span>Check for a new version</span>
      </label>
      <Feedback note={note} />
    </Section>
  );
}

const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: "system", label: "Same as the computer" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

/** M11 11.5: light or dark; saved on this computer only. */
function AppearanceSection() {
  const choice = useThemeChoice();
  return (
    <Section title="Appearance">
      <div className="view-switch theme-switch" role="group" aria-label="Colour theme">
        {THEMES.map((t) => (
          <button key={t.id} type="button" aria-pressed={choice === t.id} onClick={() => setThemeChoice(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
    </Section>
  );
}

function DataSection({ dataHome }: { dataHome: string | null | undefined }) {
  const text = dataKeysText(dataHome);
  return (
    <Section title="Your data and keys" intro={text.intro}>
      {text.points.length > 0 && (
        <ul className="data-keys muted small">
          {text.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function OpenAiSection({ view, onChange, title = "OpenAI (optional)" }: { view: SettingsView; onChange: (v: SettingsView) => void; title?: string }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "remove" | "model" | null>(null);
  const [note, setNote] = useState<Note>(null);
  const [model, setModel] = useState(view.openai.model);
  const [effort, setEffort] = useState(view.openai.reasoningEffort);
  const run = async (what: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(what);
    setNote(null);
    try {
      await fn();
    } catch (err) {
      setNote({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    void run("save", async () => {
      const v = await api.saveOpenAiKey(key.trim());
      setKey(""); // the field never keeps the key once it's stored
      onChange(v);
      setNote({ tone: "ok", text: `Saved. ${v.check.message} You can now pick ${v.openai.model} in the model menu.` });
    });
  };
  const test = () =>
    run("test", async () => {
      const r: KeyCheck = await api.testOpenAiKey(key.trim() || undefined);
      setNote({ tone: r.ok ? "ok" : "bad", text: r.message });
    });
  const remove = () => {
    if (!window.confirm("Remove the OpenAI key from this computer?\n\nNew projects will use the local AI.")) return;
    void run("remove", async () => {
      onChange(await api.removeOpenAiKey());
      setNote({ tone: "info", text: "The key was removed." });
    });
  };
  const saveModel = (e: FormEvent) => {
    e.preventDefault();
    void run("model", async () => {
      onChange(await api.saveSettings({ openai: { model: model.trim(), reasoningEffort: effort } }));
      setNote({ tone: "ok", text: "Saved." });
    });
  };

  return (
    <Section
      title={title}
      intro={
        <>
          A stronger model for writing code. Your idea, plan and code are sent to OpenAI and billed to your account (usually under 1 cent per project). Create a key at{" "}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">
            platform.openai.com/api-keys
          </a>
          .
        </>
      }
    >
      {view.openai.keyRefused ? (
        <p className="key-state" role="note">
          {view.openai.keyRefused}
        </p>
      ) : (
        <>
          <p className={`key-state${view.openai.keySet ? " set" : ""}`}>
            {view.openai.keySet ? (
              <>
                ✓ Key saved, ends in <code>{view.openai.keyHint}</code>
              </>
            ) : (
              "No key yet: only the local AI is available."
            )}
          </p>
          <form className="settings-row" onSubmit={save}>
            <label className="field grow">
              {view.openai.keySet ? "Replace the key" : "API key"}
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="sk-…"
                autoComplete="off"
                spellCheck={false}
                aria-describedby="key-help"
              />
            </label>
            <button type="button" className="btn" disabled={busy !== null || (!key.trim() && !view.openai.keySet)} onClick={test}>
              {busy === "test" ? "Testing…" : "Test"}
            </button>
            <button type="submit" className="btn primary" disabled={busy !== null || !key.trim()}>
              {busy === "save" ? "Checking…" : "Save key"}
            </button>
          </form>
          <p id="key-help" className="muted small">
            The key is checked with OpenAI before it's saved, then stored encrypted. It's only ever sent to OpenAI.
          </p>
        </>
      )}
      <Feedback note={note} />
      {view.openai.keySet && (
        <button type="button" className="btn small-btn danger" disabled={busy !== null} onClick={remove}>
          {busy === "remove" ? "Removing…" : "Remove key"}
        </button>
      )}
      <details className="settings-more">
        <summary>Model</summary>
        <form className="settings-grid" onSubmit={saveModel}>
          <label className="field">
            OpenAI model
            <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} required />
          </label>
          <label className="field">
            Thinking effort
            <select value={effort} onChange={(e) => setEffort(e.target.value as ReasoningEffort)}>
              {EFFORTS.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="btn" disabled={busy !== null || !model.trim()}>
            {busy === "model" ? "Saving…" : "Save"}
          </button>
        </form>
      </details>
    </Section>
  );
}

function LocalAiSection({ view, onChange }: { view: SettingsView; onChange: (v: SettingsView) => void }) {
  const [form, setForm] = useState(view.local);
  const [busy, setBusy] = useState(false);
  // The answer shows under the form that was saved (memory, or the advanced one).
  const [note, setNote] = useState<{ at: "memory" | "advanced"; note: Note }>({ at: "memory", note: null });
  const field = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const save = (at: "memory" | "advanced") => async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const setNoteHere = (n: Note) => setNote({ at, note: n });
    setNoteHere(null);
    try {
      onChange(await api.saveSettings({ local: { ...form, baseUrl: form.baseUrl.trim(), model: form.model.trim(), embedModel: form.embedModel.trim() } }));
      setNoteHere({ tone: "ok", text: "Saved. New projects use these settings." });
    } catch (err) {
      setNoteHere({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Section
        title="Model"
        intro={
          <>
            Free and private: runs through the{" "}
            <a href="https://ollama.com/download" target="_blank" rel="noreferrer">
              Ollama app
            </a>
            , nothing leaves this computer. Now using <code>{view.local.model}</code>.
        </>
      }
    >
      <ModelDownloads local={view.local} />
      <LocalModels
        warnSmall
        onSaved={(v) => {
          onChange(v);
          setForm(v.local);
        }}
      />
    </Section>
    <Section title="Memory">
      <form className="settings-row" onSubmit={save("memory")}>
        <label className="field">
          Free its memory after (minutes)
          <input type="number" min={0} max={60} step={1} value={form.keepAliveMin} onChange={(e) => field("keepAliveMin", Number(e.target.value))} required aria-describedby="keepalive-help" />
        </label>
        <button type="submit" className="btn small-btn" disabled={busy || form.keepAliveMin === view.local.keepAliveMin}>
          Save
        </button>
      </form>
      <p id="keepalive-help" className="muted small">
        While loaded, the local model uses the memory shown for it in the list. It's freed this long after its last answer; 0 frees it at once (the next answer then takes a few seconds longer to start).
      </p>
      {note.at === "memory" && <Feedback note={note.note} />}
    </Section>
    <Section title="Advanced">
      <details className="settings-more">
        <summary>Ollama address, model names, context size</summary>
        <form className="settings-grid" onSubmit={save("advanced")}>
          <label className="field">
            Ollama address
            <input value={form.baseUrl} onChange={(e) => field("baseUrl", e.target.value)} spellCheck={false} required />
          </label>
          <label className="field">
            Model
            <input value={form.model} onChange={(e) => field("model", e.target.value)} spellCheck={false} required />
          </label>
          <label className="field">
            Search model
            <input value={form.embedModel} onChange={(e) => field("embedModel", e.target.value)} spellCheck={false} required />
          </label>
          <label className="field">
            Context size (tokens)
            <input type="number" min={2048} max={131072} step={1024} value={form.numCtx} onChange={(e) => field("numCtx", Number(e.target.value))} required />
          </label>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </form>
      </details>
      {note.at === "advanced" && <Feedback note={note.note} />}
    </Section>
    </>
  );
}

function BrowserSection({ view, onChange }: { view: SettingsView; onChange: (v: SettingsView) => void }) {
  const b = view.browserAccess;
  const [port, setPort] = useState(b.port);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(b.error ? { tone: "bad", text: b.error } : null);
  const apply = async (enabled: boolean, p = port) => {
    setBusy(true);
    setNote(null);
    try {
      onChange(await api.saveSettings({ browserAccess: { enabled, port: p } }));
    } catch (err) {
      setNote({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(b.pairingUrl ?? "");
      setNote({ tone: "ok", text: "Link copied. Paste it into your browser's address bar." });
    } catch {
      setNote({ tone: "bad", text: "Couldn't copy. Use “Open in browser” instead." });
    }
  };
  return (
    <Section title="Open in a web browser" intro="Also use BreadPilot in Chrome, Safari or Firefox while this app is open. Only this computer can connect, and the browser needs the sign-in link below.">
      <label className="switch">
        <input type="checkbox" checked={b.enabled} disabled={busy} onChange={(e) => void apply(e.target.checked)} />
        <span>{b.enabled ? "On" : "Off"}</span>
      </label>
      {b.enabled && b.url && (
        <div className="browser-link">
          <p className="small">
            Address: <code>{b.url}</code>
          </p>
          <div className="settings-row">
            <a className="btn primary small-btn" href={b.pairingUrl ?? b.url} target="_blank" rel="noreferrer">
              Open in browser
            </a>
            <button type="button" className="btn small-btn" onClick={() => void copy()}>
              Copy sign-in link
            </button>
          </div>
          <p className="muted small">The sign-in link works until you quit BreadPilot. Don't share it.</p>
        </div>
      )}
      <details className="settings-more">
        <summary>Port ({b.port})</summary>
        <form
          className="settings-row"
          onSubmit={(e) => {
            e.preventDefault();
            void apply(b.enabled, port);
          }}
        >
          <label className="field">
            Port
            <input type="number" min={1024} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value))} required />
          </label>
          <button type="submit" className="btn small-btn" disabled={busy || port === b.port}>
            Change port
          </button>
        </form>
      </details>
      <Feedback note={note} />
    </Section>
  );
}
