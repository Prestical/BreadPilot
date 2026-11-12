import { useEffect, useRef, useState, type FormEvent } from "react";
import { useApp } from "../store";
import { editKey, loadEdit } from "../steps/codeEdits";
import { aiLabel, ModelMenu } from "./AiPicker";
import { usageText } from "./labels";
import { Icon } from "./Icon";

/**
 * The one text box, at the bottom of the 3D stage. While a plan waits for approval it sends a
 * change to that plan. Inside an open finished project it sends a change to that project (M9: no
 * extra button; a new project starts from "New project" in the sidebar). Otherwise it starts a new
 * project.
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
  const revise = useApp((s) => s.revise);
  const [useEdits, setUseEdits] = useState(true);
  const draft = useApp((s) => s.draft);
  const setDraft = useApp((s) => s.setDraft);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);

  const revising = project?.state === "AWAIT_APPROVAL" && project.id === source.id;
  const open = project && project.id === source.id ? project : null;
  // M9: typed inside a finished project, it's a change to that project.
  const changing = !revising && !!open?.build && (open.state === "READY" || open.state === "HANDOFF");
  const hasEdits = changing && !!open && loadEdit(editKey(open), open.build?.code ?? "") !== null;
  // The open project is being worked on: the send button becomes Stop.
  const canStop = busy && !!open?.running;
  useEffect(() => {
    if (!busy) setStopping(false);
  }, [busy]);
  const placeholder = revising
    ? "Describe a change to the plan, e.g. “use a green LED”…"
    : changing
      ? "Describe a change to this project, e.g. “make the LED blink faster”…"
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
    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      // Resizing inside the observer's own callback changes the layout it's reporting on, and the
      // browser logs "ResizeObserver loop completed with undelivered notifications": wait a frame.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [draft, placeholder]);

  const text = draft.trim();
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || text.length < 3) return;
    void (revising ? approve(text) : changing ? revise(text, hasEdits && useEdits) : startIdea(text));
    setDraft("");
  };

  return (
    <>
    {open?.usage && (
      <p className="usage-line" aria-live="polite" title="Tokens the AI used for this project so far, over every run (retries and plan changes included)">
        {aiLabel(open.llm, options)} · {usageText(open.usage)}
      </p>
    )}
    {hasEdits && (
      <label className="edits-choice">
        <input type="checkbox" checked={useEdits} onChange={(e) => setUseEdits(e.target.checked)} /> Start from my edited code
      </label>
    )}
    <form className={`prompt${focused ? " focused" : ""}`} data-tour="prompt" onSubmit={submit} aria-label={revising ? "Change the plan" : changing ? "Change this project" : "New project idea"}>
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
          <Icon name="stop" />
        </button>
      ) : (
        <button type="submit" className="send" disabled={busy || text.length < 3} aria-label={revising || changing ? "Send the change" : "Make a plan"}>
          <Icon name="arrow-up" size={18} />
        </button>
      )}
    </form>
    </>
  );
}
