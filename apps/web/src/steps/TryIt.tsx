// The Code tab's "Try it" panel (M8 8.C3c): runs main.py live on a simulated copy of the project's
// circuit, in this page (packages/sim browser runner). The screen animates, LEDs light, buzzers show
// their tone and print() output scrolls, while the controls press buttons, turn knobs and change what
// sensors sense. Loaded only when the Code tab opens (CodePanel lazy-loads it); MicroPython's
// WebAssembly loads on the first Run.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Build } from "@breadpilot/circuit-core";
import {
  applyEvents,
  electricalModel,
  emptyPreview,
  framePixels,
  inputSlots,
  ledFullMa,
  previewAvailable,
  startPreview,
  type Preview,
  type PreviewState,
  type SimError,
} from "@breadpilot/sim/browser";
import { brightness, controlsFor, controlWrites, endText, fromPosition, LOG_STEPS, moduleText, outputsFor, toPosition, valueText, type TryControl } from "./tryControls";

const OPEN_KEY = "breadpilot.tryIt.open";
const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) !== "0";
  } catch {
    return true;
  }
};

type End = { ended: string; error?: SimError };

export default function TryIt({ code, build, files, blocked, onShowLine }: { code: string; build: Build; files: Record<string, string>; blocked: string | null; onShowLine: (line: number) => void }) {
  const model = useMemo(() => electricalModel(build), [build]);
  const controls = useMemo(() => controlsFor(inputSlots(model), build, model), [model, build]);
  const outputs = useMemo(() => outputsFor(build, model), [build, model]);
  const ledFull = useMemo(() => ledFullMa(model), [model]);

  const [open, setOpen] = useState(readOpen);
  const [running, setRunning] = useState(false);
  const [state, setState] = useState<PreviewState>(emptyPreview);
  const [end, setEnd] = useState<End | null>(null);
  const [values, setValues] = useState<number[]>(() => controls.map((c) => c.value));
  const preview = useRef<Preview | null>(null);
  const restart = useRef(false);
  const valuesRef = useRef(values);
  valuesRef.current = values;

  // Another circuit: its own controls at rest.
  useEffect(() => setValues(controls.map((c) => c.value)), [controls]);

  const stop = useCallback(() => preview.current?.stop(), []);

  const run = useCallback(() => {
    if (blocked || preview.current) return;
    setState(emptyPreview());
    setEnd(null);
    setRunning(true);
    try {
      const p = startPreview({
        code,
        circuit: build,
        files,
        onEvents: (events) => setState((s) => applyEvents(s, events)),
        onEnd: (e) => {
          preview.current = null;
          setRunning(false);
          setEnd(e);
          if (restart.current) {
            restart.current = false;
            setTimeout(() => runRef.current(), 0);
          }
        },
      });
      preview.current = p;
      // The controls as they are now (a switch left on, a knob turned before Run).
      controls.forEach((c, i) => {
        for (const [slot, v] of controlWrites(c, valuesRef.current[i] ?? c.value)) p.set(slot, v);
      });
    } catch (err) {
      setRunning(false);
      setEnd({ ended: "error", error: { type: "Preview", message: (err as Error).message, traceback: "" } });
    }
  }, [blocked, code, build, files, controls]);
  const runRef = useRef(run);
  runRef.current = run;

  // The code or the circuit changed, or the panel goes away: the run stops.
  useEffect(() => () => preview.current?.stop(), [code, build]);

  const set = (i: number, v: number) => {
    setValues((old) => old.map((x, n) => (n === i ? v : x)));
    const c = controls[i]!;
    if (preview.current) for (const [slot, value] of controlWrites(c, v)) preview.current.set(slot, value);
  };

  const toggleOpen = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      /* storage blocked: the panel just doesn't remember */
    }
    if (!next) stop();
  };

  const available = previewAvailable();
  const hasOutputs = outputs.leds.length + outputs.modules.length + outputs.displays.length > 0;

  return (
    <details className="try-it" open={open} onToggle={(e) => toggleOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span className="eyebrow">Try it</span>
        <span className="small muted"> runs the code on a simulated copy of this circuit</span>
      </summary>

      {!available ? (
        <p className="small">The preview needs BreadPilot's own page (it couldn't start here). Restart the app and try again.</p>
      ) : (
        <>
          <div className="try-actions">
            {running ? (
              <>
                <button type="button" className="btn small-btn" onClick={stop}>
                  Stop
                </button>
                <button
                  type="button"
                  className="btn small-btn"
                  onClick={() => {
                    restart.current = true;
                    stop();
                  }}
                >
                  Restart
                </button>
                <span className="small muted" aria-live="polite">
                  Running
                </span>
              </>
            ) : (
              <button type="button" className="btn small-btn primary" onClick={run} disabled={!!blocked}>
                Run
              </button>
            )}
            {blocked && !running && <span className="small muted">{blocked}</span>}
          </div>

          {hasOutputs && (
            <div className="try-outputs">
              {outputs.displays.map((d) => (
                <figure key={d.ref} className="try-screen">
                  <Screen b64={state.frames[d.ref]} label={`${d.ref} screen`} />
                  <figcaption className="small muted">{d.ref}</figcaption>
                </figure>
              ))}
              {(outputs.leds.length > 0 || outputs.modules.length > 0) && (
                <ul className="try-devices">
                  {outputs.leds.map((l) => {
                    const b = brightness(state.leds[l.ref], ledFull[l.ref]);
                    return (
                      <li key={l.ref}>
                        <span className="try-led" style={{ background: b > 0 ? l.colour : undefined, opacity: b > 0 ? 0.35 + 0.65 * b : undefined, boxShadow: b > 0 ? `0 0 ${4 + 10 * b}px ${l.colour}` : undefined }} aria-hidden="true" />
                        <span className="small">
                          {l.ref} <span className="muted">{b > 0 ? (b < 0.98 ? `on, ${Math.round(b * 100)} %` : "on") : "off"}</span>
                        </span>
                      </li>
                    );
                  })}
                  {outputs.modules.map((m) => (
                    <li key={m.ref}>
                      <span className={`try-module${(state.modules[m.ref]?.on ?? 0) > 0 ? " on" : ""}`} aria-hidden="true" />
                      <span className="small">
                        {m.ref} <span className="muted">{moduleText(m.type, state.modules[m.ref])}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {controls.length > 0 && (
            <div className="try-controls" role="group" aria-label="Inputs">
              {controls.map((c, i) => (
                <Control key={`${c.ref}-${c.label}`} c={c} value={values[i] ?? c.value} onChange={(v) => set(i, v)} />
              ))}
            </div>
          )}

          {end && (
            <p className={`small${end.ended === "error" ? " try-error" : ""}`} role="status">
              {endText(end)}{" "}
              {end.error?.line ? (
                <button type="button" className="link-btn" onClick={() => onShowLine(end.error!.line!)}>
                  Show line {end.error.line}
                </button>
              ) : null}
            </p>
          )}
          {state.behindMs > 0 && running && <p className="small muted">Running slower than real time on this computer ({(state.behindMs / 1000).toFixed(1)} s behind), so timings differ from the Pico.</p>}
          {state.notes.length > 0 && (
            <ul className="small muted">
              {state.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}

          {state.prints.length > 0 && <Printed lines={state.prints} />}
        </>
      )}
    </details>
  );
}

/** A 128×64 display, pixel for pixel (scaled by CSS). */
function Screen({ b64, label }: { b64: string | undefined; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const img = ctx.createImageData(128, 64);
    const px = b64 ? framePixels(b64) : null;
    for (let i = 0; i < 128 * 64; i++) {
      const lit = px?.[i] === 1;
      img.data[i * 4] = lit ? 200 : 6;
      img.data[i * 4 + 1] = lit ? 232 : 8;
      img.data[i * 4 + 2] = lit ? 255 : 12;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [b64]);
  return <canvas ref={ref} width={128} height={64} className="try-canvas" role="img" aria-label={b64 ? label : `${label}: nothing shown yet`} />;
}

function Printed({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);
  return (
    <pre ref={ref} className="code try-output" tabIndex={0} aria-label="Printed output">
      {lines.join("\n")}
    </pre>
  );
}

function Control({ c, value, onChange }: { c: TryControl; value: number; onChange: (v: number) => void }) {
  const name = `${c.ref} ${c.label}`;
  if (c.kind === "hold") {
    const down = value === 1;
    const press = (v: number) => {
      if ((v === 1) !== down) onChange(v);
    };
    return (
      <div className="try-control">
        <span className="small" title={c.part}>
          {c.ref}
        </span>
        <button
          type="button"
          className={`btn small-btn try-hold${down ? " down" : ""}`}
          aria-pressed={down}
          aria-label={`${c.ref}: hold to press`}
          onPointerDown={(e) => {
            press(1);
            try {
              e.currentTarget.setPointerCapture(e.pointerId); // the release counts even off the button
            } catch {
              /* no capture for this pointer: releasing over the button still counts */
            }
          }}
          onPointerUp={() => press(0)}
          onPointerCancel={() => press(0)}
          onKeyDown={(e) => {
            if ((e.key === " " || e.key === "Enter") && !e.repeat) {
              e.preventDefault();
              press(1);
            }
          }}
          onKeyUp={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              press(0);
            }
          }}
          onBlur={() => press(0)}
        >
          {down ? "Pressed" : "Hold to press"}
        </button>
      </div>
    );
  }
  if ((c.kind === "toggle" || c.kind === "side") && c.options) {
    return (
      <div className="try-control">
        <span className="small" title={c.part}>
          {c.ref}
        </span>
        <span className="view-switch" role="group" aria-label={name}>
          {c.options.map((o) => (
            <button key={o.label} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
              {o.label}
            </button>
          ))}
        </span>
      </div>
    );
  }
  const pos = toPosition(c, value);
  return (
    <label className="try-control try-slider">
      <span className="small" title={c.part}>
        {c.ref} {c.label.toLowerCase()}
        {c.testRange ? <span className="muted"> (test range)</span> : null}
      </span>
      <input
        type="range"
        min={c.log ? 0 : c.min}
        max={c.log ? LOG_STEPS : c.max}
        step={c.log ? 1 : c.step}
        value={pos}
        aria-label={name}
        aria-valuetext={valueText(c, value)}
        onChange={(e) => onChange(fromPosition(c, Number(e.target.value)))}
      />
      <span className="small muted try-value">{valueText(c, value)}</span>
    </label>
  );
}
