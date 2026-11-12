// The current build step, shown as a pop-up next to the part or wire in the 3D scene (or docked
// above the prompt on narrow screens), plus a strip with one segment per step.
import { useState } from "react";
import type { BuildStep } from "@breadpilot/circuit-core";
import type { BuildView } from "../projects/view";
import type { NeedItem } from "../projects/parts";
import { useApp } from "../store";
import { Icon } from "./Icon";

interface Props {
  steps: BuildStep[];
  /** Narrow screens: a compact card under the 3D view; the details fold away. */
  docked?: boolean;
  /** "What you need", shown on the first step so it can be checked before building. */
  need?: NeedItem[];
  /** The project has code: the last step leads on to putting it on the Pico. */
  hasCode?: boolean;
  /** M9: this version is a change: the steps can be only the changes or all of them. */
  change?: BuildView["change"];
}

/** M9: which steps are shown after a change, with the switch to the other list. */
function ChangeNote({ change }: { change: NonNullable<BuildView["change"]> }) {
  const setAllSteps = useApp((s) => s.setAllSteps);
  if (change.count === 0) return <p className="change-note small">Only the code changed in this version: nothing to change on the breadboard.</p>;
  return (
    <p className="change-note small">
      {change.showing === "changes" ? `Only the changes: ${change.count} of ${change.total} steps.` : `All ${change.total} steps of the whole build.`}{" "}
      <button type="button" className="link-btn" onClick={() => setAllSteps(change.showing === "changes")}>
        {change.showing === "changes" ? "Show all steps" : "Show only the changes"}
      </button>
    </p>
  );
}

export function StepCard({ steps, docked = false, need, hasCode = false, change }: Props) {
  const stepIndex = useApp((s) => s.stepIndex);
  const setStep = useApp((s) => s.setStep);
  const setCodeOpen = useApp((s) => s.setCodeOpen);
  const [details, setDetails] = useState(false);
  const step = steps[Math.min(stepIndex, steps.length - 1)]!;
  const last = step.index === steps.length - 1;
  const full = !docked || details;
  return (
    <section className={`step-pop${docked ? " docked" : ""}${step.index === 0 && need ? " with-need" : ""}`} aria-live="polite" aria-labelledby="step-title">
      {!docked && <span className="step-pointer" aria-hidden="true" />}
      <p className="eyebrow">
        {change?.showing === "changes" ? "Change step" : "Step"} {step.index + 1} of {steps.length}
      </p>
      {change && step.index === 0 && <ChangeNote change={change} />}
      <h2 id="step-title">{step.title}</h2>
      {full && <p>{step.text}</p>}
      {step.dsl && <code className="dsl">{step.dsl}</code>}
      {full && (
        <p className="why">
          <strong>Why:</strong> {step.why}
        </p>
      )}
      {full && step.tip && (
        <p className="tip">
          <Icon name="bulb" /> <span>{step.tip}</span>
        </p>
      )}
      {full && step.index === 0 && need && (
        <div className="need">
          <p className="eyebrow">What you need</p>
          <ul>
            {need.map((n) => (
              <li key={n.name}>
                <strong>{n.count}×</strong> {n.name}
                {n.detail && <span className="muted"> ({n.detail})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {docked && (
        <button type="button" className="link-btn" aria-expanded={details} onClick={() => setDetails(!details)}>
          {details ? "Fewer details" : "More details"}
        </button>
      )}
      <div className="row">
        <button type="button" onClick={() => setStep(step.index - 1)} disabled={step.index === 0}>
          <Icon name="arrow-left" /> Back
        </button>
        {last && hasCode ? (
          <button type="button" className="primary" onClick={() => setCodeOpen(true)}>
            Put it on your Pico <Icon name="arrow-right" />
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => setStep(step.index + 1)} disabled={last}>
            {last ? "Done" : <>Next <Icon name="arrow-right" /></>}
          </button>
        )}
      </div>
    </section>
  );
}

export function StepStrip({ steps }: { steps: BuildStep[] }) {
  const stepIndex = useApp((s) => s.stepIndex);
  const setStep = useApp((s) => s.setStep);
  const current = Math.min(stepIndex, steps.length - 1);
  return (
    <nav className="step-strip" aria-label="Build steps (← and → keys also work)">
      <button type="button" className="icon-btn" aria-label="Previous step" disabled={current === 0} onClick={() => setStep(current - 1)}>
        <Icon name="chevron-left" />
      </button>
      <ol>
        {steps.map((s) => (
          <li key={s.index}>
            <button
              type="button"
              className={s.index === current ? "current" : s.index < current ? "done" : ""}
              aria-current={s.index === current ? "step" : undefined}
              aria-label={`Step ${s.index + 1}: ${s.title}`}
              title={`${s.index + 1}. ${s.title}`}
              onClick={() => setStep(s.index)}
            />
          </li>
        ))}
      </ol>
      <span className="strip-count">
        {current + 1}/{steps.length}
      </span>
      <button type="button" className="icon-btn" aria-label="Next step" disabled={current === steps.length - 1} onClick={() => setStep(current + 1)}>
        <Icon name="chevron-right" />
      </button>
    </nav>
  );
}
