// The safety gate for wiring the layout engine made (M18 18.2). The engine is meant to make
// circuits with no issues at all (circuit-core's layout property test), so here a warning stops
// the build like an error does: a warning (a motor straight on a GPIO, too much load on 3V3) is
// never proof that a circuit is safe. Wiring a person made (imports, sandbox mode later) is
// checked elsewhere and shows its warnings instead of hiding them.
import { validateBuild, type Build } from "@breadpilot/circuit-core";

/** Throws when `build` has any validator issue; `what` names the layout in the message. */
export function assertEngineBuild(build: Build, what: string): void {
  const report = validateBuild(build);
  const first = report.issues[0]; // errors come first
  if (!first) return;
  const kind = first.severity === "error" ? "failed validation" : "has a warning the layout engine should never cause";
  throw new Error(`Internal error: the ${what} ${kind} (${first.code}: ${first.message}).`);
}
