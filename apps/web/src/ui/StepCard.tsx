// The current build step, shown as a pop-up next to the part or wire in the 3D scene (or docked
// above the prompt on narrow screens), plus a strip with one segment per step.
import { useState } from "react";
import type { BuildStep } from "@breadpilot/circuit-core";
import type { NeedItem } from "../projects/parts";
import { useApp } from "../store";

interface Props {
  steps: BuildStep[];
  /** Narrow screens: a compact card under the 3D view; the details fold away. */
  docked?: boolean;
  /** "What you need", shown on the first step so it can be checked before building. */
  need?: NeedItem[];
  /** The project has code: the last step leads on to putting it on the Pico. */
  hasCode?: boolean;
}

export function StepCard({ steps, docked = false, need, hasCode = false }: Props) {
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
        Step {step.index + 1} of {steps.length}
      </p>
      <h2 id="step-title">{step.title}</h2>
      {full && <p>{step.text}</p>}
      {step.dsl && <code className="dsl">{step.dsl}</code>}
      {full && (
        <p className="why">
          <strong>Why:</strong> {step.why}
        </p>
      )}
      {full && step.tip && <p className="tip">💡 {step.tip}</p>}
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
          ← Back
        </button>
        {last && hasCode ? (
          <button type="button" className="primary" onClick={() => setCodeOpen(true)}>
            Put it on your Pico →
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => setStep(step.index + 1)} disabled={last}>
            {last ? "Done" : "Next →"}
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
        ‹
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
        ›
      </button>
    </nav>
  );
}
