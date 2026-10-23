// Part packs: one folder per part in parts/<id>/, data only (JSON, an
// optional MicroPython driver, test fixtures). scripts/gen-parts.ts copies every reviewed pack into
// parts.generated.ts (gitignored, generated before tests, dev servers and builds); this module
// checks them again and turns them into what the engine uses.
//
// Facts carry their source: { "value": …, "src": … } where src is one of
//   { "doc": "SH1106.pdf", "page": 13 }      a document in docs/hardware/
//   { "product": "…" }                       the seller's product page (text supplied by the user)
//   { "decision": "user, 20/10/2026", "why": "…" }
//   { "typical": true, "note": "…" }         common value, no datasheet yet: shown as unverified
// A pack can only add facts that the engine's safety rules act on; it can't switch a rule off.
import { PACK_SOURCES } from "./parts.generated";
import type { Column, ComponentDef, GpioMode } from "./types";

export const PACK_FORMAT = 1;

export type Source =
  | { doc: string; page: number; note?: string }
  | { product: string }
  | { decision: string; why?: string }
  | { typical: true; note?: string };

export interface Fact<T = unknown> {
  value: T;
  src: Source;
}

/** pack.json */
export interface PackMeta {
  format: number;
  id: string;
  /** Listing order (plan enum, word rules, precedence). */
  order: number;
  review: { status: "reviewed" | "draft"; by: string; date: string };
  /** The short name the plan uses ("led", "oled"); missing = the AI can't pick this part on its own. */
  kind?: string;
  /** MicroPython driver file in the pack, e.g. "driver/sh1106.py". */
  driver?: string;
}

/** A pack as it sits on disk (what parts.generated.ts holds). */
export interface PackSource {
  dir: string;
  files: Record<string, unknown>;
  driver?: { file: string; source: string };
}

/** A hole relative to the block's first row: [row offset, column, "REF.leg"]. */
export type TemplateHole = [number, Column, string];

/** layout.json: how one block sits on the breadboard and is wired (read by layout.ts). */
export interface LayoutTemplate {
  /** Short noun used in layout messages, e.g. "potentiometer", "display". */
  name: string;
  /** Rows the block takes, starting at its first row. */
  height: number;
  /** At most this many in one project, with the reason (a fact with its source). */
  max?: number;
  maxMessage?: string;
  /** The block's one pin need. `gpio`: any header GPIO; `adc`: an ADC pin; `i2c-pair`: SDA + SCL on one bus. */
  pins: Record<string, { need: "gpio" | "adc" | "i2c-pair"; mode?: GpioMode }>;
  /** Parts in placement order; `type` "self" = this pack's part. `ref` is the designator prefix. */
  parts: { ref: string; type: string; legs: Record<string, [number, Column]>; props?: Record<string, { request?: string; default: string | number }> }[];
  /** The part that names the block (its ref comes first). */
  main: string;
  /** Wires in order. Signal wires come from the pin ("signal", or "bus.sda"/"bus.scl"). */
  wires: ({ pin: string; to: TemplateHole; color?: string } | { ground: TemplateHole } | { power: TemplateHole })[];
}

/** Kinds of signal wire a pack can explain (by the Pico pin's mode family). */
export const SIGNAL_TEXTS = ["out", "in", "adc", "i2c_sda", "i2c_scl"] as const;

/**
 * text.json: the step texts for this part, with {placeholders} (see steps.ts `fill`).
 * Placement: {ref} {name} {list} {holes} {holes.N} {hole.<leg>} {prop.<name>} {ohms} {bands} {note}.
 * whyWithLed adds {led} {ma} {vf}; wire texts for signals add {pin} {bus}.
 */
export interface TextTemplates {
  place?: { title: string; text: string; tip?: string };
  why?: string;
  /** For a resistor in series with an LED: the current it allows. */
  whyWithLed?: string;
  /** "Why" of a wire that ends in a strip with this part's leg. */
  wire?: Partial<Record<"ground" | "power" | (typeof SIGNAL_TEXTS)[number], string>>;
  /** Names in the web app. */
  names?: {
    /** Shopping list [one, many]; `shopBy` groups and prefixes them, e.g. "{prop.color}" → "red LEDs". */
    shop: [string, string];
    shopBy?: string;
    /** Plan card label ({field} = a plan field, e.g. "{color} LED"); `planDot`: plan field shown as a colour dot. */
    plan?: string;
    planDot?: string;
    /** In the start screen's "Parts: …" line. */
    greeting?: string;
    /** Added to the 3D hover title, e.g. " · {prop.ohms} Ω". */
    hover?: string;
    /** What the Code panel calls the pack's driver file, e.g. "display driver". */
    driver?: string;
  };
}

/** view.json: how the part looks in 3D, from a small set of shapes (apps/web/src/scene/shapes.ts). */
export type ViewSpec =
  | { shape: "led-dome"; legs: [string, string]; colorProp: string; colors: Record<string, string> }
  | { shape: "axial"; legs: [string, string]; body: string; bandsProp: string }
  | { shape: "tact-button"; body: string; cap: string }
  | { shape: "rotary-knob"; body: string; knob: string }
  | {
      shape: "header-module";
      pins: string[];
      board: { size: [number, number]; height: number; color: string; note?: string };
      screen?: { size: [number, number]; text: string; bg: string; fg: string };
      labels?: boolean;
    }
  | { shape: "cylinder"; radius: number; height: number; color: string; top?: string; label?: string };

/** Fills {placeholders} from `vars`; unknown ones stay as written. */
export function fillTemplate(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{([^}]*)\}/g, (m, key: string) => (vars[key] === undefined ? m : String(vars[key])));
}

/** {prop.x} placeholders for a part's props, with the part's defaults. */
export function propVars(def: ComponentDef, props: Record<string, string | number> | undefined): Record<string, string | number> {
  return Object.fromEntries(Object.entries(def.props ?? {}).map(([k, spec]) => [`prop.${k}`, props?.[k] ?? spec.default]));
}

/** code.json: what the code checker (and later the code prompt) needs to know about the part. */
export interface CodeRules {
  /** A framebuf display driven by the pack's driver (checks C012 set-up/size/show and C013 text). */
  display?: { class: string; width: number; height: number; font: number; title: string; var: string };
  /** Imports: names that mean "you wanted this part's driver" (C010 hint), and the part's name when
   * the driver is imported without the part in the build. */
  modules?: { match: string[]; hint: string; onlyWith: string };
}

/**
 * agent.json: what the project agent needs (apps/api/src/agent). Only packs with a plan kind have
 * one. Texts use {placeholders} filled by the agent (see apps/api/src/agent/packText.ts).
 */
export interface AgentInfo {
  plan: {
    /** The part's line in the prompt's parts list (after `- "<kind>": `). */
    line: string;
    /** Extra instruction for the plan stage, e.g. "Give LEDs a color." */
    hint?: string;
    /** Plan part fields passed to the layout as request props, e.g. { "color": "color" }. */
    props?: Record<string, string>;
  };
  /** How the idea rules recognise the part (English only; the grammar is in requirements.ts). */
  words: {
    nouns: string[];
    /**
     * Nouns that count only as a thing ("a switch"), not a verb ("switch it on"): the listed
     * `words`, or every matched word `except` these. `notAfterComputer`: not "the laptop's screen";
     * `unlessUnsupported`: not when that vocabulary entry matched ("an LCD display").
     */
    nounContext?: { words?: string[]; except?: string[]; notAfterComputer?: boolean; unlessUnsupported?: string };
    /** Words that imply one of these parts when none is named ("press" → a button). */
    impliedBy?: { words: string[]; unless?: string[] };
    /** The board has one built in ("the on-board LED" needs no part). */
    builtIn?: boolean;
    /** Colour words in front of the noun count as parts ("red and green LEDs" = at least 2). */
    colors?: boolean;
    /** Vocabulary entries (apps/api/src/agent/vocabulary.ts) this part makes supported. */
    claims?: string[];
  };
  names: {
    /** With article / plural, for plan problems: ["an LED", "LEDs"]. */
    label: [string, string];
    /** For counts: ["LED", "LEDs"]. */
    count: [string, string];
    /** In "For now it supports …". */
    supports?: string;
    /** In short lists ("LEDs, buttons and knobs"): [one, many]. */
    short?: [string, string];
  };
  code: {
    /** The part's line in the code prompt's pin table. */
    pinLine: string;
    /** Rows of the handoff pin table. */
    handoff: string[];
    /** "When to import the driver" for the code rules, e.g. "sh1106 when an OLED display is listed". */
    moduleRule?: string;
    /** Documentation search for the code stage. */
    ragQuery: string;
  };
}

export interface Pack {
  meta: PackMeta;
  part: ComponentDef;
  layout?: LayoutTemplate;
  text?: TextTemplates;
  view?: ViewSpec;
  code?: CodeRules;
  agent?: AgentInfo;
  /** Every fact in part.json with its JSON path, for review lists. */
  facts: { path: string; src: Source }[];
  driver?: { file: string; module: string; source: string };
}

export class PackError extends Error {}

// ---------------------------------------------------------------- checking

type Check = (v: unknown, path: string) => void;

const fail = (path: string, msg: string): never => {
  throw new PackError(`${path}: ${msg}`);
};
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Printable text, no control characters, bounded size (pack text reaches the model's prompt). */
const str: Check = (v, p) => {
  if (typeof v !== "string") fail(p, "must be text");
  const s = v as string;
  if (s.length > 2000) fail(p, "text longer than 2000 characters");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(s)) fail(p, "control characters are not allowed");
};
const num: Check = (v, p) => {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(p, "must be a number");
};
const bool: Check = (v, p) => {
  if (typeof v !== "boolean") fail(p, "must be true or false");
};
const oneOf = (values: readonly string[]): Check => (v, p) => {
  if (typeof v !== "string" || !values.includes(v)) fail(p, `must be one of ${values.join(", ")}`);
};
const arr = (item: Check, max = 64): Check => (v, p) => {
  if (!Array.isArray(v)) fail(p, "must be a list");
  if ((v as unknown[]).length > max) fail(p, `more than ${max} items`);
  (v as unknown[]).forEach((x, i) => item(x, `${p}[${i}]`));
};
const any = (...checks: Check[]): Check => (v, p) => {
  const errors: string[] = [];
  for (const c of checks) {
    try {
      return c(v, p);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  fail(p, `doesn't match any allowed form (${errors.join(" | ")})`);
};
/** An object with exactly these keys (`?` suffix = optional). Unknown keys are an error. */
const obj = (shape: Record<string, Check>): Check => (v, p) => {
  if (!isObj(v)) fail(p, "must be an object");
  const o = v as Record<string, unknown>;
  const keys = Object.keys(shape).map((k) => k.replace(/\?$/, ""));
  for (const k of Object.keys(o)) if (!keys.includes(k)) fail(`${p}.${k}`, "unknown field");
  for (const [k, check] of Object.entries(shape)) {
    const key = k.replace(/\?$/, "");
    if (o[key] === undefined) {
      if (!k.endsWith("?")) fail(`${p}.${key}`, "missing");
      continue;
    }
    check(o[key], `${p}.${key}`);
  }
};
const record = (item: Check): Check => (v, p) => {
  if (!isObj(v)) fail(p, "must be an object");
  for (const [k, x] of Object.entries(v as object)) item(x, `${p}.${k}`);
};

const source: Check = any(
  obj({ doc: str, page: num, "note?": str }),
  obj({ product: str }),
  obj({ decision: str, "why?": str }),
  obj({ typical: (v, p) => v === true || fail(p, "must be true"), "note?": str }),
);
const fact = (value: Check): Check => obj({ value, src: source });

const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const id: Check = (v, p) => {
  str(v, p);
  if (!ID.test(v as string)) fail(p, "use lower-case letters, digits and dashes");
};
const numPair = arr(num, 2);

const packMeta = obj({
  format: (v, p) => v === PACK_FORMAT || fail(p, `must be ${PACK_FORMAT}`),
  id,
  order: num,
  review: obj({ status: oneOf(["reviewed", "draft"]), by: str, date: (v, p) => (str(v, p), /^\d{4}-\d{2}-\d{2}$/.test(v as string) || fail(p, "use YYYY-MM-DD")) }),
  "kind?": id,
  "driver?": (v, p) => (str(v, p), /^driver\/[a-z0-9_]+\.py$/.test(v as string) || fail(p, "must be driver/<name>.py")),
});

const LEG_KINDS = ["power_in", "ground", "digital_in", "digital_out", "analog_out", "i2c_sda", "i2c_scl"] as const;
const ELEMENT_KINDS = ["led", "resistor", "switch", "short", "load"] as const;

const partFile = obj({
  id,
  name: str,
  category: str,
  legs: arr(
    obj({
      id: str,
      label: str,
      "kind?": oneOf(LEG_KINDS),
      "level?": oneOf(["vcc"]),
      "voltageRange?": fact(numPair),
      "maxSafeVoltage?": fact(num),
      "highCurrent?": bool,
    }),
  ),
  elements: arr(obj({ kind: oneOf(ELEMENT_KINDS), a: str, b: str, "currentMa?": fact(num) })),
  "props?": record(obj({ "enum?": arr(str), "type?": str, default: any(str, num) })),
  // Every spec is a fact with a source, except the plain-language note.
  "specs?": (v, p) => {
    if (!isObj(v)) fail(p, "must be an object");
    for (const [k, x] of Object.entries(v as object)) (k === "note" ? str : fact(() => {}))(x, `${p}.${k}`);
  },
  /** The original free-text source notes (kept word for word from data/components). */
  "specsSource?": any(str, arr(str)),
});

const COLUMNS = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"] as const;
const offset: Check = (v, p) => (num(v, p), (Number.isInteger(v) && (v as number) >= 0 && (v as number) < 64) || fail(p, "must be a row offset 0-63"));
const holeAt: Check = (v, p) => {
  if (!Array.isArray(v) || v.length !== 2) fail(p, "must be [row offset, column]");
  offset((v as unknown[])[0], `${p}[0]`);
  oneOf(COLUMNS)((v as unknown[])[1], `${p}[1]`);
};
const wireEnd: Check = (v, p) => {
  if (!Array.isArray(v) || v.length !== 3) fail(p, 'must be [row offset, column, "REF.leg"]');
  holeAt((v as unknown[]).slice(0, 2), p);
  str((v as unknown[])[2], `${p}[2]`);
};
const MODES = ["out", "pwm", "in", "in_pullup", "in_pulldown", "adc"] as const;

const layoutFile = obj({
  name: str,
  height: (v, p) => (offset(v, p), (v as number) > 0 || fail(p, "must be at least 1")),
  "max?": fact(num),
  "maxMessage?": str,
  pins: (v, p) => {
    record(obj({ need: oneOf(["gpio", "adc", "i2c-pair"]), "mode?": oneOf(MODES) }))(v, p);
    // One pin need per block for now; a part with two independent pins needs a new layout capability.
    if (Object.keys(v as object).length !== 1) fail(p, "must name exactly one pin need");
  },
  parts: arr(obj({ ref: (v, p) => (str(v, p), /^[A-Z]+$/.test(v as string) || fail(p, "must be capital letters, e.g. LED")), type: str, legs: record(holeAt), "props?": record(obj({ "request?": str, default: any(str, num) })) }), 8),
  main: str,
  wires: arr(any(obj({ pin: str, to: wireEnd, "color?": str }), obj({ ground: wireEnd }), obj({ power: wireEnd })), 16),
});

const codeFile = obj({
  "display?": obj({ class: str, width: fact(num), height: fact(num), font: fact(num), title: str, var: str }),
  "modules?": obj({ match: arr(str, 8), hint: str, onlyWith: str }),
});

const words = (max = 64) => arr(str, max);
const agentFile = obj({
  plan: obj({ line: str, "hint?": str, "props?": record(str) }),
  words: obj({
    nouns: words(),
    "nounContext?": (v, p) => {
      obj({ "words?": words(), "except?": words(), "notAfterComputer?": bool, "unlessUnsupported?": str })(v, p);
      if (((v as { words?: unknown }).words === undefined) === ((v as { except?: unknown }).except === undefined)) fail(p, "give either words or except");
    },
    "impliedBy?": obj({ words: words(), "unless?": words() }),
    "builtIn?": bool,
    "colors?": bool,
    "claims?": words(16),
  }),
  names: obj({ label: arr(str, 2), count: arr(str, 2), "supports?": str, "short?": arr(str, 2) }),
  code: obj({ pinLine: str, handoff: words(4), "moduleRule?": str, ragQuery: str }),
});

const textFile = obj({
  "place?": obj({ title: str, text: str, "tip?": str }),
  "why?": str,
  "whyWithLed?": str,
  "wire?": obj(Object.fromEntries(["ground", "power", ...SIGNAL_TEXTS].map((k) => [`${k}?`, str]))),
  "names?": obj({ shop: arr(str, 2), "shopBy?": str, "plan?": str, "planDot?": str, "greeting?": str, "hover?": str, "driver?": str }),
});

const color: Check = (v, p) => (str(v, p), /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v as string) || fail(p, "must be a colour like #1d3c8f"));
const size2 = arr(num, 2);
const viewFile: Check = (v, p) => {
  const shape = isObj(v) ? v.shape : undefined;
  const shapes: Record<string, Check> = {
    "led-dome": obj({ shape: str, legs: arr(str, 2), colorProp: str, colors: record(color) }),
    axial: obj({ shape: str, legs: arr(str, 2), body: color, bandsProp: str }),
    "tact-button": obj({ shape: str, body: color, cap: color }),
    "rotary-knob": obj({ shape: str, body: color, knob: color }),
    "header-module": obj({
      shape: str,
      pins: arr(str, 16),
      board: obj({ size: size2, height: num, color, "note?": str }),
      "screen?": obj({ size: size2, text: str, bg: color, fg: color }),
      "labels?": bool,
    }),
    cylinder: obj({ shape: str, radius: num, height: num, color, "top?": color, "label?": str }),
  };
  if (typeof shape !== "string" || !shapes[shape]) fail(`${p}.shape`, `must be one of ${Object.keys(shapes).join(", ")}`);
  shapes[shape as string]!(v, p);
};

/** Every {placeholder} in text.json must be one the engine fills for this part. */
function checkText(pack: Pack): void {
  const at = `parts/${pack.meta.id}/text.json`;
  const legs = pack.part.legs.map((l) => l.id);
  const props = Object.keys(pack.part.props ?? {});
  const base = ["ref", "name", "list", "holes", "ohms", "bands", "note", ...legs.map((l) => `hole.${l}`), ...legs.map((_, i) => `holes.${i}`), ...props.map((k) => `prop.${k}`)];
  const check = (text: string | undefined, path: string, extra: string[] = []) => {
    for (const m of (text ?? "").matchAll(/\{([^}]*)\}/g)) if (![...base, ...extra].includes(m[1]!)) fail(`${at}.${path}`, `unknown placeholder {${m[1]}}`);
  };
  const t = pack.text!;
  check(t.place?.title, "place.title");
  check(t.place?.text, "place.text");
  check(t.place?.tip, "place.tip");
  check(t.why, "why");
  check(t.whyWithLed, "whyWithLed", ["led", "ma", "vf"]);
  for (const [k, v] of Object.entries(t.wire ?? {})) check(v, `wire.${k}`, SIGNAL_TEXTS.includes(k as never) ? ["pin", "bus"] : []);
  const planFields = Object.keys(pack.agent?.plan.props ?? {});
  check(t.names?.shopBy, "names.shopBy");
  check(t.names?.hover, "names.hover");
  check(t.names?.plan, "names.plan", planFields);
  if (t.names?.planDot && !planFields.includes(t.names.planDot)) fail(`${at}.names.planDot`, `must be a plan field (${planFields.join(", ") || "none"})`);
}

/** Legs and props the 3D shape names must exist on the part. */
function checkView(pack: Pack): void {
  const at = `parts/${pack.meta.id}/view.json`;
  const v = pack.view!;
  const legs = pack.part.legs.map((l) => l.id);
  const props = Object.keys(pack.part.props ?? {});
  const named = "legs" in v ? v.legs : "pins" in v ? v.pins : [];
  for (const leg of named) if (!legs.includes(leg)) fail(at, `"${leg}" isn't a leg of ${pack.meta.id}`);
  for (const prop of [("colorProp" in v ? v.colorProp : undefined), ("bandsProp" in v ? v.bandsProp : undefined)]) if (prop && !props.includes(prop)) fail(at, `"${prop}" isn't a prop of ${pack.meta.id}`);
}

/** Template parts and wires must fit the block, place every leg once and name real legs. */
function checkLayout(pack: Pack, all: Map<string, Pack>): void {
  const at = `parts/${pack.meta.id}/layout.json`;
  const t = pack.layout!;
  const [pinName, pin] = Object.entries(t.pins)[0]!;
  if (pin.need === "i2c-pair" ? pin.mode !== undefined : pin.mode === undefined) fail(`${at}.pins.${pinName}.mode`, pin.need === "i2c-pair" ? "an I2C pair sets its own modes" : "missing");
  const refs = new Map<string, ComponentDef>();
  for (const [i, part] of t.parts.entries()) {
    const def = part.type === "self" ? pack.part : all.get(part.type)?.part;
    if (!def) fail(`${at}.parts[${i}].type`, `unknown part "${part.type}"`);
    if (refs.has(part.ref)) fail(`${at}.parts[${i}].ref`, `"${part.ref}" is used twice`);
    refs.set(part.ref, def!);
    const legs = Object.keys(part.legs);
    if (legs.sort().join() !== def!.legs.map((l) => l.id).sort().join()) fail(`${at}.parts[${i}].legs`, `must place exactly the legs ${def!.legs.map((l) => l.id).join(", ")}`);
    for (const [leg, [row]] of Object.entries(part.legs)) if (row >= t.height) fail(`${at}.parts[${i}].legs.${leg}`, "outside the block's height");
  }
  if (!refs.has(t.main)) fail(`${at}.main`, `"${t.main}" isn't one of the template's parts`);
  if (t.parts.find((p) => p.ref === t.main)!.type !== "self") fail(`${at}.main`, "must be this pack's own part");
  const pinWires = pin.need === "i2c-pair" ? [`${pinName}.sda`, `${pinName}.scl`] : [pinName];
  t.wires.forEach((w, i) => {
    const end = "pin" in w ? w.to : "ground" in w ? w.ground : w.power;
    if ("pin" in w && !pinWires.includes(w.pin)) fail(`${at}.wires[${i}].pin`, `must be ${pinWires.join(" or ")}`);
    if (end[0] >= t.height) fail(`${at}.wires[${i}]`, "outside the block's height");
    const [ref, leg] = end[2].split(".");
    if (!refs.get(ref!)?.legs.some((l) => l.id === leg)) fail(`${at}.wires[${i}]`, `"${end[2]}" isn't a leg of the template's parts`);
  });
  for (const p of pinWires) if (!t.wires.some((w) => "pin" in w && w.pin === p)) fail(`${at}.wires`, `no wire from ${p}`);
  if ((t.max === undefined) !== (t.maxMessage === undefined)) fail(`${at}.max`, "max and maxMessage go together");
}

// ---------------------------------------------------------------- loading

/** { value, src } → value, collecting each fact's source. */
function unwrap(v: unknown, path: string, facts: Pack["facts"]): unknown {
  if (isObj(v) && "value" in v && "src" in v && Object.keys(v).length === 2) {
    facts.push({ path, src: v.src as Source });
    return v.value;
  }
  if (Array.isArray(v)) return v.map((x, i) => unwrap(x, `${path}[${i}]`, facts));
  if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unwrap(x, `${path}.${k}`, facts)]));
  return v;
}

/** Checks one pack and turns it into engine data. Throws PackError with the exact field. */
export function loadPack(src: PackSource): Pack {
  const at = `parts/${src.dir}`;
  for (const name of Object.keys(src.files)) if (!["pack.json", "part.json", "layout.json", "text.json", "view.json", "code.json", "agent.json"].includes(name)) fail(`${at}/${name}`, "unknown pack file");
  const metaRaw = src.files["pack.json"] ?? fail(`${at}/pack.json`, "missing");
  const partRaw = src.files["part.json"] ?? fail(`${at}/part.json`, "missing");
  packMeta(metaRaw, `${at}/pack.json`);
  partFile(partRaw, `${at}/part.json`);
  const meta = metaRaw as PackMeta;
  const layoutRaw = src.files["layout.json"];
  const textRaw = src.files["text.json"];
  if (textRaw !== undefined) textFile(textRaw, `${at}/text.json`);
  const viewRaw = src.files["view.json"];
  if (viewRaw !== undefined) viewFile(viewRaw, `${at}/view.json`);
  const agentRaw = src.files["agent.json"];
  if (agentRaw !== undefined) agentFile(agentRaw, `${at}/agent.json`);
  if ((meta.kind === undefined) !== (agentRaw === undefined)) fail(`${at}/agent.json`, meta.kind ? "missing: a pack with a kind needs agent.json" : "only packs with a kind have agent.json");
  const codeRaw = src.files["code.json"];
  if (codeRaw !== undefined) codeFile(codeRaw, `${at}/code.json`);
  if (layoutRaw !== undefined) layoutFile(layoutRaw, `${at}/layout.json`);
  // A part the AI may pick (kind) must have a layout, and only such parts have one.
  if ((meta.kind === undefined) !== (layoutRaw === undefined)) fail(`${at}/layout.json`, meta.kind ? "missing: a pack with a kind needs a layout" : "only packs with a kind have a layout");
  if (meta.id !== src.dir) fail(`${at}/pack.json.id`, `must be the folder name "${src.dir}"`);
  if ((partRaw as { id: string }).id !== meta.id) fail(`${at}/part.json.id`, `must be "${meta.id}"`);

  const facts: Pack["facts"] = [];
  const part = unwrap(partRaw, "part", facts) as ComponentDef;
  const legIds = new Set(part.legs.map((l) => l.id));
  if (legIds.size !== part.legs.length) fail(`${at}/part.json.legs`, "duplicate leg ids");
  for (const e of part.elements) if (!legIds.has(e.a) || !legIds.has(e.b)) fail(`${at}/part.json.elements`, `element refers to an unknown leg (${e.a}, ${e.b})`);

  let driver: Pack["driver"];
  if (meta.driver) {
    if (!src.driver || src.driver.file !== meta.driver) fail(`${at}/${meta.driver}`, "missing driver file");
    const source = src.driver!.source;
    // The driver is written onto the Pico: plain ASCII, bounded size.
    if (!/^[\x09\x0a\x0d\x20-\x7e]*$/.test(source)) fail(`${at}/${meta.driver}`, "driver must be plain ASCII");
    if (source.length > 64 * 1024) fail(`${at}/${meta.driver}`, "driver larger than 64 KB");
    const file = meta.driver.slice("driver/".length);
    driver = { file, module: file.replace(/\.py$/, ""), source };
  } else if (src.driver) fail(`${at}/driver`, "driver file present but not named in pack.json");
  const layout = layoutRaw === undefined ? undefined : (unwrap(layoutRaw, "layout", facts) as LayoutTemplate);
  const pack: Pack = { meta, part, facts, ...(layout ? { layout } : {}), ...(textRaw ? { text: textRaw as TextTemplates } : {}), ...(viewRaw ? { view: viewRaw as ViewSpec } : {}), ...(codeRaw ? { code: unwrap(codeRaw, "code", facts) as CodeRules } : {}), ...(agentRaw ? { agent: agentRaw as AgentInfo } : {}), ...(driver ? { driver } : {}) };
  if (pack.text) checkText(pack);
  if (pack.view) checkView(pack);
  for (const [k, v] of Object.entries(pack.agent?.plan.props ?? {})) {
    if (!pack.layout?.parts.some((p) => p.props && Object.values(p.props).some((x) => x.request === v))) fail(`${at}/agent.json.plan.props.${k}`, `the layout has no prop asking for "${v}"`);
  }
  for (const w of [...(pack.agent?.words.nouns ?? []), ...(pack.agent?.words.impliedBy?.words ?? [])]) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(w)) fail(`${at}/agent.json.words`, `"${w}" must be one lower-case word (letters, digits, dashes)`);
  }
  if (pack.code && !pack.driver) fail(`${at}/code.json`, "code rules need the pack's driver (pack.json driver)");
  return pack;
}

/** Loads every pack and checks them against each other (unique ids, kinds and orders). */
export function loadPacks(sources: readonly PackSource[]): Pack[] {
  const packs = sources.map(loadPack).sort((a, b) => a.meta.order - b.meta.order);
  const seen = new Map<string, string>();
  for (const p of packs) {
    for (const [what, key] of [["id", p.meta.id], ["kind", p.meta.kind], ["order", String(p.meta.order)], ["driver", p.driver?.file]] as const) {
      if (key === undefined) continue;
      const other = seen.get(`${what}:${key}`);
      if (other) fail(`parts/${p.meta.id}/pack.json`, `${what} "${key}" is also used by ${other}`);
      seen.set(`${what}:${key}`, p.meta.id);
    }
  }
  const byId = new Map(packs.map((p) => [p.meta.id, p]));
  for (const p of packs) if (p.layout) checkLayout(p, byId);
  return packs;
}

/** Every reviewed pack in parts/ (generated list). */
export const PACKS: readonly Pack[] = loadPacks(PACK_SOURCES);

export const getPack = (id: string): Pack | undefined => PACKS.find((p) => p.meta.id === id);
/** The pack of a catalog part (by its component id). */
export const packOfPart = (def: ComponentDef): Pack | undefined => getPack(def.id);
export const packByKind = (kind: string): Pack | undefined => PACKS.find((p) => p.meta.kind === kind);

/** Facts with no document behind them yet (typical values), for the review list. */
export const unverifiedFacts = (pack: Pack) => pack.facts.filter((f) => "typical" in f.src);
