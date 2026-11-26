// BreadPilot behaviour simulator: what a run records, and reading its errors. No Node imports, so
// the page (the Code tab's preview, M8 8.C3) uses it too.

/** What inputs read over virtual time: [[t_us, value], ...] per GPIO (0/1) and per ADC channel (volts). */
export interface SimInputs {
  pins?: Record<number, [number, number][]>;
  adc?: Record<number, [number, number][]>;
}

/**
 * What the parts do over virtual time, in the circuit's own terms: [[t_us, value], ...] per switch
 * ("BTN1", or one contact "SW1#1"; 1 = closed), per knob (position 0-1 from end2 to end1), and per
 * sensor (an LDR's lux, an NTC's °C, a module's 1 = triggered / 0, or an analog module's 0-1).
 */
export interface Scenario {
  switches?: Record<string, [number, number][]>;
  pots?: Record<string, [number, number][]>;
  sensors?: Record<string, [number, number][]>;
}

/** One trace entry: virtual time in µs, what happened, and up to three values. */
export interface SimEvent {
  t: number;
  kind: string;
  a?: unknown;
  b?: unknown;
  c?: unknown;
}

export interface SimError {
  type: string;
  message: string;
  /** The line in main.py where it happened (the innermost main.py line of the traceback). */
  line?: number;
  /** The innermost file and line, when it happened inside a driver. */
  at?: { file: string; line: number };
  traceback: string;
}

/** The simulator's own Python modules (the networking stand-ins are in py/frozen). */
export const PY_FILES = ["_bpsim.py", "_bptime.py", "machine.py", "_onewire.py"];

/**
 * The simulator's own files stand for C code in the firmware (machine, time) or for modules it only
 * imitates (the networking stand-ins), so an error is never reported as happening inside them; the
 * firmware's real Python modules (dht.py) and the project's drivers are reported.
 */
const SIMULATOR_FILES = new Set([...PY_FILES, "network.py", "socket.py", "ssl.py", "ntptime.py", "requests.py", "urequests.py", "mip.py", "webrepl.py", "<stdin>"]);

/** The error's main.py line and innermost file/line, from MicroPython's traceback text. */
export function parseTraceback(type: string, message: string, traceback: string): SimError {
  const frames = [...traceback.matchAll(/File "([^"]+)", line (\d+)/g)]
    .map((m) => ({ file: m[1]!.replace(/^\/+/, ""), line: Number(m[2]) }))
    .filter((f) => !SIMULATOR_FILES.has(f.file));
  const main = frames.filter((f) => f.file === "main.py").at(-1);
  const inner = frames.at(-1);
  return { type, message, traceback, ...(main ? { line: main.line } : {}), ...(inner && inner.file !== "main.py" ? { at: inner } : {}) };
}

/** How a run ended, from its events: the last "end" or "error" event (finished when there is none). */
export function endOf(events: SimEvent[]): { ended: string; error?: SimError } {
  const end = [...events].reverse().find((e) => e.kind === "end" || e.kind === "error");
  if (end?.kind === "error") return { ended: "error", error: parseTraceback(String(end.a), String(end.b), String(end.c)) };
  return { ended: String(end?.a ?? "finished") };
}
