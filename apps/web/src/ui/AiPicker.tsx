import { useEffect, useRef, useState } from "react";
import type { AiChoice, LlmOptions } from "../projects/types";
import { useApp } from "../store";
import { modelName } from "./labels";

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
    label: () => "Local AI",
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
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = AI_OPTIONS.find((o) => o.id === ai)!;

  // Closes on a click outside or Escape.
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div className="model-menu" ref={ref}>
      <button type="button" className="model-button" aria-haspopup="menu" aria-expanded={open} title="The AI that writes new projects" onClick={() => setOpen(!open)}>
        {current.label(options)} <span aria-hidden="true">{open ? "▾" : "▴"}</span>
      </button>
      {open && (
        <div className="model-list" role="menu" aria-label="AI for new projects">
          {AI_OPTIONS.map((o) => {
            const missing = o.id === "openai" && !options?.openai.available;
            return (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={ai === o.id}
                className="model-item"
                disabled={missing}
                onClick={() => {
                  setAi(o.id);
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
                  <span className="model-note">{missing ? "Not set up yet: add OPENAI_API_KEY to the .env file and restart the app." : o.note}</span>
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
