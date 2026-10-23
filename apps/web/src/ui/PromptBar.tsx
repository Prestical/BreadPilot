import { useEffect, useRef, useState, type FormEvent } from "react";
import { useApp } from "../store";
import { aiLabel, ModelMenu } from "./AiPicker";
import { usageText } from "./labels";

/**
 * The one text box, at the bottom of the 3D stage. While a plan waits for approval it sends a
 * change to that plan; otherwise it starts a new project.
 */
export function PromptBar() {
  const source = useApp((s) => s.source);
  const project = useApp((s) => (s.source.kind === "agent" ? s.agent.project : null));
  const busy = useApp((s) => s.agent.busy);
  const startIdea = useApp((s) => s.startIdea);
  const stop = useApp((s) => s.stop);
  const options = useApp((s) => s.aiOptions);
  const [stopping, setStopping] = useState(false);
  const approve = useApp((s) => s.approve);
  const draft = useApp((s) => s.draft);
  const setDraft = useApp((s) => s.setDraft);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  const revising = project?.state === "AWAIT_APPROVAL" && project.id === source.id;
  const open = project && project.id === source.id ? project : null;
  // The open project is being worked on: the send button becomes Stop.
  const canStop = busy && !!open?.running;
  useEffect(() => {
    if (!busy) setStopping(false);
  }, [busy]);
  const placeholder = revising
    ? "Describe a change to the plan, e.g. “use a green LED”…"
    : project || source.kind === "demo"
      ? "Next idea? Describe a new project…"
      : "Describe what you want to build, e.g. “light an LED while I hold a button”…";

  // Grow with the text, up to a few lines. Also re-measured when the box gets wider or narrower
  // (Code panel opened/closed, window resized): text that wrapped onto many lines in a narrow box
  // otherwise kept it tall after it widened again.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    };
    fit();
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [draft, placeholder]);

  const text = draft.trim();
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || text.length < 3) return;
    void (revising ? approve(text) : startIdea(text));
    setDraft("");
  };

  return (
    <>
    {open?.usage && (
      <p className="usage-line" aria-live="polite" title="Tokens the AI used for this project so far, over every run (retries and plan changes included)">
        {aiLabel(open.llm, options)} · {usageText(open.usage)}
      </p>
    )}
    <form className={`prompt${focused ? " focused" : ""}`} onSubmit={submit} aria-label={revising ? "Change the plan" : "New project idea"}>
      <textarea
        ref={ref}
        rows={1}
        maxLength={revising ? 1000 : 2000}
        value={draft}
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={busy}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter adds a line (like a chat box).
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <ModelMenu />
      <span className="prompt-mode">{revising ? "Plan change" : "New idea"}</span>
      {canStop ? (
        <button
          type="button"
          className="send stop"
          disabled={stopping}
          aria-label="Stop"
          title="Stop: ends the run at the current step; Retry continues later"
          onClick={() => {
            setStopping(true);
            void stop();
          }}
        >
          ■
        </button>
      ) : (
        <button type="submit" className="send" disabled={busy || text.length < 3} aria-label={revising ? "Send the change" : "Make a plan"}>
          ↑
        </button>
      )}
    </form>
    </>
  );
}
