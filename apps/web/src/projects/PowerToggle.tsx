import type { PowerMode } from "@breadpilot/circuit-core";
import { canWireDirect } from "../demos";
import { currentPower, useApp } from "../store";
import { Icon } from "../ui/Icon";

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
  // An example with more than two powered parts can't be wired direct: the rails only.
  const railsOnly = useApp((s) => s.source.kind === "demo" && !canWireDirect(s.source.id));
  return (
    <div className="power-toggle" data-tour="power" role="group" aria-label="Power wiring (both modes use the Pico's USB power)">
      <span className="power-label" aria-hidden="true">
        <Icon name="bolt" size={14} /> Power
      </span>
      {OPTIONS.map((o) => (
        <button key={o.mode} type="button" aria-pressed={power === o.mode} title={railsOnly && o.mode === "direct" ? "This example has more parts that need 3.3 V than the Pico's 3V3 pin has room for: it uses the breadboard rails." : o.help} disabled={busy || (railsOnly && o.mode === "direct")} onClick={() => void setPower(o.mode)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
