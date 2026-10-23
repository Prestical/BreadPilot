// MicroPython cross-check: generated code must use exactly the
// GPIOs of the validated build, in the right modes. This is a static check of the
// source text (no Python runtime needed), tuned for beginner-style MicroPython:
//   Pin(16, Pin.OUT) · Pin(17, Pin.IN, Pin.PULL_UP) · ADC(26) / ADC(Pin(26)) / ADC(0)
//   PWM(Pin(16)) · LED_PIN = 16 ... Pin(LED_PIN, Pin.OUT) · PINS = [16, 17] / for p in (16, 17): Pin(p, ...)
// It also catches the crashes small models cause most: names used without importing them,
// a block header without ":", and a block that isn't indented.
// It can't check behavior (e.g. inverted button logic); that needs a simulator (Milestone 7).

import { PACKS, type CodeRules } from "./packs";
import type { Board, Build, GpioMode } from "./types";

export interface CodeIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  line?: number;
}

export interface CodeCheckReport {
  ok: boolean;
  issues: CodeIssue[];
  /** GPIOs the code uses, e.g. { GP16: "out" } ("unknown" when the mode isn't visible). */
  used: Record<string, string>;
}

interface Call {
  fn: "Pin" | "ADC" | "PWM" | "I2C" | "SoftI2C";
  args: string;
  line: number;
  /** Index range in the source, used to skip Pin(...) nested inside ADC(...)/PWM(...). */
  start: number;
  end: number;
}

/**
 * Blanks comments and string contents with spaces (quotes and newlines kept) so brackets and
 * keywords inside them don't count. The output has exactly the same length as the input, so
 * positions found in it can be used to read the original source.
 */
export function stripStringsAndComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "#") {
      while (i < src.length && src[i] !== "\n") {
        out += " ";
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      const triple = src.slice(i, i + 3) === c.repeat(3);
      const q = triple ? c.repeat(3) : c;
      out += q;
      i += q.length;
      while (i < src.length && src.slice(i, i + q.length) !== q) {
        if (!triple && src[i] === "\n") break; // unterminated: let the quote check report it
        if (src[i] === "\\" && i + 1 < src.length && src[i + 1] !== "\n") {
          out += "  "; // escape sequence, e.g. \" or \n
          i += 2;
          continue;
        }
        out += src[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (src.slice(i, i + q.length) === q) {
        out += q;
        i += q.length;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const lineOf = (src: string, index: number) => src.slice(0, index).split("\n").length;

function findCalls(clean: string): Call[] {
  const calls: Call[] = [];
  const re = /\b(Pin|ADC|PWM|SoftI2C|I2C)\s*\(/g;
  for (let m = re.exec(clean); m; m = re.exec(clean)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    let end = open;
    for (; end < clean.length; end++) {
      if (clean[end] === "(") depth++;
      else if (clean[end] === ")" && --depth === 0) break;
    }
    calls.push({ fn: m[1] as Call["fn"], args: clean.slice(open + 1, end), line: lineOf(clean, m.index), start: m.index, end });
  }
  return calls;
}

/** What a Pin(...) or .init(...) call sets a pin to. "none": no mode given (the pin keeps its mode). */
type Wanted = "none" | "out" | "in" | "in_pullup" | "in_pulldown" | "other" | "unclear";

/** rp2 values: Pin.IN = 0, Pin.OUT = 1, Pin.OPEN_DRAIN = 2, Pin.ALT = 3; PULL_UP = 1, PULL_DOWN = 2. */
const MODE_TOKENS: [RegExp, "out" | "in" | "other"][] = [
  [/^(?:machine\.)?Pin\.OUT$|^1$/, "out"],
  [/^(?:machine\.)?Pin\.IN$|^0$/, "in"],
  [/^(?:machine\.)?Pin\.(?:OPEN_DRAIN|ALT\w*)$|^[23]$/, "other"],
];

/**
 * The mode the arguments ask for. `modeIndex` is the position of the mode argument: 1 in
 * Pin(id, mode, pull), 0 in pin.init(mode, pull). A mode or pull that isn't one of the named
 * constants (or their numbers) is "unclear": the checker can't confirm it matches the wiring.
 */
export function wantedMode(args: string[], modeIndex: number): Wanted {
  const kw = (name: string) => args.find((a) => new RegExp(`^${name}\\s*=`).test(a))?.replace(/^\w+\s*=\s*/, "").trim();
  const positional = args.filter((a) => !/^\w+\s*=/.test(a));
  const mode = (kw("mode") ?? positional[modeIndex])?.trim();
  if (mode === undefined) return "none";
  const kind = MODE_TOKENS.find(([re]) => re.test(mode))?.[1];
  if (!kind) return "unclear";
  if (kind !== "in") return kind;
  const pull = (kw("pull") ?? positional[modeIndex + 1])?.trim();
  if (!pull || pull === "None") return "in";
  if (/^(?:machine\.)?Pin\.PULL_UP$|^1$/.test(pull)) return "in_pullup";
  if (/^(?:machine\.)?Pin\.PULL_DOWN$|^2$/.test(pull)) return "in_pulldown";
  return "unclear";
}

/** Does the wanted mode fit how the pin is wired? ("none" always fits: nothing changes.) */
const modeFits = (wants: Wanted, wired: string) => wants === "none" || (wants === "out" ? wired === "out" || wired === "pwm" : wants === wired);

/**
 * C014: other names for machine's pin classes (`from machine import Pin as P`, `import machine
 * as m`, `P = Pin`): the checker finds pin setups by name, so a renamed class would hide them.
 */
function aliasIssues(clean: string): CodeIssue[] {
  const issues: CodeIssue[] = [];
  const add = (index: number, what: string) => {
    const line = lineOf(clean, index);
    issues.push({ code: "C014", severity: "error", message: `Line ${line} ${what}, so the checker can't see which pins it sets up. Write "from machine import Pin" and use Pin(...) by that name.`, line });
  };
  for (const m of clean.matchAll(/^\s*from\s+machine\s+import\s+([^\n]+)/gm)) {
    if (/\b(Pin|ADC|PWM|I2C|SoftI2C|Signal)\s+as\s+\w+/.test(m[1]!)) add(m.index!, "imports a machine class under another name");
  }
  for (const m of clean.matchAll(/^\s*import\s+machine\s+as\s+\w+/gm)) add(m.index!, "imports machine under another name");
  for (const m of clean.matchAll(/^\s*\w+\s*=\s*(?:machine\.)?(Pin|ADC|PWM|I2C|SoftI2C|Signal)\s*$/gm)) add(m.index!, `gives ${m[1]} another name`);
  return issues;
}

function syntaxIssues(src: string, clean: string): CodeIssue[] {
  const issues: CodeIssue[] = [];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: { ch: string; line: number }[] = [];
  clean.split("\n").forEach((text, li) => {
    for (const ch of text) {
      if ("([{".includes(ch)) stack.push({ ch, line: li + 1 });
      else if (ch in pairs) {
        if (stack.at(-1)?.ch !== pairs[ch]) issues.push({ code: "C001", severity: "error", message: `Unmatched "${ch}" on line ${li + 1}.`, line: li + 1 });
        else stack.pop();
      }
    }
  });
  for (const s of stack) issues.push({ code: "C001", severity: "error", message: `"${s.ch}" opened on line ${s.line} is never closed.`, line: s.line });
  // An odd number of quote characters on a line means an unterminated string.
  clean.split("\n").forEach((text, li) => {
    const quotes = (text.replace(/"""|'''/g, "").match(/["']/g) ?? []).length;
    if (quotes % 2) issues.push({ code: "C001", severity: "error", message: `Unterminated string on line ${li + 1}.`, line: li + 1 });
  });
  // Block headers (if/for/while/def/...) need ":" and an indented body. A header may continue on
  // the next lines (open bracket or trailing backslash), so it is read as one logical line.
  const lines = clean.split("\n");
  const indentOf = (l: string) => /^[ \t]*/.exec(l)![0].replace(/\t/g, "    ").length;
  const depthAfter = (text: string, start: number) => {
    let d = start;
    for (const ch of text) d += "([{".includes(ch) ? 1 : ")]}".includes(ch) ? -1 : 0;
    return Math.max(0, d);
  };
  let depth = 0; // bracket depth at the start of each physical line
  for (let li = 0; li < lines.length; li++) {
    const text = lines[li]!;
    const startDepth = depth;
    depth = depthAfter(text, depth);
    const continued = li > 0 && /\\\s*$/.test(lines[li - 1]!);
    if (startDepth > 0 || continued) continue;
    const m = /^\s*(if|elif|else|for|while|def|try|except|finally|with|class)\b/.exec(text);
    if (!m) continue;
    // Join continuation lines into one logical header.
    let logical = text;
    let last = li;
    let d = depthAfter(text, 0);
    while (last + 1 < lines.length && (d > 0 || /\\\s*$/.test(lines[last]!))) {
      last++;
      logical += " " + lines[last]!.trim();
      d = depthAfter(lines[last]!, d);
    }
    let bracket = 0;
    let colonAt = -1;
    for (let i = 0; i < logical.length; i++) {
      const ch = logical[i]!;
      if ("([{".includes(ch)) bracket++;
      else if (")]}".includes(ch)) bracket--;
      else if (ch === ":" && bracket === 0) {
        colonAt = i;
        break;
      }
    }
    if (colonAt < 0) {
      issues.push({ code: "C001", severity: "error", message: `Line ${li + 1} starts a "${m[1]}" block but doesn't end with ":".`, line: li + 1 });
      continue;
    }
    if (logical.slice(colonAt + 1).trim()) continue; // one-line form: if x: y()
    const next = lines.slice(last + 1).findIndex((l) => l.trim());
    if (next < 0 || indentOf(lines[last + 1 + next]!) <= indentOf(text)) {
      issues.push({ code: "C001", severity: "error", message: `The "${m[1]}" block on line ${li + 1} needs an indented body below it.`, line: li + 1 });
    }
  }

  const indents = src.split("\n").map((l) => /^[ \t]*/.exec(l)![0]);
  if (indents.some((i) => i.includes("\t")) && indents.some((i) => i.includes(" "))) {
    issues.push({ code: "C001", severity: "error", message: "Indentation mixes tabs and spaces; use 4 spaces." });
  }
  return issues;
}

const MACHINE_NAMES = ["Pin", "ADC", "PWM", "Timer", "I2C", "SoftI2C", "SPI", "UART", "RTC", "WDT"];
const MODULES = ["time", "utime", "random", "urandom", "math", "network", "machine", "sys", "rp2", "socket", "urequests", "requests", "bluetooth", "json"];

/**
 * C008: calls that can trap a beginner's board. Code saved as main.py runs at every power-up, so
 * a reset or sleep there can lock the board into a loop (recoverable only with a flash nuke), and
 * file operations can delete their program.
 */
const DANGEROUS: [RegExp, string][] = [
  [/\b(machine\.)?(reset|soft_reset|bootloader)\s*\(/, "resets the board (in main.py this can make it restart forever)"],
  [/\b(machine\.)?(deepsleep|lightsleep)\s*\(/, "puts the board to sleep (it can stop responding to your computer)"],
  [/\bos\.(remove|unlink|rename|rmdir|mkdir|format|mount|umount|VfsFat|VfsLfs2)\b/, "changes files on the board (it could delete your program)"],
  [/\bmachine\.freq\s*\(\s*\d/, "changes the CPU clock speed"],
  [/\b(exec|eval|compile)\s*\(/, "runs code built from text"],
  // Ways around the pin check: each can drive any pin, whatever the wiring (an output against a
  // button shorts that pin to ground when the button is pressed).
  [/\b(getattr|setattr|__import__|globals|locals|vars)\s*\(/, "looks up functions or variables by name, so the checker can't see which pins they use"],
  [/\bmem(8|16|32)\b/, "writes the chip's hardware registers directly, which can drive any pin whatever the wiring"],
  [/\b(StateMachine|asm_pio|PIO|DMA)\b/, "programs the PIO or DMA hardware, which can drive any pin whatever the wiring"],
];

function dangerIssues(clean: string): CodeIssue[] {
  const issues: CodeIssue[] = [];
  for (const [re, why] of DANGEROUS) {
    const idx = clean.search(re);
    if (idx < 0) continue;
    const line = clean.slice(0, idx).split("\n").length;
    issues.push({ code: "C008", severity: "error", message: `Line ${line} ${why}. Beginner projects must not do this; remove it.`, line });
  }
  // C009: a main loop with no sleep keeps the CPU at 100%; not dangerous, but a bad habit.
  if (/^\s*while\s+True\s*:/m.test(clean) && !/\bsleep(_ms|_us)?\s*\(/.test(clean) && !/\b(irq|Timer)\b/.test(clean)) {
    issues.push({ code: "C009", severity: "warning", message: "The while True loop never sleeps; add time.sleep(0.01) so the board isn't busy at 100%." });
  }
  return issues;
}

/**
 * C010: modules available in MicroPython on the Pico 2 W: the built-in modules of the rp2 port
 * (plus their "u" aliases) and the modules frozen into the Pico W firmware. Importing anything
 * else stops the program with ImportError (e.g. "uping", "numpy", "RPi.GPIO").
 * Source: MicroPython library docs for the rp2 port. To be re-checked against the Raspberry Pi
 * Python SDK book when it's added to docs/.
 */
export const PICO_MODULES = new Set([
  // built in
  "array", "asyncio", "binascii", "bluetooth", "builtins", "cmath", "collections", "cryptolib", "deflate", "errno", "framebuf",
  "gc", "hashlib", "heapq", "io", "json", "machine", "math", "micropython", "network", "os", "platform", "random", "re", "rp2",
  "select", "socket", "ssl", "struct", "sys", "time", "uctypes", "_thread",
  // u-prefixed aliases still used in many examples
  "uasyncio", "ubinascii", "ucollections", "uerrno", "uhashlib", "uheapq", "uio", "ujson", "uos", "urandom", "ure", "uselect",
  "usocket", "ussl", "ustruct", "usys", "utime", "uzlib",
  // frozen into the Pico W / Pico 2 W firmware
  "requests", "urequests", "ntptime", "dht", "ds18x20", "onewire", "neopixel", "mip",
]);

function moduleIssues(clean: string, build: Build): CodeIssue[] {
  const types = new Set(build.parts.map((p) => p.type));
  // Driver modules the app ships for parts in the build (saved on the Pico next to main.py).
  const withDriver = PACKS.filter((p) => p.driver);
  const issues: CodeIssue[] = [];
  const lines = clean.split("\n");
  lines.forEach((text, li) => {
    const from = /^\s*from\s+([\w.]+)\s+import\b/.exec(text);
    const plain = /^\s*import\s+(.+)$/.exec(text);
    const names = from ? [from[1]!] : plain ? plain[1]!.split(",").map((x) => x.trim().split(/\s+as\s+/)[0]!.trim()) : [];
    for (const name of names) {
      const root = name.split(".")[0]!;
      if (root && withDriver.some((p) => p.driver!.module === root && types.has(p.meta.id))) continue;
      if (root && !PICO_MODULES.has(root)) {
        const meant = withDriver.find((p) => p.code?.modules && types.has(p.meta.id) && p.code.modules.match.some((m) => root.includes(m)));
        const without = withDriver.find((p) => p.driver!.module === root && p.code?.modules);
        const hint = /ping/.test(root)
          ? " MicroPython has no ping; to check if a computer is reachable, open a TCP connection with the socket module."
          : meant
            ? ` ${meant.code!.modules!.hint}`
            : without
              ? ` ${root} is only available in projects with ${without.code!.modules!.onlyWith}.`
              : "";
        issues.push({ code: "C010", severity: "error", message: `Line ${li + 1} imports "${name}", which isn't part of MicroPython on the Pico 2 W.${hint}`, line: li + 1 });
      }
    }
  });
  return issues;
}

// ---------- C011: names used but never defined ----------

const KEYWORDS = new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "));
const BUILTINS = new Set(
  ("print range len int float str abs min max round sum bool list dict tuple set enumerate zip isinstance issubclass type sorted reversed " +
    "any all map filter ord chr hex oct bin divmod pow hash id iter next open input super object globals locals getattr setattr " +
    "hasattr delattr callable bytes bytearray memoryview staticmethod classmethod property frozenset slice repr format help " +
    "Exception BaseException KeyboardInterrupt ValueError OSError RuntimeError TypeError IndexError KeyError StopIteration " +
    "AttributeError ZeroDivisionError ImportError NameError AssertionError MemoryError OverflowError SyntaxError SystemExit " +
    "GeneratorExit NotImplementedError EOFError IOError UnicodeError LookupError ArithmeticError IndentationError StopAsyncIteration " +
    "Ellipsis NotImplemented __name__ __file__ _").split(" "),
);

/** Identifiers in a target list: "a, (b, c)" → [a, b, c]. Attributes and subscripts aren't definitions. */
const targetNames = (text: string) =>
  text
    .replace(/[()[\]*]/g, " ")
    .split(",")
    .map((x) => x.trim())
    .filter((x) => /^[A-Za-z_]\w*$/.test(x));

/** Positions of every plain "=" at bracket depth 0 (not ==, <=, >=, != or a keyword default). */
function assignPositions(line: string): number[] {
  const at: number[] = [];
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    else if (ch === "=" && depth === 0 && line[i + 1] !== "=" && !"=!<>".includes(line[i - 1] ?? "")) at.push(i);
  }
  return at;
}

function definedNames(clean: string): Set<string> {
  const defined = new Set<string>([...BUILTINS]);
  for (const m of clean.matchAll(/^\s*from\s+[\w.]+\s+import\s+([^\n]+)/gm)) {
    for (const item of m[1]!.replace(/[()]/g, "").split(",")) {
      const [name, alias] = item.trim().split(/\s+as\s+/);
      if (name) defined.add((alias ?? name).trim());
    }
  }
  for (const m of clean.matchAll(/^\s*import\s+([^\n]+)/gm)) {
    for (const item of m[1]!.split(",")) {
      const [name, alias] = item.trim().split(/\s+as\s+/);
      if (name) defined.add((alias ?? name.split(".")[0]!).trim());
    }
  }
  for (const line of clean.split("\n")) {
    // Every segment before the last "=" is a target: "a = b = 0" defines a and b; "x += 1" defines x.
    let from = 0;
    for (const at of assignPositions(line)) {
      targetNames(line.slice(from, at).replace(/[+\-*/%&|^@<>]+$/, "")).forEach((n) => defined.add(n));
      from = at + 1;
    }
  }
  for (const m of clean.matchAll(/\bfor\s+(.+?)\s+in\b/g)) targetNames(m[1]!).forEach((n) => defined.add(n));
  for (const m of clean.matchAll(/\b(?:with|except)\b[^\n:]*?\bas\s+([A-Za-z_]\w*)/g)) defined.add(m[1]!);
  for (const m of clean.matchAll(/\bglobal\s+([\w\s,]+)/g)) targetNames(m[1]!).forEach((n) => defined.add(n));
  for (const m of clean.matchAll(/\b(?:def|class)\s+([A-Za-z_]\w*)\s*(?:\(([^)]*)\))?/g)) {
    defined.add(m[1]!);
    for (const param of (m[2] ?? "").split(",")) {
      const name = param.replace(/^\s*\*{0,2}/, "").split(/[:=]/)[0]!.trim();
      if (/^[A-Za-z_]\w*$/.test(name)) defined.add(name);
    }
  }
  for (const m of clean.matchAll(/\blambda\s*([^:]*):/g)) targetNames(m[1]!.replace(/=[^,]*/g, "")).forEach((n) => defined.add(n));
  return defined;
}

/** Closest defined name, for "did you mean" hints (same prefix, or edit distance ≤ 2). */
function closest(name: string, defined: Set<string>): string | undefined {
  const dist = (a: string, b: string) => {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0]![j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length]![b.length]!;
  };
  const candidates = [...defined].filter((d) => !BUILTINS.has(d) && d.length > 1);
  return candidates.find((d) => d.startsWith(name) || name.startsWith(d)) ?? candidates.find((d) => dist(d.toLowerCase(), name.toLowerCase()) <= 2);
}

function undefinedNameIssues(clean: string): CodeIssue[] {
  if (/^\s*from\s+[\w.]+\s+import\s+\*/m.test(clean)) return []; // can't know what * brings in
  const defined = definedNames(clean);
  const issues: CodeIssue[] = [];
  const seen = new Set<string>();
  for (const m of clean.matchAll(/(?<![\w.])([A-Za-z_]\w*)\b/g)) {
    const name = m[1]!;
    if (KEYWORDS.has(name) || defined.has(name) || seen.has(name)) continue;
    const rest = clean.slice(m.index! + name.length);
    if (/^\s*=(?!=)/.test(rest)) continue; // keyword argument or assignment target
    if (/^["']/.test(rest)) continue; // string prefix: f"..." b"..." r"..."
    const before = clean.slice(Math.max(0, m.index! - 8), m.index!);
    if (/\b(def|class|import|as|from)\s+$/.test(before)) continue;
    seen.add(name);
    const line = clean.slice(0, m.index!).split("\n").length;
    const hint = closest(name, defined);
    issues.push({ code: "C011", severity: "error", message: `Line ${line} uses "${name}", which is never defined (NameError on the Pico).${hint ? ` Did you mean "${hint}"?` : ""}`, line });
  }
  return issues;
}

/** C002: every module and machine class the code uses must be imported, or MicroPython stops with NameError. */
function importIssues(clean: string): CodeIssue[] {
  const imported = new Set<string>();
  for (const m of clean.matchAll(/^\s*from\s+[\w.]+\s+import\s+([^\n]+)/gm)) {
    for (const item of m[1]!.replace(/[()]/g, "").split(",")) {
      const [name, alias] = item.trim().split(/\s+as\s+/);
      if (name) imported.add((alias ?? name).trim());
    }
  }
  for (const m of clean.matchAll(/^\s*import\s+([^\n]+)/gm)) {
    for (const item of m[1]!.split(",")) {
      const [name, alias] = item.trim().split(/\s+as\s+/);
      if (name) imported.add((alias ?? name).trim());
    }
  }
  const issues: CodeIssue[] = [];
  const star = /^\s*from\s+machine\s+import\s+\*/m.test(clean);
  if (star) MACHINE_NAMES.forEach((n) => imported.add(n));
  const firstLine = (re: RegExp) => {
    const idx = clean.search(re);
    return idx < 0 ? undefined : clean.slice(0, idx).split("\n").length;
  };
  for (const name of MACHINE_NAMES) {
    const re = new RegExp(`(?<![\\w.])${name}\\s*[(.]`);
    const line = firstLine(re);
    if (line && !imported.has(name)) {
      issues.push({ code: "C002", severity: "error", message: `Line ${line} uses ${name} but it isn't imported. Add it to: from machine import ...`, line });
    }
  }
  for (const mod of MODULES) {
    const line = firstLine(new RegExp(`(?<![\\w.])${mod}\\.\\w`));
    if (line && !imported.has(mod)) issues.push({ code: "C002", severity: "error", message: `Line ${line} uses ${mod}. but never imports it. Add: import ${mod}`, line });
  }
  return issues;
}

// ---------- tiny integer evaluator for pin expressions ----------

const MAX_VALUES = 64;

/** Splits on a separator at bracket depth 0. */
function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth--;
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((x) => x.trim()).filter((x) => x.length > 0);
}

/** Index of the last top-level binary operator from `ops` (so a - b - c groups left to right). */
function topOperator(text: string, ops: string): number {
  let depth = 0;
  for (let i = text.length - 1; i > 0; i--) {
    const ch = text[i]!;
    if (")]}".includes(ch)) depth++;
    else if ("([{".includes(ch)) depth--;
    else if (depth === 0 && ops.includes(ch) && !/[*+\-(,=]\s*$/.test(text.slice(0, i))) return i;
  }
  return -1;
}

const wrapped = (t: string, open: string, close: string) => {
  if (!t.startsWith(open) || !t.endsWith(close)) return false;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if ("([{".includes(t[i]!)) depth++;
    else if (")]}".includes(t[i]!)) depth--;
    if (depth === 0 && i < t.length - 1) return false;
  }
  return true;
};

/**
 * Every integer value an expression can take, or null when it can't be worked out.
 * Supports: 16 · NAME · [a, b] · (a, b) · {"k": a} · range(a[, b[, s]]) · NAME[i] · a + b · a - b · a * b · (expr).
 */
export function evalInts(text: string, names: Map<string, number[]>): number[] | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\d+$/.test(t)) return [Number(t)];
  if (/^[A-Za-z_]\w*$/.test(t)) return names.get(t) ?? null;
  if (t.startsWith("-") && topOperator(t, "+-*") < 0) {
    const v = evalInts(t.slice(1), names);
    return v ? v.map((x) => -x) : null;
  }
  for (const ops of ["+-", "*"]) {
    const at = topOperator(t, ops);
    if (at < 0) continue;
    const left = evalInts(t.slice(0, at), names);
    const right = evalInts(t.slice(at + 1), names);
    if (!left || !right) return null;
    const out: number[] = [];
    for (const l of left) for (const r of right) out.push(t[at] === "+" ? l + r : t[at] === "-" ? l - r : l * r);
    return out.length <= MAX_VALUES ? [...new Set(out)] : null;
  }
  if (wrapped(t, "(", ")") || wrapped(t, "[", "]")) {
    const inner = t.slice(1, -1);
    const items = splitTop(inner, ",");
    if (items.length === 1 && t.startsWith("(") && !inner.trim().endsWith(",")) return evalInts(items[0]!, names);
    const all: number[] = [];
    for (const item of items) {
      const v = evalInts(item, names);
      if (!v) return null;
      all.push(...v);
    }
    return all.length ? all : null;
  }
  if (wrapped(t, "{", "}")) {
    const all: number[] = [];
    for (const item of splitTop(t.slice(1, -1), ",")) {
      const v = evalInts(item.slice(item.indexOf(":") + 1), names);
      if (!v || !item.includes(":")) return null;
      all.push(...v);
    }
    return all.length ? all : null;
  }
  const range = /^range\s*\((.*)\)$/.exec(t);
  if (range) {
    const args = splitTop(range[1]!, ",").map((x) => evalInts(x, names));
    if (args.some((x) => !x || x.length !== 1)) return null;
    const [a, b, step] = args.map((x) => x![0]!) as [number, number?, number?];
    const [from, to, by] = b === undefined ? [0, a, 1] : [a, b, step ?? 1];
    if (by === 0) return null;
    const out: number[] = [];
    for (let v = from; by > 0 ? v < to : v > to; v += by) if (out.push(v) > MAX_VALUES) return null;
    return out;
  }
  const index = /^([A-Za-z_]\w*)\s*\[(.+)\]$/.exec(t);
  if (index && names.has(index[1]!)) {
    const list = names.get(index[1]!)!;
    const i = /^\d+$/.test(index[2]!.trim()) ? Number(index[2]) : null;
    return i !== null && list[i] !== undefined ? [list[i]!] : list;
  }
  return null;
}

const BASE_MODE_TEXT: Record<string, string> = { out: "an output", pwm: "a PWM output", in: "an input", in_pullup: "an input with pull-up", in_pulldown: "an input with pull-down", adc: "an analog input (ADC)" };

function modeText(mode: string): string {
  const i2c = /^i2c(\d)_(sda|scl)$/.exec(mode);
  if (i2c) return `the I2C${i2c[1]} ${i2c[2] === "sda" ? "data line (SDA)" : "clock line (SCL)"}`;
  return BASE_MODE_TEXT[mode] ?? mode;
}

/** The I2C setup line for a wired SDA/SCL pair, e.g. `I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)`. */
export function i2cSetup(modes: Record<string, string>, bus: string): string | null {
  const sda = Object.entries(modes).find(([, m]) => m === `i2c${bus}_sda`)?.[0];
  const scl = Object.entries(modes).find(([, m]) => m === `i2c${bus}_scl`)?.[0];
  return sda && scl ? `I2C(${bus}, sda=Pin(${sda.slice(2)}), scl=Pin(${scl.slice(2)}), freq=400000)` : null;
}

/** The exact MicroPython for a wired pin, so repair messages say what to write, not just what's wrong. */
export function constructorFor(gpio: number, mode: string, modes: Record<string, string> = {}): string {
  const i2c = /^i2c(\d)_/.exec(mode);
  if (i2c) return i2cSetup(modes, i2c[1]!) ?? `I2C(${i2c[1]}, sda=Pin(..), scl=Pin(..), freq=400000)`;
  switch (mode) {
    case "out":
    case "pwm":
      return `Pin(${gpio}, Pin.OUT) (on/off) or PWM(Pin(${gpio})) (brightness)`;
    case "in_pullup":
      return `Pin(${gpio}, Pin.IN, Pin.PULL_UP) (reads 0 while the button is pressed)`;
    case "in_pulldown":
      return `Pin(${gpio}, Pin.IN, Pin.PULL_DOWN)`;
    case "in":
      return `Pin(${gpio}, Pin.IN)`;
    case "adc":
      return `ADC(${gpio}) and read it with .read_u16() (0-65535); a Pin object has no read_u16()`;
    default:
      return `Pin(${gpio})`;
  }
}

/** Splits call arguments at top-level commas: "0, sda=Pin(16), scl=Pin(17)" → 3 items. */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of args) {
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

type Display = NonNullable<CodeRules["display"]> & { driver: string };

/** Framebuf displays in the build (from their packs' code.json), in pack order. */
function displaysIn(build: Build): Display[] {
  const types = new Set(build.parts.map((p) => p.type));
  return PACKS.filter((p) => p.code?.display && types.has(p.meta.id)).map((p) => ({ ...p.code!.display!, driver: p.driver!.module }));
}

/**
 * C012: a display in the build must be set up in the code with the shipped driver, e.g.
 * `oled = SH1106_I2C(128, 64, i2c)`. Without it the screen stays dark (the pins alone don't do it).
 */
function displayIssues(clean: string, d: Display, modes: Record<string, string>): CodeIssue[] {
  const issues: CodeIssue[] = [];
  const created = [...clean.matchAll(new RegExp(`\\b${d.class}\\s*\\(([^)]*)\\)`, "g"))];
  const bus = [...new Set(Object.values(modes).flatMap((m) => /^i2c(\d)_/.exec(m)?.[1] ?? []))][0] ?? "0";
  if (!created.length) {
    issues.push({
      code: "C012",
      severity: "error",
      message: `The build has ${d.title}, but the code never sets it up. Write: from ${d.driver} import ${d.class} · i2c = ${i2cSetup(modes, bus) ?? "I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)"} · ${d.var} = ${d.class}(${d.width}, ${d.height}, i2c) · then ${d.var}.text("Hi", 0, 0) and ${d.var}.show().`,
    });
    return issues;
  }
  for (const m of created) {
    const [w, h] = splitArgs(m[1]!);
    if (w !== String(d.width) || h !== String(d.height)) {
      issues.push({ code: "C012", severity: "error", message: `Line ${lineOf(clean, m.index!)} creates the display with size ${w ?? "?"} x ${h ?? "?"}; this screen is ${d.width} x ${d.height}: ${d.class}(${d.width}, ${d.height}, i2c).`, line: lineOf(clean, m.index!) });
    }
  }
  if (!/\.show\s*\(\s*\)/.test(clean)) {
    issues.push({ code: "C012", severity: "error", message: `The code draws on the display but never calls ${d.var}.show(), so nothing appears on the screen. Call show() after drawing.` });
  }
  return issues;
}

/**
 * C013: text on a framebuf display (e.g. the OLED). framebuf's built-in 8x8 font only has ASCII (other characters show as
 * blanks or garbage), the last text row is y = 56, and a row holds 16 characters. Errors for what
 * can never work (non-ASCII text, a fixed y below the screen); warnings for what may be cut off.
 */
function displayTextIssues(src: string, clean: string, screen: Display): CodeIssue[] {
  const LAST_ROW_Y = screen.height - screen.font;
  const issues: CodeIssue[] = [];
  const nonAscii = (text: string) => [...new Set([...text].filter((c) => c.charCodeAt(0) > 126))].join(" ");
  const assignments = new Map<string, { line: number; text: string }[]>();
  src.split("\n").forEach((text, i) => {
    const m = /^\s*([A-Za-z_]\w*)\s*[+]?=/.exec(text);
    if (m) assignments.set(m[1]!, [...(assignments.get(m[1]!) ?? []), { line: i + 1, text }]);
  });

  // y positions written as "A + B * i" (directly or through a variable like y = 8 + i * 10).
  const linearVars = new Map<string, string>();
  const constants = new Map<string, number>();
  for (const a of clean.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*([^=\n].*?)\s*$/gm)) {
    linearVars.set(a[1]!, a[2]!);
    if (/^\d+$/.test(a[2]!)) constants.set(a[1]!, Number(a[2]));
  }
  const drawRows: { line: number; A: number; B: number; v: string }[] = [];

  for (const m of clean.matchAll(/\.text\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    let depth = 0;
    let end = open;
    for (; end < clean.length; end++) {
      if (clean[end] === "(") depth++;
      else if (clean[end] === ")" && --depth === 0) break;
    }
    const line = lineOf(clean, m.index!);
    const rawArgs = src.slice(open + 1, end);
    const args = splitArgs(clean.slice(open + 1, end));

    // Characters the font doesn't have, in the text itself or in a variable it's built from.
    const direct = nonAscii(rawArgs);
    if (direct) {
      issues.push({ code: "C013", severity: "error", message: `Line ${line} draws "${direct}" on the display, but its ${screen.font}x${screen.font} font only has plain ASCII (letters, digits, punctuation), so it shows as blanks or garbage. Use "|", "#" or ${screen.var}.fill_rect() instead.`, line });
    } else {
      const names = new Set(rawArgs.match(/[A-Za-z_]\w*/g) ?? []);
      for (const name of names) {
        const bad = (assignments.get(name) ?? []).find((a) => nonAscii(a.text));
        if (bad) {
          issues.push({ code: "C013", severity: "error", message: `Line ${line} draws ${name} on the display, and line ${bad.line} builds it with "${nonAscii(bad.text)}", which the ${screen.font}x${screen.font} font doesn't have (plain ASCII only). Use "|", "#" or ${screen.var}.fill_rect() instead.`, line });
          break;
        }
      }
    }

    // Position: text(string, x, y)
    const [textArg, xArg, yArg] = args;
    const x = xArg && /^\d+$/.test(xArg) ? Number(xArg) : null;
    const y = yArg?.trim();
    if (y && /^\d+$/.test(y) && Number(y) > LAST_ROW_Y) {
      issues.push({ code: "C013", severity: "error", message: `Line ${line} draws text at y = ${y}, below the screen: it's ${screen.height} pixels tall and letters are ${screen.font} high, so the last row is y = ${LAST_ROW_Y}.`, line });
    }
    if (y && !/^\d+$/.test(y)) {
      const lin = linear(y, linearVars);
      if (lin?.v) drawRows.push({ line, ...lin, v: lin.v });
      else if (lin && lin.A > LAST_ROW_Y) issues.push({ code: "C013", severity: "error", message: `Line ${line} draws text at y = ${lin.A}, below the screen: the last text row is y = ${LAST_ROW_Y}.`, line });
    }
    // Length of a literal string: 16 characters per row from x = 0.
    // Only a single plain string literal ("Hello"), not an expression like "A" if x else "B".
    const literal = textArg ? /^[rRbB]?(["'])([^"'\\\n]*)\1$/.exec(src.slice(open + 1, end).split(",")[0]!.trim()) : null;
    if (literal && x !== null) {
      const fits = Math.max(0, Math.floor((screen.width - x) / screen.font));
      if (literal[2]!.length > fits) {
        issues.push({ code: "C013", severity: "warning", message: `Line ${line}: "${literal[2]}" is ${literal[2]!.length} characters, but only ${fits} fit from x = ${x} (each letter is 8 pixels wide). Shorten it or split it over two rows.`, line });
      }
    }
  }
  issues.push(...rowLayoutIssues(drawRows, src, constants, screen));
  return issues;
}

/** "8 + (i * 10)", "i*8", "y + 16" with y = 8 + i * 10 → { A: 8, B: 10, v: "i" }; null if not linear. */
function linear(expr: string, vars: Map<string, string>, depth = 0): { A: number; B: number; v?: string } | null {
  if (depth > 3) return null;
  let A = 0;
  let B = 0;
  let v: string | undefined;
  for (const term of expr.replace(/[\s()]/g, "").split("+")) {
    const mul = /^(\d+)\*([A-Za-z_]\w*)$|^([A-Za-z_]\w*)\*(\d+)$/.exec(term);
    if (/^\d+$/.test(term)) A += Number(term);
    else if (mul) {
      const name = mul[2] ?? mul[3]!;
      if (v && v !== name) return null;
      v = name;
      B += Number(mul[1] ?? mul[4]);
    } else if (/^[A-Za-z_]\w*$/.test(term) && vars.has(term)) {
      const inner = linear(vars.get(term)!, vars, depth + 1);
      if (!inner || (inner.v && v && inner.v !== v)) return null;
      A += inner.A;
      B += inner.B;
      v = inner.v ?? v;
    } else return null;
  }
  return v ? { A, B, v } : { A, B };
}

/**
 * Text drawn in a loop, one item per pass: rows must not overlap (each item moves down at least as
 * far as the text it draws) and the last item must stay on the screen (y ≤ 56). The number of
 * items comes from the loop header when it's visible: enumerate(x[:5]), range(5), x[:MAX].
 */
function rowLayoutIssues(rows: { line: number; A: number; B: number; v: string }[], src: string, constants: Map<string, number>, screen: Display): CodeIssue[] {
  const LAST_ROW_Y = screen.height - screen.font;
  const issues: CodeIssue[] = [];
  const lines = src.split("\n");
  const groups = new Map<string, { loop: number; count: number | null; rows: typeof rows }>();
  for (const r of rows) {
    let loop = -1;
    let count: number | null = null;
    for (let k = r.line - 1; k >= 0; k--) {
      const f = new RegExp(`^\\s*for\\s+${r.v}\\s*(?:,\\s*\\w+\\s*)?in\\s+(.+):\\s*(#.*)?$`).exec(lines[k]!);
      if (!f) continue;
      loop = k + 1;
      const n = /\[\s*:\s*(\w+)\s*\]|range\s*\(\s*(?:0\s*,\s*)?(\w+)\s*\)/.exec(f[1]!);
      const raw = n?.[1] ?? n?.[2];
      count = raw === undefined ? null : /^\d+$/.test(raw) ? Number(raw) : (constants.get(raw) ?? null);
      break;
    }
    const key = `${r.v}@${loop}`;
    if (!groups.has(key)) groups.set(key, { loop, count, rows: [] });
    groups.get(key)!.rows.push(r);
  }
  for (const { count, rows: rs } of groups.values()) {
    const B = rs[0]!.B;
    if (B <= 0 || rs.some((r) => r.B !== B)) continue;
    const minA = Math.min(...rs.map((r) => r.A));
    const maxA = Math.max(...rs.map((r) => r.A));
    const span = maxA - minA + screen.font; // pixels of text each item draws
    const line = rs[0]!.line;
    const fit = maxA > LAST_ROW_Y ? 0 : Math.floor((LAST_ROW_Y - maxA) / B) + 1;
    if (B < span) {
      const what = rs.length > 1 ? `Each item draws text from y = ${minA} + ${B}*${rs[0]!.v} to ${maxA} + ${B}*${rs[0]!.v} (${span} pixels)` : `Letters are 8 pixels tall`;
      issues.push({ code: "C013", severity: "error", message: `Line ${line}: text rows overlap. ${what}, but each item moves down only ${B} pixels. Move down at least ${span} pixels per item (8 per text row), or put everything for one item on one row.`, line });
    }
    if (count !== null && maxA + B * (count - 1) > LAST_ROW_Y) {
      issues.push({ code: "C013", severity: "error", message: `Line ${line}: with ${count} items the last one is drawn at y = ${maxA + B * (count - 1)}, below the screen (the last text row is y = ${LAST_ROW_Y}). Only ${fit} fit: show at most ${fit} items, or use fewer rows per item.`, line });
    } else if (count === null && (B % screen.font !== 0 || minA % screen.font !== 0)) {
      issues.push({ code: "C013", severity: "warning", message: `Line ${line} puts text rows at y = ${minA} + ${rs[0]!.v}*${B}. Rows are 8 pixels: use y = 8 * row (0, 8 ... 56). As written, only ${fit} rows fit before the bottom of the screen, so limit the list to ${fit} items.`, line });
    }
  }
  return issues;
}

export function checkMicroPython(src: string, build: Build, board: Board): CodeCheckReport {
  const clean = stripStringsAndComments(src);
  const issues: CodeIssue[] = syntaxIssues(src, clean);
  const used: Record<string, string> = {};
  const err = (code: string, message: string, line?: number) => issues.push({ code, severity: "error", message, ...(line ? { line } : {}) });

  // Names that stand for GPIO numbers. Each name maps to every value it can take, e.g.
  // LED_PIN = 16 · PINS = [16, 17] · PINS = {"red": 16} · for p in range(16, 20) · Pin(16 + i)
  const values = new Map<string, number[]>();
  const evaluate = (text: string) => evalInts(text, values);
  const loopRe = /\bfor\s+(\w+)(?:\s*,\s*(\w+))?\s+in\s+(enumerate\s*\()?\s*(range\s*\([^)]*\)|\[[^\]]*\]|\([^)]*\)|[\w.]+(?:\(\))?)/g;
  // Two passes so names defined from other names resolve (BASE = 16; PINS = [BASE, BASE + 1]).
  for (let pass = 0; pass < 2; pass++) {
    for (const m of clean.matchAll(/^\s*([A-Za-z_]\w*)\s*=\s*([^=\n].*?)\s*$/gm)) {
      const list = evaluate(m[2]!);
      if (list) values.set(m[1]!, list);
    }
    for (const m of clean.matchAll(loopRe)) {
      const [, first, second, enumerate, source] = m;
      const list = evaluate(source!.replace(/\.(values|items)\(\)$/, ""));
      if (!list) continue;
      if (second && (enumerate || /\.items\(\)$/.test(source!))) values.set(second, list); // for i, p in enumerate(PINS) / for k, p in D.items()
      else if (!second) values.set(first!, list);
    }
  }

  const gpioOf = (arg: string): { gpios?: number[]; onboardLed?: boolean; unknown?: string } => {
    const a = arg.trim();
    if (/^["']\s*["']$/.test(a)) return { onboardLed: true }; // string literal: contents were blanked
    const direct = evaluate(a);
    return direct ? { gpios: [...new Set(direct)] } : { unknown: a };
  };
  // Pin("LED") is the on-board LED; strings were blanked, so look at the original text.
  const isLedString = (call: Call) => /^\s*["']LED["']/.test(src.slice(call.start, call.end).replace(/^\w+\s*\(/, ""));

  const header = new Map(board.pins.filter((p) => p.type === "gpio").map((p) => [p.gpio!, p]));
  const modes = build.gpioModes;
  const wired = Object.entries(modes).map(([n, m]) => `${n} (${modeText(m)})`);
  const wiredSummary = wired.length
    ? `Only these pins are wired: ${wired.join(", ")}. The on-board LED is Pin("LED", Pin.OUT).`
    : 'No pins are wired in this build. The Pico 2 W\'s on-board LED is Pin("LED", Pin.OUT); it is not GP25, GP16 or GP2.';
  const record = (gpio: number, mode: string, line: number): string | null => {
    const pin = header.get(gpio);
    if (!pin) {
      const internal = board.internalGpio.find((g) => g.name === `GP${gpio}`);
      err("C003", internal ? `GP${gpio} is used inside the Pico 2 W (${internal.use}); it isn't on any pin.` : `GP${gpio} isn't a GPIO on the Pico 2 W header.`, line);
      return null;
    }
    if (!modes[pin.name]) {
      err("C004", `The code uses ${pin.name} (pin ${pin.phys}), but nothing is wired to it in this build. ${wiredSummary}`, line);
      return null;
    }
    if (used[pin.name] === undefined || used[pin.name] === "unknown") used[pin.name] = mode;
    return pin.name;
  };

  const calls = findCalls(clean);
  /** Variables holding a Pin, e.g. btn = Pin(18, ...), for checking btn.init(...) later. */
  const pinVars = new Map<string, number[]>();
  const nestedIn = (c: Call) => calls.some((o) => o !== c && o.fn !== "Pin" && o.start < c.start && c.end <= o.end);

  // The I2C part's short name for messages (its layout name, e.g. "display").
  const i2cPartName = PACKS.find((p) => build.parts.some((x) => x.type === p.meta.id) && p.part.legs.some((l) => l.kind === "i2c_sda"))?.layout?.name ?? "display";
  // I2C(0, sda=Pin(16), scl=Pin(17), freq=400000) / SoftI2C(sda=..., scl=...): the pins must be
  // the build's SDA/SCL pair, on the bus they're wired for (hardware I2C).
  const checkI2cCall = (call: Call) => {
    const args = splitArgs(call.args);
    const kw = new Map(args.flatMap((a) => {
      const m = /^(\w+)\s*=\s*([\s\S]+)$/.exec(a);
      return m ? [[m[1]!, m[2]!.trim()] as const] : [];
    }));
    const positional = args.filter((a) => !/^\w+\s*=/.test(a));
    const busArg = call.fn === "I2C" ? (kw.get("id") ?? positional[0]) : undefined;
    const bus = busArg !== undefined && /^\d$/.test(busArg.trim()) ? busArg.trim() : undefined;
    const wiredBuses = [...new Set(Object.values(modes).flatMap((m) => /^i2c(\d)_/.exec(m)?.[1] ?? []))];
    const example = i2cSetup(modes, bus ?? wiredBuses[0] ?? "0") ?? "I2C(0, sda=Pin(16), scl=Pin(17), freq=400000)";
    if (!kw.has("sda") || !kw.has("scl")) {
      err("C005", `Line ${call.line} sets up ${call.fn} without both sda= and scl= pins, so it would use other pins than the build. Write ${example}.`, call.line);
      return;
    }
    for (const signal of ["sda", "scl"] as const) {
      const value = kw.get(signal)!;
      const inner = /^(?:machine\.)?Pin\s*\(\s*([^,)]+)/.exec(value);
      const target = gpioOf(inner ? inner[1]! : value);
      if (target.unknown !== undefined) {
        issues.push({ code: "C007", severity: "warning", message: `Can't tell which GPIO "${target.unknown}" is on line ${call.line}.`, line: call.line });
        continue;
      }
      for (const gpio of target.gpios!) {
        const wiredMode = modes[`GP${gpio}`] ?? "";
        const m = /^i2c(\d)_(sda|scl)$/.exec(wiredMode);
        const name = record(gpio, m && m[2] === signal ? wiredMode : `i2c?_${signal}`, call.line);
        if (!name) continue;
        if (!m) err("C005", `${name} is wired as ${modeText(wiredMode)}, but line ${call.line} uses it as I2C ${signal.toUpperCase()}.`, call.line);
        else if (m[2] !== signal) err("C005", `Line ${call.line} uses ${name} as ${signal.toUpperCase()}, but it's wired to the ${i2cPartName}'s ${m[2]!.toUpperCase()}: SDA and SCL are swapped. Write ${i2cSetup(modes, m[1]!)}.`, call.line);
        else if (bus !== undefined && bus !== m[1]) err("C005", `Line ${call.line} uses I2C${bus}, but ${name} is wired on I2C${m[1]}. Write ${i2cSetup(modes, m[1]!)}.`, call.line);
      }
    }
  };

  for (const call of calls) {
    const first = call.args.split(",")[0] ?? "";
    if (call.fn === "Pin") {
      if (isLedString(call)) continue;
      if (nestedIn(call)) continue; // handled by its ADC/PWM call
      // Pin("GP18") also works on the Pico, but only "LED" is allowed by name: a GPIO is written as
      // a number, so the checker can match it to the wiring.
      if (/^\s*["']/.test(first)) {
        err("C003", `Line ${call.line} names a pin with text. Only the on-board LED is used by name, Pin("LED", Pin.OUT); write other pins as numbers, e.g. Pin(18, ...).`, call.line);
        continue;
      }
      const target = gpioOf(first);
      if (target.unknown !== undefined) {
        issues.push({ code: "C007", severity: "warning", message: `Can't tell which GPIO "${target.unknown}" is on line ${call.line}; use a number or a constant like LED_PIN = 16.`, line: call.line });
        continue;
      }
      const w = wantedMode(splitArgs(call.args), 1);
      const wants = w === "none" ? "unknown" : w;
      // `p = Pin(26)` handed to `ADC(p)` later is the ADC's pin argument, not a digital pin.
      // The text before "Pin(" on its line, e.g. "pot = " or "pot = machine.".
      const before = clean.slice(clean.lastIndexOf("\n", call.start) + 1, call.start);
      const assigned = /^\s*([A-Za-z_]\w*)\s*=\s*(?:machine\.)?$/.exec(before);
      const feedsAdc = !!assigned && new RegExp(`\\bADC\\s*\\(\\s*${assigned[1]}\\s*[,)]`).test(clean);
      if (assigned) pinVars.set(assigned[1]!, target.gpios!);
      for (const gpio of target.gpios!) {
        const name = record(gpio, feedsAdc ? "adc" : wants, call.line);
        if (!name || feedsAdc) continue;
        const mode = modes[name]!;
        // A pin wired as an analog input can only be read through ADC(...): a Pin object has no
        // read_u16(), whatever mode it was given (or none at all).
        if (mode === "adc" && wants === "unknown") {
          err("C005", `${name} is wired as ${modeText("adc")}, but line ${call.line} sets it up as a digital Pin. Use ${constructorFor(gpio, mode, modes)}.`, call.line);
          continue;
        }
        if (wants === "unknown") continue;
        if (wants === "unclear" || wants === "other") {
          err("C005", `Line ${call.line} gives ${name} a mode the checker can't confirm. It's wired as ${modeText(mode)}: use ${constructorFor(gpio, mode, modes)}.`, call.line);
          continue;
        }
        if (!modeFits(wants, mode)) err("C005", `${name} is wired as ${modeText(mode)}, but line ${call.line} sets it up as ${modeText(wants)}. Use ${constructorFor(gpio, mode, modes)}.`, call.line);
      }
      continue;
    }

    if (call.fn === "I2C" || call.fn === "SoftI2C") {
      checkI2cCall(call);
      continue;
    }

    // ADC(...) / PWM(...): the argument is a channel, a pin number, or Pin(n).
    const inner = /^\s*(?:machine\.)?Pin\s*\(\s*([^,)]+)/.exec(first);
    const target = gpioOf(inner ? inner[1]! : first);
    if (target.unknown !== undefined) {
      issues.push({ code: "C007", severity: "warning", message: `Can't tell which GPIO "${target.unknown}" is on line ${call.line}.`, line: call.line });
      continue;
    }
    for (let gpio of target.gpios!) {
      if (call.fn === "ADC" && !inner) {
        if (gpio === 4) continue; // internal temperature sensor
        if (gpio <= 3) gpio = 26 + gpio; // ADC(0) is GP26 ... ADC(2) is GP28
      }
      const name = record(gpio, call.fn === "ADC" ? "adc" : "pwm", call.line);
      if (!name) continue;
      const mode = modes[name]!;
      if (call.fn === "ADC" && mode !== "adc") err("C005", `${name} is wired as ${modeText(mode)}, but line ${call.line} reads it with ADC. Use ${constructorFor(gpio, mode, modes)}.`, call.line);
      if (call.fn === "PWM" && mode !== "out" && mode !== "pwm") err("C005", `${name} is wired as ${modeText(mode)}, but line ${call.line} drives it with PWM. Use ${constructorFor(gpio, mode, modes)}.`, call.line);
    }
  }

  // C005: a pin's mode changed after setup, e.g. btn.init(Pin.OUT) or Pin(18).init(mode=Pin.OUT),
  // must still match the wiring. Other objects' init() (Timer, I2C...) is left alone.
  for (const m of clean.matchAll(/(\)|[A-Za-z_]\w*(?:\s*\[[^\]\n]*\])?)\s*\.\s*(init|mode)\s*\(/g)) {
    const open = m.index! + m[0].length - 1;
    let depth = 0;
    let end = open;
    for (; end < clean.length; end++) {
      if (clean[end] === "(") depth++;
      else if (clean[end] === ")" && --depth === 0) break;
    }
    const args = splitArgs(clean.slice(open + 1, end));
    const line = lineOf(clean, m.index!);
    const receiver = m[1]!;
    const chained = receiver === ")" ? calls.find((c) => c.end === m.index) : undefined;
    if (chained && chained.fn !== "Pin") continue;
    const gpios = chained ? gpioOf(chained.args.split(",")[0] ?? "").gpios : pinVars.get(receiver);
    const mentionsPin = /\bPin\.(OUT|IN|OPEN_DRAIN|ALT\w*|PULL_\w+)\b/.test(args.join(","));
    if (!gpios) {
      if (mentionsPin || chained) err("C005", `Line ${line} changes a pin's mode with .${m[2]}(), and the checker can't tell which pin. Set each pin up once with Pin(number, ...) and keep that mode.`, line);
      continue;
    }
    const wants = wantedMode(args, 0);
    for (const gpio of gpios) {
      const name = `GP${gpio}`;
      const mode = modes[name];
      if (!mode || wants === "none") continue; // unwired pins are reported where they're set up
      if (wants === "unclear" || wants === "other" || !modeFits(wants, mode)) {
        err("C005", `Line ${line} changes ${name} to ${wants === "unclear" || wants === "other" ? "a mode the checker can't confirm" : modeText(wants)}, but it's wired as ${modeText(mode)}. Keep the mode from ${constructorFor(gpio, mode, modes)}.`, line);
      }
    }
  }

  issues.push(...importIssues(clean), ...moduleIssues(clean, build), ...dangerIssues(clean), ...aliasIssues(clean));
  const displays = displaysIn(build);
  for (const d of displays) issues.push(...displayIssues(clean, d, modes));
  if (displays[0]) issues.push(...displayTextIssues(src, clean, displays[0]));
  // C011 only for names the import check didn't already explain (e.g. "time" used without "import time").
  const explained = new Set(issues.filter((i) => i.code === "C002").map((i) => /uses (\w+)/.exec(i.message)?.[1]));
  issues.push(...undefinedNameIssues(clean).filter((i) => !explained.has(/uses "(\w+)"/.exec(i.message)?.[1])));
  for (const [name, mode] of Object.entries(modes)) {
    if (!(name in used)) err("C006", `The build wires ${name} as ${modeText(mode)}, but the code never uses it. Set it up with ${constructorFor(Number(name.slice(2)), mode, modes)}.`);
  }

  const errors = issues.filter((i) => i.severity === "error").length;
  return { ok: errors === 0, issues, used };
}
