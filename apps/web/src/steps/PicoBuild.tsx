import { useState } from "react";
import type { DriverFile } from "@breadpilot/circuit-core";

/** File-name-safe version of the project title, e.g. "Wi-Fi Scanner" → "wi-fi-scanner". */
export function uf2Name(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 40).replace(/^-+|-+$/g, "");
  return `${slug || "project"}-pico2w.uf2`;
}

function save(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/octet-stream" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** The debug runner's LED patterns (apps/web/src/pico/debug_main.py), in the order a beginner sees them. */
export const LED_SIGNALS: [string, string][] = [
  ["One long flash (1 s)", "starting"],
  ["Short blink every 2 seconds", "running (good)"],
  ["Stays on", "the program finished"],
  ["3 blinks, pause, repeating", "a part doesn't answer: check its wiring and that the Pico is pushed fully in"],
  ["Fast blinking", "error in the code"],
  ["Never lights up", "not started: copy the .uf2 again"],
];

interface Props {
  title: string;
  code: string;
  drivers: DriverFile[];
  /** null = ready; otherwise why the build is disabled. */
  blocked: string | null;
}

/**
 * "Build for Pico": one UF2 with MicroPython v1.29.0 + main.py (+ driver files). The user holds
 * BOOTSEL, plugs the Pico in and drops the file on the drive that appears; it restarts and runs.
 */
export function PicoBuild({ title, code, drivers, blocked }: Props) {
  const [state, setState] = useState<{ busy: boolean; error?: string; done?: { file: string; kb: number } }>({ busy: false });

  const build = async () => {
    setState({ busy: true });
    try {
      const { buildPicoUf2, picoFiles } = await import("../pico/build"); // ~1.9 MB of tools, loaded on first use
      const result = await buildPicoUf2(picoFiles(code, drivers.map((d) => ({ name: d.file, content: d.source }))));
      const file = uf2Name(title);
      save(file, result.uf2);
      setState({ busy: false, done: { file, kb: Math.round(result.uf2.length / 1024) } });
    } catch (err) {
      setState({ busy: false, error: (err as Error).message });
    }
  };

  return (
    <section className="pico-build">
      <div className="code-head">
        <span className="eyebrow">Put it on the Pico</span>
        <button type="button" className="btn primary small-btn" disabled={!!blocked || state.busy} title={blocked ?? undefined} onClick={() => void build()}>
          {state.busy ? "Building…" : "⬇ Build for Pico"}
        </button>
      </div>
      {blocked && <p className="small muted">{blocked}</p>}
      {state.error && (
        <div className="feedback bad" role="alert">
          <p>The build failed: {state.error}</p>
        </div>
      )}
      {state.done && (
        <div className="feedback good" aria-live="polite">
          <p>
            <strong>{state.done.file}</strong> is in your Downloads.
          </p>
        </div>
      )}
      <ol className="small howto">
        <li>
          Hold <strong>BOOTSEL</strong> while you plug in the USB cable: a drive appears.
        </li>
        <li>Drag the .uf2 file onto it. The Pico restarts and runs your code.</li>
      </ol>
      <details className="small led-legend">
        <summary>What the Pico's green LED tells you</summary>
        <ul>
          {LED_SIGNALS.map(([pattern, meaning]) => (
            <li key={pattern}>
              <strong>{pattern}</strong>: {meaning}
            </li>
          ))}
        </ul>
        <p className="muted">
          The small LED next to the USB port. Errors are also saved in error.txt{drivers.some((d) => d.file === "sh1106.py") ? " and shown on the OLED" : ""}.
        </p>
      </details>
      <p className="small warn-note">
        ⚠ Erases other files on the Pico.
      </p>
    </section>
  );
}
