import type { PowerMode } from "@breadpilot/circuit-core";
import { currentPower, useApp } from "../store";

const OPTIONS: { mode: PowerMode; label: string; help: string }[] = [
  {
    mode: "rails",
    label: "Breadboard rails",
    help: "The Pico's GND and 3V3 pins feed the breadboard's − and + rails, and every part takes power from the rails. Tidy, and works for any number of parts.",
  },
  {
    mode: "direct",
    label: "Direct to Pico",
    help: "No rails: every GND and 3V3 wire goes straight from a Pico pin to the part. Each Pico pin has room for two wires, so this fits up to two knobs.",
  },
];

/** Switches where the parts take GND/3V3 from. Both modes are powered by the USB cable. */
export function PowerToggle() {
  const power = useApp(currentPower);
  const setPower = useApp((s) => s.setPower);
  const busy = useApp((s) => s.agent.busy);
  return (
    <div className="power-toggle" role="group" aria-label="Power wiring (both modes use the Pico's USB power)">
      <span className="power-label" aria-hidden="true">
        ⚡ Power
      </span>
      {OPTIONS.map((o) => (
        <button key={o.mode} type="button" aria-pressed={power === o.mode} title={o.help} disabled={busy} onClick={() => void setPower(o.mode)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
