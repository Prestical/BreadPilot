import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { driversFor, PACKS, type CodeIssue, type DriverFile } from "@breadpilot/circuit-core";
import { handoffUrl } from "../projects/api";
import type { ApiProject } from "../projects/types";
import { checkDraft, insertIndent, loadEdit, saveEdit } from "./codeEdits";
import { PlanView } from "../ui/StageOverlay";
import { PicoBuild } from "./PicoBuild";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/x-python" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false; // clipboard blocked: the user can still select the text
  }
}

/** A driver file the Pico needs next to main.py (e.g. sh1106.py for the OLED display). */
function DriverFileView({ d }: { d: DriverFile }) {
  const [copied, setCopied] = useState(false);
  return (
    <section className="driver-file">
      <div className="code-head">
        <span className="eyebrow">
          {d.file} · {PACKS.find((p) => p.driver?.file === d.file)?.text?.names?.driver ?? "driver"}
        </span>
        <span className="code-actions">
          <button
            type="button"
            className="btn small-btn"
            onClick={() =>
              void copyText(d.source).then((ok) => {
                if (!ok) return;
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              })
            }
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="btn small-btn" onClick={() => download(d.file, d.source)}>
            Download
          </button>
        </span>
      </div>
      <details>
        <summary className="small muted">Show code ({d.source.split("\n").length} lines)</summary>
        <pre className="code" tabIndex={0} aria-label={`${d.file} driver code`}>
          <code>{d.source}</code>
        </pre>
      </details>
    </section>
  );
}

function IssueList({ issues }: { issues: CodeIssue[] }) {
  return (
    <ul className="small">
      {issues.map((i, n) => (
        <li key={n}>
          {i.line ? `Line ${i.line}: ` : ""}
          {i.message}
        </li>
      ))}
    </ul>
  );
}

type View = "preview" | "edit";

export function CodePanel({ p }: { p: ApiProject }) {
  const b = p.build!;
  const drivers = driversFor(b.build.parts.map((x) => x.type));
  const generated = b.code ?? "";
  const [view, setView] = useState<View>("preview");
  const [draft, setDraft] = useState(() => loadEdit(p.id, generated) ?? generated);
  const [copied, setCopied] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const edited = draft !== generated;

  // Another project (or a regenerated one) → show its own code and edits.
  useEffect(() => {
    setDraft(loadEdit(p.id, generated) ?? generated);
    setView("preview");
  }, [p.id, generated]);

  useEffect(() => saveEdit(p.id, generated, draft), [p.id, generated, draft]);

  // The code is always re-checked in the browser with the CURRENT checker (edited or not): a result
  // stored when the project was generated can be out of date once the checks get stricter, and the
  // Build for Pico button must follow today's rules. Typing stays smooth (deferred copy).
  const deferred = useDeferredValue(draft);
  const check = useMemo(() => checkDraft(deferred, b.build), [deferred, b.build]);
  const stale = !edited && !!b.codeCheck?.ok && !check.ok;
  const errors = check?.issues.filter((i) => i.severity === "error") ?? [];
  const warnings = check?.issues.filter((i) => i.severity === "warning") ?? [];

  const copy = async () => {
    if (!(await copyText(draft))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const reset = () => {
    if (window.confirm("Throw away your changes and go back to the generated code?")) setDraft(generated);
  };

  const plan = p.plans.at(-1);
  const blocked = errors.length || !check?.ok ? (edited ? "Fix the problems in your edits first." : "Fix the code in Edit first: it didn't pass the wiring check.") : null;

  return (
    <div className="code-panel">
      {/* Left: the program itself, as wide as possible. */}
      <div className="code-main">
        <div className="code-head">
          <span className="eyebrow">
            main.py {edited && <span className="edited-badge">edited</span>}
          </span>
          <span className="code-actions">
            <span className="view-switch" role="group" aria-label="Code view">
              <button type="button" aria-pressed={view === "preview"} onClick={() => setView("preview")}>
                Preview
              </button>
              <button
                type="button"
                aria-pressed={view === "edit"}
                onClick={() => {
                  setView("edit");
                  setTimeout(() => editorRef.current?.focus(), 0);
                }}
              >
                Edit
              </button>
            </span>
            <button type="button" className="btn small-btn" onClick={() => void copy()}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="btn small-btn" onClick={() => download("main.py", draft)}>
              Download
            </button>
            {edited && (
              <button type="button" className="btn small-btn" onClick={reset}>
                Reset
              </button>
            )}
          </span>
        </div>

        {view === "preview" ? (
          <pre className="code numbered" tabIndex={0} aria-label="MicroPython code (preview)">
            <code>
              {draft.replace(/\n$/, "").split("\n").map((line, i) => (
                <span key={i} className="ln">
                  {line || " "}
                </span>
              ))}
            </code>
          </pre>
        ) : (
          <textarea
            ref={editorRef}
            className="code-editor"
            value={draft}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Edit main.py"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Tab indents (4 spaces, like the generated code) instead of leaving the editor.
              if (e.key !== "Tab" || e.shiftKey) return;
              e.preventDefault();
              const el = e.currentTarget;
              const next = insertIndent(el.value, el.selectionStart, el.selectionEnd);
              setDraft(next.text);
              requestAnimationFrame(() => el.setSelectionRange(next.cursor, next.cursor));
            }}
          />
        )}

        {drivers.map((d) => (
          <DriverFileView key={d.file} d={d} />
        ))}
      </div>

      {/* Right: is it safe to run, put it on the Pico, what it does. */}
      <div className="code-aside">
        {!edited && check?.ok && (
          <div className="feedback good">
            <p>
              <strong>✓ Matches your wiring</strong>
              {b.codeAttempts > 1 ? ` (fixed after ${b.codeAttempts} tries)` : ""}
            </p>
          </div>
        )}
        {!edited && !check?.ok && (
          <div className="feedback bad">
            <p>
              <strong>{stale ? "Fails today's stricter checks." : `Didn't pass the wiring check after ${b.codeAttempts} tries.`}</strong> Fix it in Edit, or download the handoff bundle.
            </p>
            <IssueList issues={errors} />
          </div>
        )}
        {edited && (
          <div className={`feedback ${errors.length ? "bad" : "good"}`} aria-live="polite">
            <p>
              <strong>{errors.length ? `Your edits have ${errors.length} problem${errors.length > 1 ? "s" : ""}:` : "✓ Your edits still match the wiring"}</strong>
            </p>
            {errors.length > 0 && <IssueList issues={errors} />}
          </div>
        )}

        <PicoBuild title={p.title} code={draft} drivers={drivers} blocked={blocked} />

        {b.codeExplanation && (
          <section>
            <p className="eyebrow">How it works</p>
            <p className="small">{b.codeExplanation}</p>
          </section>
        )}

        {warnings.length > 0 && (
          <details className="small">
            <summary>Checker notes ({warnings.length})</summary>
            <ul>
              {warnings.map((i, n) => (
                <li key={n}>
                  {i.line ? `Line ${i.line}: ` : ""}
                  {i.message}
                </li>
              ))}
            </ul>
          </details>
        )}

        {plan && (
          <details className="small plan-details">
            <summary>Plan</summary>
            <PlanView plan={plan} />
          </details>
        )}

        <details className="small">
          <summary>Copy the files by hand (Thonny)</summary>
          <ol className="howto">
            <li>In Thonny, pick the MicroPython (Raspberry Pi Pico) interpreter.</li>
            {drivers.map((d) => (
              <li key={d.file}>
                Save <code>{d.file}</code> on the Pico.
              </li>
            ))}
            <li>
              Save the code on the Pico as <code>main.py</code>.
            </li>
          </ol>
        </details>

        {b.citations.length > 0 && (
          <details className="small">
            <summary>Sources ({b.citations.length})</summary>
            <ul className="muted">
              {b.citations.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </details>
        )}

        <a className="btn small-btn" href={handoffUrl(p.id)} download>
          Download handoff bundle (.md)
        </a>
      </div>
    </div>
  );
}
