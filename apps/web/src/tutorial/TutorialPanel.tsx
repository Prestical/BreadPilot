import { useApp } from "../store";
import { CHAPTERS } from "./chapters";

export function TutorialPanel() {
  const tut = useApp((s) => s.tut);
  const tutNext = useApp((s) => s.tutNext);
  const tutBack = useApp((s) => s.tutBack);
  const tutGo = useApp((s) => s.tutGo);
  const setMode = useApp((s) => s.setMode);
  const chapter = CHAPTERS[tut.chapter]!;
  const step = chapter.steps[tut.step]!;
  const canNext = step.expect.type === "next" || tut.passed;
  const isLast = tut.chapter === CHAPTERS.length - 1 && tut.step === chapter.steps.length - 1;

  if (tut.finished) {
    return (
      <div className="panel">
        <section className="step-card">
          <p className="eyebrow">Tutorial complete 🎉</p>
          <h2>You're ready to build</h2>
          <p>You know how the breadboard connects, how the Pico's pins are numbered, how to read a connection line, and how the app keeps you safe.</p>
          <div className="row">
            <button type="button" onClick={() => tutGo(0)}>
              Start over
            </button>
            <button type="button" className="primary" onClick={() => setMode("build")}>
              Build a project →
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="panel">
      <nav aria-label="Tutorial chapters">
        <ol className="chapters">
          {CHAPTERS.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                className={i === tut.chapter ? "current" : tut.completed.includes(c.id) ? "done" : ""}
                aria-current={i === tut.chapter ? "step" : undefined}
                onClick={() => tutGo(i)}
                title={c.summary}
              >
                <span className="num">{tut.completed.includes(c.id) && i !== tut.chapter ? "✓" : i + 1}</span>
                {c.title}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section className="step-card" aria-live="polite" aria-labelledby="tut-title">
        <p className="eyebrow">
          Chapter {tut.chapter + 1} · step {tut.step + 1} of {chapter.steps.length}
        </p>
        <h2 id="tut-title">{chapter.title}</h2>
        <p>{step.text}</p>
        {step.expect.type !== "next" && !tut.passed && !tut.feedback && (
          <p className="task">{step.expect.type === "wire" ? "👆 Click two holes in the 3D view to place a wire." : "👆 Click in the 3D view."}</p>
        )}
        {tut.feedback && (
          <div className={`feedback ${tut.passed ? "good" : tut.attempt?.blocked ? "bad" : "info"}`} role="status">
            {tut.feedback.issue && tut.attempt?.blocked && (
              <p>
                <strong>{tut.feedback.issue.code}:</strong> {tut.feedback.issue.message}
              </p>
            )}
            <p>{tut.feedback.message}</p>
            {tut.attempt && <code className="dsl">{tut.attempt.dsl}</code>}
          </div>
        )}
        <div className="row">
          <button type="button" onClick={tutBack} disabled={tut.chapter === 0 && tut.step === 0}>
            ← Back
          </button>
          <button type="button" className="primary" onClick={tutNext} disabled={!canNext}>
            {isLast ? "Finish" : "Next →"}
          </button>
        </div>
      </section>
    </div>
  );
}
