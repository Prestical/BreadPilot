import { useEffect, useRef, useState } from "react";
import type { AiChoice, LlmOptions } from "../projects/types";
import { useApp } from "../store";
import { useHealth } from "../useHealth";
import { statusView } from "./status";
import { modelName } from "./labels";
import { localLabel } from "./modelList";

interface Option {
  id: AiChoice;
  /** Short name on the button. */
  label: (o: LlmOptions | null) => string;
  /** The one-sentence disclaimer the user reads before choosing. */
  note: string;
}

export const AI_OPTIONS: Option[] = [
  {
    id: "local",
    // The local model picked in Settings, e.g. "Local · Qwen3 4B Instruct".
    label: (o) => localLabel(o),
    note: "Runs on your own computer, so your project never leaves it, but it is slower and its code has more mistakes.",
  },
  {
    id: "openai",
    label: (o) => (o?.openai.available ? modelName(o.openai.model) : "GPT-6 Luna"),
    note: "Your idea, plan and code are sent to OpenAI and billed to your API key (usually under 1 cent per project).",
  },
];

/** The model for new projects: a button in the prompt bar showing the current one, with a menu. */
export function ModelMenu() {
  const ai = useApp((s) => s.ai);
  const options = useApp((s) => s.aiOptions);
  const setAi = useApp((s) => s.setAi);
  const setSettingsOpen = useApp((s) => s.setSettingsOpen);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = AI_OPTIONS.find((o) => o.id === ai)!;
  // The status of the AI picked here, shown as a dot on the button and in words in the menu.
  const health = useHealth();
  const status = statusView(health.report, health.error, ai);
  const localOffline = health.report?.checks.llm.status === "down";

  // Closes on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    // Escape gives the focus back to the button, so keyboard users aren't dropped at the page start.
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="model-menu" data-tour="model" ref={ref}>
      {/* A button that shows a panel (disclosure), not an ARIA menu: menus promise arrow-key movement. */}
      <button
        ref={buttonRef}
        type="button"
        className={`model-button tone-${status.tone}`}
        aria-expanded={open}
        aria-controls="model-list"
        aria-label={`AI for new projects: ${current.label(options)}. ${status.text}`}
        title={status.text}
        onClick={() => setOpen(!open)}
      >
        <span className="status-dot" aria-hidden="true" />
        {current.label(options)} <span aria-hidden="true">{open ? "▾" : "▴"}</span>
      </button>
      {open && (
        <div className="model-list" id="model-list" role="group" aria-label="AI for new projects">
          <div className={`model-status tone-${status.tone}`} role="status">
            <p>
              <span className="status-dot" aria-hidden="true" />
              {status.text}
            </p>
            {status.details.length > 0 && (
              <ul aria-label="System status details">
                {status.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
          {AI_OPTIONS.map((o) => {
            const missing = o.id === "openai" && !options?.openai.available;
            return (
              <button
                key={o.id}
                type="button"
                aria-pressed={ai === o.id}
                className={`model-item${missing ? " locked" : ""}`}
                onClick={() => {
                  // Without a key, the entry leads to where the key is added.
                  if (missing) setSettingsOpen(true, "openai");
                  else setAi(o.id);
                  setOpen(false);
                }}
              >
                <span className="model-check" aria-hidden="true">
                  {ai === o.id ? "✓" : missing ? "🔒" : ""}
                </span>
                <span>
                  <span className="model-name">
                    {o.label(options)}
                    {o.id === "local" && <span className="model-tag">Default</span>}
                  </span>
                  <span className="model-note">{missing ? "Not set up yet: click to add your OpenAI key in Settings." : o.id === "local" && localOffline ? "Offline: start the Ollama app." : o.note}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Short label of the model a project uses, for the progress card. */
export function aiLabel(choice: AiChoice | undefined, options: LlmOptions | null): string {
  return choice === "openai" ? (options?.openai.available ? modelName(options.openai.model) : "OpenAI") : "Local AI";
}
