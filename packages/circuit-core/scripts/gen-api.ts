// Reads MicroPython v1.29.0's own source files (docs/software/micropython-v1.29.0/) and writes
// src/micropython-api.generated.json (in circuit-core): what the Pico 2 W firmware's `machine` classes and `time`
// module really have. The simulator's fake modules offer exactly these names, so code that calls a
// method the Pico doesn't have (PWM.duty(), ADC.read()) fails in the simulator as it does on the board,
// and the code checker (C020) flags such calls without running anything.
//
// Build switches inside the tables (#if FLAG) are decided from the rp2 port's mpconfigport.h; a
// flag defined nowhere is 0, as in C. Board facts the switches need are listed in BOARD with sources.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DOCS = fileURLToPath(new URL("../../../docs/software/micropython-v1.29.0/", import.meta.url));
export const API_FILE = fileURLToPath(new URL("../src/micropython-api.generated.json", import.meta.url));

/** Facts about the chip that the source's switches ask for. */
const BOARD: Record<string, { value: number; src: string }> = {
  PICO_RP2350: { value: 1, src: "the Pico 2 W's chip is the RP2350 (pico-2-w-datasheet.pdf)" },
  NUM_PIOS: { value: 3, src: "rp2350-datasheet.pdf PDF page 18: GPIO functions PIO0, PIO1 and PIO2" },
};

interface Table {
  /** Saved file name in docs/software/micropython-v1.29.0/. */
  file: string;
  /** The C array holding the names. */
  table: string;
}

const CLASSES: Record<string, { tables: Table[]; args: Record<string, Table & { fn: string }> }> = {
  Pin: {
    tables: [{ file: "ports__rp2__machine_pin.c", table: "machine_pin_locals_dict_table" }],
    args: {
      init: { file: "ports__rp2__machine_pin.c", table: "", fn: "machine_pin_obj_init_helper" },
      irq: { file: "ports__rp2__machine_pin.c", table: "", fn: "machine_pin_irq" },
    },
  },
  PWM: {
    tables: [{ file: "extmod__machine_pwm.c", table: "machine_pwm_locals_dict_table" }],
    args: { init: { file: "ports__rp2__machine_pwm.c", table: "", fn: "mp_machine_pwm_init_helper" } },
  },
  ADC: {
    tables: [{ file: "extmod__machine_adc.c", table: "machine_adc_locals_dict_table" }],
    args: {},
  },
  I2C: {
    tables: [{ file: "extmod__machine_i2c.c", table: "machine_i2c_locals_dict_table" }],
    args: { constructor: { file: "ports__rp2__machine_i2c.c", table: "", fn: "machine_i2c_make_new" } },
  },
  Timer: {
    tables: [{ file: "ports__rp2__machine_timer.c", table: "machine_timer_locals_dict_table" }],
    args: { init: { file: "ports__rp2__machine_timer.c", table: "", fn: "machine_timer_init_helper" } },
  },
};
const MODULES: Record<string, Table & { extra?: { macro: string; file: string } }> = {
  machine: { file: "extmod__modmachine.c", table: "machine_module_globals_table", extra: { macro: "MICROPY_PY_MACHINE_EXTRA_GLOBALS", file: "ports__rp2__modmachine.c" } },
  time: { file: "extmod__modtime.c", table: "mp_module_time_globals_table" },
};

const read = (file: string) => readFileSync(DOCS + file, "utf8");

/**
 * The build flags: `#define NAME (value)` in the rp2 port's settings, then py/mpconfig.h's defaults
 * for the ones it leaves unset (`#ifndef NAME` / `#define NAME (value or OTHER_FLAG)`). Flags set
 * nowhere stay undefined, which counts as 0 in an #if.
 */
function portFlags(): Record<string, number> {
  const flags: Record<string, number> = {};
  for (const m of read("mpconfigport.h").matchAll(/^#define\s+(MICROPY_\w+)\s+\(?(\d+)\)?/gm)) flags[m[1]!] = Number(m[2]);
  for (const [k, v] of Object.entries(BOARD)) flags[k] = v.value;
  const defaults = [...read("py__mpconfig.h").matchAll(/^#ifndef\s+(MICROPY_\w+)\s*\n#define\s+\1\s+\(?\s*(\w+)\s*\)?\s*$/gm)];
  for (let pass = 0; pass < 4; pass++) {
    for (const m of defaults) {
      const [, name, value] = m as unknown as [string, string, string];
      if (name in flags) continue;
      if (/^\d+$/.test(value)) flags[name] = Number(value);
      else if (value in flags) flags[name] = flags[value]!;
    }
  }
  return flags;
}

/** Macros the port defines in its .c files (not numeric flags), for #ifdef. */
const DEFINED_ELSEWHERE = new Set(["MICROPY_PY_MACHINE_EXTRA_GLOBALS"]);

/** One `#if` condition: NAME, NAME >= n, defined(NAME); undefined names are 0 (C rules). */
function holds(cond: string, flags: Record<string, number>, kind: string): boolean {
  const c = cond.trim();
  if (kind === "ifdef") return c in flags || DEFINED_ELSEWHERE.has(c);
  if (kind === "ifndef") return !(c in flags);
  const cmp = /^(\w+)\s*(>=|<=|==|>|<)\s*(\d+)$/.exec(c);
  if (cmp) {
    const v = flags[cmp[1]!] ?? 0;
    const n = Number(cmp[3]);
    return { ">=": v >= n, "<=": v <= n, "==": v === n, ">": v > n, "<": v < n }[cmp[2] as ">="]!;
  }
  if (/^\w+$/.test(c)) return (flags[c] ?? 0) !== 0;
  throw new Error(`gen-api: can't decide "#${kind} ${c}"; add a rule for it`);
}

/** Names in a C table, with its #if switches decided; also the names left out and why. */
function tableNames(t: Table, flags: Record<string, number>, extra?: { macro: string; file: string }): { names: string[]; left: { name: string; because: string }[] } {
  const src = read(t.file);
  const start = src.indexOf(`${t.table}[] = {`);
  if (start < 0) throw new Error(`gen-api: ${t.table} not found in ${t.file}`);
  const body = src.slice(start, src.indexOf("\n};", start));
  const names: string[] = [];
  const left: { name: string; because: string }[] = [];
  const stack: { on: boolean; cond: string }[] = [];
  const active = () => stack.every((s) => s.on);
  for (const raw of body.split("\n").slice(1)) {
    const line = raw.trim();
    const pp = /^#\s*(if|ifdef|ifndef|elif|else|endif)\b\s*(.*)$/.exec(line);
    if (pp) {
      const [, kind, cond] = pp;
      if (kind === "if" || kind === "ifdef" || kind === "ifndef") stack.push({ on: holds(cond!, flags, kind), cond: `${kind} ${cond}` });
      else if (kind === "else") stack[stack.length - 1]!.on = !stack[stack.length - 1]!.on;
      else if (kind === "endif") stack.pop();
      else throw new Error(`gen-api: #elif in ${t.table} needs a rule`);
      continue;
    }
    // A macro the port defines to add entries (rp2's ADC constants, machine's Pin/RTC/Timer).
    if (extra && line === extra.macro) {
      if (active()) {
        for (const m of read(extra.file).matchAll(new RegExp(`#define ${extra.macro}[\\s\\S]*?\\n\\n`, "g"))) {
          for (const q of m[0].matchAll(/MP_QSTR_(\w+)/g)) names.push(q[1]!);
        }
      }
      continue;
    }
    const m = /MP_QSTR_(\w+)\)/.exec(line);
    if (!m || line.startsWith("//")) continue;
    if (active()) names.push(m[1]!);
    else left.push({ name: m[1]!, because: stack.filter((s) => !s.on).map((s) => `#${s.cond}`).join(", ") });
  }
  return { names: [...new Set(names)], left };
}

/**
 * Keyword names of a function's `allowed_args[]`: the list inside the function's own body, else the
 * one written at file level right above it (rp2's Pin keeps its list above machine_pin_obj_init_helper).
 */
function argNames(t: Table & { fn: string }): string[] {
  const src = read(t.file);
  // The definition: the name followed by its parameter list and the opening brace.
  const def = new RegExp(`\\b${t.fn}\\s*\\([^;{]*\\)\\s*\\{`).exec(src);
  if (!def) throw new Error(`gen-api: ${t.fn} not found in ${t.file}`);
  const bodyStart = def.index + def[0].length;
  const bodyEnd = src.indexOf("\n}", bodyStart);
  const inside = src.indexOf("allowed_args[] = {", bodyStart);
  const from = inside >= 0 && inside < bodyEnd ? inside : src.lastIndexOf("allowed_args[] = {", def.index);
  if (from < 0) throw new Error(`gen-api: no allowed_args for ${t.fn} in ${t.file}`);
  const block = src.slice(from, src.indexOf("};", from));
  return [...new Set([...block.matchAll(/MP_QSTR_(\w+)/g)].map((m) => m[1]!))];
}

export function buildApi() {
  const flags = portFlags();
  const classes: Record<string, unknown> = {};
  for (const [name, c] of Object.entries(CLASSES)) {
    const members: string[] = [];
    const left: { name: string; because: string }[] = [];
    for (const t of c.tables) {
      const r = tableNames(t, flags, name === "ADC" ? { macro: "MICROPY_PY_MACHINE_ADC_CLASS_CONSTANTS", file: "ports__rp2__machine_adc.c" } : undefined);
      members.push(...r.names);
      left.push(...r.left);
    }
    classes[name] = {
      methods: members.filter((n) => /^[a-z_]/.test(n)),
      constants: members.filter((n) => /^[A-Z]/.test(n)),
      notOnThePico: left,
      args: Object.fromEntries(Object.entries(c.args).map(([k, t]) => [k, argNames(t)])),
      from: c.tables.map((t) => t.file),
    };
  }
  const modules: Record<string, unknown> = {};
  for (const [name, t] of Object.entries(MODULES)) {
    const r = tableNames(t, flags, t.extra);
    modules[name] = { names: r.names.filter((n) => n !== "__name__"), notOnThePico: r.left, from: [t.file, ...(t.extra ? [t.extra.file] : [])] };
  }
  return {
    $comment: "Generated by packages/circuit-core/scripts/gen-api.ts from docs/software/micropython-v1.29.0/ (do not edit). What the Pico 2 W firmware's machine classes and time module have.",
    micropython: "1.29.0",
    port: "rp2 (RPI_PICO2_W)",
    board: BOARD,
    classes,
    modules,
  };
}

export const apiText = () => JSON.stringify(buildApi(), null, 2) + "\n";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(API_FILE, apiText());
  console.log(`wrote ${API_FILE}`);
}
