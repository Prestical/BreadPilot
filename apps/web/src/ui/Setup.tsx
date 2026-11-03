import { useEffect, useRef, useState } from "react";
import * as api from "../projects/api";
import type { SettingsView } from "../projects/types";
import { useApp } from "../store";
import { OpenAiSection } from "./Settings";
import { ModelDownloads } from "./ModelDownloads";


/**
 * First-run setup (PLAN §19.4, D4): welcome → choose the AI (local Ollama with a live status, or an
 * OpenAI key) → done. Shown until it's finished or skipped; everything here is also in ⚙ Settings.
 */
export function SetupDialog() {
  const open = useApp((s) => s.setupOpen);
  const setOpen = useApp((s) => s.setSetupOpen);
  const loadAiOptions = useApp((s) => s.loadAiOptions);
  const ref = useRef<HTMLDialogElement>(null);
  const [step, setStep] = useState<"welcome" | "ai" | "done">("welcome");
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // The main button, not the first one (React's autoFocus runs before the dialog opens).
      d.querySelector<HTMLElement>(".setup-nav .primary")?.focus();
      void api.getSettings().then(setView, (err: Error) => setError(err.message));
    } else if (!open && d.open) d.close();
  }, [open]);

  // Finishing or skipping: not shown again (Settings has everything).
  const setTourOpen = useApp((s) => s.setTourOpen);
  const finish = async () => {
    let saved: SettingsView;
    try {
      saved = await api.saveSettings({ setupDone: true });
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    void loadAiOptions();
    setOpen(false);
    // First time here: the tour of the app follows.
    if (!saved.tourDone) setTourOpen(true);
  };

  return (
    <dialog
      ref={ref}
      className="settings setup"
      aria-labelledby="setup-title"
      // Escape closes it for now; it comes back on the next start until it's finished or skipped.
      onClose={() => setOpen(false)}
    >
      <header className="settings-head">
        <h2 id="setup-title">{step === "welcome" ? "Welcome to BreadPilot" : step === "ai" ? "Choose your AI" : "You're ready"}</h2>
        <ol className="setup-steps" aria-label="Setup steps">
          {(["welcome", "ai", "done"] as const).map((s, i) => (
            <li key={s} className={s === step ? "current" : ""} aria-current={s === step ? "step" : undefined}>
              {i + 1}
            </li>
          ))}
        </ol>
      </header>
      <div className="settings-body">
        {error && <p className="settings-note note-bad">{error}</p>}
        {step === "welcome" && <Welcome />}
        {step === "ai" && <ChooseAi view={view} onView={setView} active={open && step === "ai"} />}
        {step === "done" && <Done view={view} />}
      </div>
      <footer className="setup-foot">
        {step !== "done" ? (
          <button type="button" className="btn" onClick={() => void finish()}>
            Skip for now
          </button>
        ) : (
          <span />
        )}
        <div className="setup-nav">
          {step !== "welcome" && (
            <button type="button" className="btn" onClick={() => setStep(step === "done" ? "ai" : "welcome")}>
              ← Back
            </button>
          )}
          {step === "welcome" && (
            <button type="button" className="btn primary" onClick={() => setStep("ai")}>
              Set up the AI →
            </button>
          )}
          {step === "ai" && (
            <button type="button" className="btn primary" onClick={() => setStep("done")}>
              Next →
            </button>
          )}
          {step === "done" && (
            <button type="button" className="btn primary" onClick={() => void finish()}>
              Start building
            </button>
          )}
        </div>
      </footer>
    </dialog>
  );
}

function Welcome() {
  return (
    <div className="setup-text">
      <p>
        Describe a hardware project in plain words, like <em>“blink an LED when I press a button”</em>. BreadPilot plans it, checks the wiring for safety, shows every step on a 3D breadboard and writes the MicroPython code
        for your microcontroller.
      </p>
      <p>An AI turns your idea into a plan and code. Next you choose which one: a free local AI on this computer, or OpenAI. You can change this any time in ⚙ Settings.</p>
      <p className="muted small">🔒 Your projects and settings are saved encrypted on this computer.</p>
    </div>
  );
}

function ChooseAi({ view, onView, active }: { view: SettingsView | null; onView: (v: SettingsView) => void; active: boolean }) {
  return (
    <>
      <section className="settings-section">
        <h3>Local AI (free, private)</h3>
        <p className="muted small">Runs on this computer through the Ollama app, so your projects never leave it. Slower, and its code has more mistakes. Needs about 3 GB of disk space and 4–5 GB of free memory.</p>
        {view ? <ModelDownloads local={view.local} active={active} /> : <p className="muted">Checking…</p>}
      </section>
      {view && <OpenAiSection view={view} onChange={onView} />}
      <p className="muted small settings-foot">You need at least one of the two to create projects. The examples and the 3D breadboard work without either.</p>
    </>
  );
}

function Done({ view }: { view: SettingsView | null }) {
  const hasKey = !!view?.openai.keySet;
  return (
    <div className="setup-text">
      <p>
        <strong>Type your idea in the box at the bottom</strong> and press Enter, or open one of the examples in the sidebar first.
      </p>
      <ul>
        <li>Pick the AI for each project in the model menu next to the box{hasKey ? `: Local AI or ${view?.openai.model}` : ""}.</li>
        <li>New to breadboards? Start with “Breadboard &amp; Pico 101” in the sidebar.</li>
        <li>⚙ next to the status line holds every setting from this setup.</li>
      </ul>
      <p className="muted small">⚠️ BreadPilot checks the wiring, but always look over your circuit before plugging in the USB cable.</p>
    </div>
  );
}
