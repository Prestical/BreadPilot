// MicroPython driver files the Pico needs next to main.py for some parts. Each lives in its part
// pack (parts/<id>/driver/*.py, named in pack.json) and reaches the web app and the API through
// parts.generated.ts.
import { PACKS } from "./packs";

export interface DriverFile {
  /** File name to save on the Pico, e.g. "sh1106.py". */
  file: string;
  /** Python module name used in `import`. */
  module: string;
  source: string;
}

export function driversFor(componentIds: Iterable<string>): DriverFile[] {
  const ids = new Set(componentIds);
  const files = new Map(PACKS.filter((p) => p.driver && ids.has(p.meta.id)).map((p) => [p.driver!.file, p.driver!]));
  return [...files.keys()].sort().map((file) => files.get(file)!);
}
