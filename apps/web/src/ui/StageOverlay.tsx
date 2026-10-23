// Cards that float over the 3D stage, above the prompt bar: the greeting for a new project,
// live progress, plan approval, and the result of a run (handoff, failure, errors).
import { useEffect, useState, type ReactNode } from "react";
import { fillTemplate, packByKind, PACKS } from "@breadpilot/circuit-core";
import { handoffUrl } from "../projects/api";
import { timeline, typicalWait, type Tone } from "../projects/progress";
import type { PlanPart, PlanVersion } from "../projects/types";
import { projectView } from "../projects/view";
import { useApp } from "../store";
import { aiLabel } from "./AiPicker";

// One per kind of project the app can build: a first LED, a game on the display, Wi-Fi, a puzzle.
const EXAMPLES = [
  "Blink an LED",
  "Snake on the OLED display, steered with 2 buttons",
  "Scan nearby Wi-Fi networks and list them on the OLED",
  "Simon Says with 4 colored LEDs and 4 buttons",
];

const ICON: Record<Tone, string> = { busy: "…", ok: "✓", warn: "!", bad: "✕" };
/** A plan part's label and colour dot, from its pack (text.json names.plan / names.planDot). */
export function planPartName(part: PlanPart): { name: string; dot?: string } {
  const pack = packByKind(part.kind);
  const names = pack?.text?.names;
  const vars = Object.fromEntries(Object.entries(pack?.agent?.plan.props ?? {}).map(([field, request]) => [field, part[field] ?? planDefault(part.kind, request)]));
  return { name: names?.plan ? fillTemplate(names.plan, vars) : (pack?.part.name ?? part.kind), ...(names?.planDot ? { dot: `${part.kind}-${vars[names.planDot]}` } : {}) };
}

const planDefault = (kind: string, request: string) =>
  packByKind(kind)?.layout?.parts.flatMap((x) => Object.values(x.props ?? {})).find((v) => v.request === request)?.default;

/** The start screen's parts line: each pack's names.greeting. */
export const GREETING_PARTS = PACKS.flatMap((p) => (p.text?.names?.greeting ? [p.text.names.greeting] : [])).join(", ");

function Greeting() {
  const setDraft = useApp((s) => s.setDraft);
  return (
    <section className="float-card greeting" aria-labelledby="greet-title">
      <h1 id="greet-title">What do you want to build?</h1>
      <p className="muted">Describe an idea. You get a safety-checked plan, step-by-step wiring and the code.</p>
      <div className="chips" aria-label="Example ideas">
        {EXAMPLES.map((x) => (
          <button key={x} type="button" className="chip" onClick={() => setDraft(x)}>
            {x}
          </button>
        ))}
      </div>
      <p className="muted small">
        Parts: {GREETING_PARTS}, and the Pico's own LED, Wi-Fi and temperature sensor.
      </p>
    </section>
  );
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span>{Math.max(0, Math.round((now - since) / 1000))} s</span>;
}

function Progress() {
  const events = useApp((s) => s.agent.events);
  const startedAt = useApp((s) => s.agent.startedAt);
  const model = useApp((s) => aiLabel(s.agent.project?.llm, s.aiOptions));
  const wait = useApp((s) => typicalWait(s.agent.project?.llm));
  const rows = timeline(events);
  return (
    <section className="float-card progress" aria-live="polite" aria-busy="true">
      <p className="eyebrow">
        Working on it · {model} {startedAt && <>· <Elapsed since={startedAt} /></>}
      </p>
      <ol className="timeline">
        {(rows.length ? rows : [{ text: "Starting…", tone: "busy" as Tone, detail: undefined }]).map((r, i) => (
          <li key={i} className={`tone-${r.tone}`}>
            <span className="ticon" aria-hidden="true">
              {ICON[r.tone]}
            </span>
            <span>
              {r.text}
              {r.detail && <span className="tdetail">{r.detail}</span>}
            </span>
          </li>
        ))}
      </ol>
      <p className="muted small">{wait}</p>
    </section>
  );
}

export function PlanView({ plan }: { plan: PlanVersion }) {
  return (
    <div className="plan">
      <h3>{plan.title}</h3>
      <p>{plan.goal}</p>
      <p className="eyebrow">What it does</p>
      <ul>
        {plan.behavior.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
      <p className="eyebrow">Parts</p>
      {plan.parts.length ? (
        <ul className="parts">
          {plan.parts.map((part, i) => (
            <li key={i}>
              {planPartName(part).dot && <span className={`dot ${planPartName(part).dot}`} aria-hidden="true" />}
              <strong>{planPartName(part).name}</strong>
              {part.pin && <code className="pin">{part.pin}</code>} <span className="muted">{part.purpose}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No extra parts: this uses the Pico's own LED.</p>
      )}
      {plan.feedback && <p className="muted small">Version {plan.version}, after your change: “{plan.feedback}”</p>}
      {plan.autoFix && <p className="muted small">Version {plan.version}, fixed automatically: {plan.autoFix}</p>}
    </div>
  );
}

function Approval({ plan }: { plan: PlanVersion }) {
  const approve = useApp((s) => s.approve);
  const busy = useApp((s) => s.agent.busy);
  return (
    <section className="float-card approval" aria-labelledby="approval-title">
      <p className="eyebrow" id="approval-title">
        Check the plan
      </p>
      {plan.questions.length > 0 && (
        <div className="feedback info">
          <p>
            <strong>Questions before building:</strong>
          </p>
          <ul>
            {plan.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      <PlanView plan={plan} />
      <div className="card-actions">
        <button type="button" className="btn primary" disabled={busy} onClick={() => void approve()}>
          Looks good, build it
        </button>
        <span className="muted small">Or type a change below.</span>
      </div>
    </section>
  );
}

export function StageOverlay() {
  const source = useApp((s) => s.source);
  const agent = useApp((s) => s.agent);
  const retry = useApp((s) => s.retry);
  const dismissError = useApp((s) => s.dismissError);
  const [hidden, setHidden] = useState<string | null>(null);
  const p = source.kind === "agent" && agent.project?.id === source.id ? agent.project : null;
  const view = p ? projectView(p) : null;
  const plan = p?.plans.at(-1);
  // A dismissed result banner stays hidden until the project changes.
  const bannerKey = p ? `${p.id}@${p.updatedAt}` : "";

  let card: ReactNode = null;
  if (agent.busy) card = <Progress />;
  else if (source.kind === "agent" && !source.id) card = <Greeting />;
  else if (p?.state === "AWAIT_APPROVAL" && plan) card = <Approval plan={plan} />;
  else if (p && hidden !== bannerKey && (p.state === "FAILED" || p.state === "HANDOFF" || view?.kind === "unsafe")) {
    card = (
      <section className={`float-card banner ${p.state === "HANDOFF" ? "warn" : "bad"}`} role="status">
        <button type="button" className="icon-btn banner-close" aria-label="Hide this message" onClick={() => setHidden(bannerKey)}>
          ✕
        </button>
        {view?.kind === "unsafe" ? (
          <p>
            <strong>These steps are hidden:</strong> the safety check in your browser found a problem with this build ({view.message}).
          </p>
        ) : p.state === "FAILED" ? (
          <>
            <p>
              {/^stopped\b/i.test(p.failure ?? "") ? (
                p.failure
              ) : (
                <>
                  <strong>Couldn't finish:</strong> {p.failure}
                </>
              )}
            </p>
            <div className="card-actions">
              <button type="button" className="btn primary" disabled={agent.busy} onClick={() => void retry()}>
                Try again
              </button>
              <span className="muted small">Finished stages are kept.</span>
            </div>
          </>
        ) : (
          <>
            <p>{p.handoffReason}</p>
            {view?.kind === "build" && <p className="small">The wiring is ready and checked, so you can still follow the steps.</p>}
            <a className="btn" href={handoffUrl(p.id)} download>
              Download handoff bundle (.md)
            </a>
          </>
        )}
      </section>
    );
  }

  return (
    <div className="overlay-dock">
      {agent.error && (
        <div className="float-card toast bad" role="alert">
          <p>{agent.error}</p>
          <button type="button" className="icon-btn" aria-label="Dismiss" onClick={dismissError}>
            ✕
          </button>
        </div>
      )}
      {card}
    </div>
  );
}
