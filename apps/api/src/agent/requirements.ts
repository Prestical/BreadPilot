// Code-side reading of a project idea. General principles (not tuned to any test sentence):
//
//  1. An unambiguous component name (servo, LCD, relay, DHT22…) means the part is unsupported.
//     Displays (Milestone 6): the 1.3" I2C OLED (SH1106, 128x64) is supported, so "OLED" and a
//     plain "display"/"screen" used as a thing mean that part; display types it can't be
//     (LCD, TFT, e-ink, 7-segment, matrix, colour, touch, character sizes like 16x2) stay unsupported.
//  2. A word that is only sometimes a component ("display", "sound", "fan", "distance") counts
//     only in a component context: used as a noun ("on a screen", "make a sound"), after a sensing
//     verb ("measure the distance"), or as a condition ("when it gets dark"). Otherwise it's ignored.
//  3. When the rules can't decide, they don't guess: the term is reported as ambiguous and the
//     user is asked (the project waits for plan approval with a question).
//  4. Negation is respected: "no buzzer needed", "without a screen", "the button isn't needed".
//  5. The board's own features are supported: on-board LED, internal temperature sensor, Wi-Fi,
//     Bluetooth, USB serial to a computer.
//  6. Counts: one clear number for a part is exact ("four LEDs" → exactly 4); a choice ("2 or 3
//     LEDs") is a range; a part named without a number ("an LED", "LEDs") means at least one. A
//     size is not a count: the 3 in 'the 1.3" OLED' or "a 16 mm button" is a size.
//  9. Talking about filming ("easy to see on camera", "smile for the camera") isn't asking for a
//     camera part; "a camera" as a thing still is.
// 10. Words that imply a part ("blink" → an LED) don't when the idea names a part they describe
//     instead ("the display blinks"): the pack's `impliedBy.unlessNamed`.
//  7. Later feedback overrides the original idea ("remove the button").
//  8. An idea that names its parts gets only those parts; extra parts are only allowed for ideas
//     that name none ("make a game"). Non-English text is never restricted (the rules can't read it).
// These rules only understand English. Other languages fall back to the LLM alone.

import type { Board } from "@breadpilot/circuit-core";
import { AGENT_PACKS, agentOf, joinList } from "./packText";
import type { PartKind, Plan } from "./schemas";
import { ALARM_SOUND_QUESTION, CONTEXTUAL_WORDS, SOUND_PART, SOUND_VERB_WORDS, STRONG_WORDS, strongEntry, TEMPERATURE_PART, UNSUPPORTED_DISPLAY } from "./vocabulary";

export { UNSUPPORTED_DISPLAY };

export interface PartNeed {
  min: number;
  /** Set when the text gives one clear number for this part. */
  exact?: number;
  /** Set for a choice like "2 or 3 LEDs". */
  max?: number;
}

export interface Requirements {
  /** Definitely needs parts the builder can't wire (labels for the user). */
  unsupported: string[];
  /** Questions to ask because the rules couldn't decide. */
  ambiguous: string[];
  /** Parts the text names, with minimum counts. */
  parts: Record<PartKind, PartNeed>;
  /** Parts the text explicitly excludes ("no button", "remove the knob"). */
  removed: PartKind[];
  /**
   * One of several parts taken away ("remove the green LED", "drop the second button", "remove one
   * LED"): the count goes down by that many; the kind isn't banned (M9, 11/11/2026).
   */
  fewer?: Partial<Record<PartKind, number>>;
  /** GPIOs the text asks for explicitly ("GP15", "GPIO 15"). */
  pins: string[];
  /** The text is about the Pico's own LED (a project with no external parts is fine). */
  onboard: boolean;
  /** Fewer than 3 words: too little to plan from. */
  tooShort: boolean;
  /** Part kinds named explicitly by a noun ("LED", "button", "knob"), not just implied ("lights", "press"). */
  named: PartKind[];
  /** The text reads as English, so the rules understood it. */
  english: boolean;
}

// ---------------------------------------------------------------- tokenizing

const PUNCT = new Set([".", ",", ";", ":", "!", "?", "(", ")"]);
const NEGATIONS = new Set(["no", "not", "without", "never", "don't", "dont", "doesn't", "doesnt", "won't", "wont", "isn't", "isnt", "instead", "rather", "remove", "drop", "skip", "exclude", "except", "nor"]);
const NEEDED = new Set(["needed", "required", "necessary", "wanted"]);
const DETERMINERS = new Set([
  "a", "an", "the", "one", "two", "three", "four", "five", "six", "my", "our", "your", "this", "that", "its", "their", "some", "any",
  "small", "little", "tiny", "big", "on", "with", "using", "via", "into", "onto", "extra", "external", "another", "of",
]);
const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20 };
const COLORS = new Set(["red", "green", "yellow", "blue", "white", "orange", "purple", "pink", "amber"]);
const ONBOARD = new Set(["on-board", "onboard", "built-in", "builtin", "internal", "pico's", "board's", "pico"]);
/**
 * Words that point at the Pico's own temperature sensor, which sits inside its chip (principle 5):
 * "the board's temperature", "the chip temperature", "the CPU's temperature".
 */
const OWN_TEMPERATURE = new Set([...ONBOARD, "chip", "chip's", "cpu", "cpu's", "processor", "processor's", "microcontroller", "microcontroller's", "rp2350", "rp2350's", "board"]);
/** Temperature of something outside the board: needs a separate sensor. */
const OUTSIDE_TEMPERATURE = /\b(room|outside|outdoor|outdoors|indoor|air|ambient|water|body|weather|soil|fridge|freezer|oven|house|home|garden|plant|aquarium|liquid|food|coffee|tea|humidity|humid)\b/;
/** Principle 3 for a bare "temperature": the board can read its own, so ask instead of refusing. */
export const TEMPERATURE_QUESTION =
  "The Pico 2 W has a temperature sensor inside its chip: it reads the chip's own temperature, which is close to the room's while the board is idle. Should the project use that, or do you mean a separate temperature sensor (not supported yet)?";
const COMPUTER = /\b(computer|laptop|pc|mac|phone|tablet|terminal|serial|thonny|shell|console|browser|web ?page|website)\b/;

interface Text {
  tokens: string[];
  joined: string;
  /** Index of the token a character offset belongs to (for regex matches). */
  tokenAt(offset: number): number;
}

function tokenize(input: string): Text {
  const joined = input
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    // Sizes stay sizes: an inch mark after a number becomes "inch" ('1.3"' → "1·3 inch"), and a
    // decimal point is kept inside its number, so neither part becomes a count.
    .replace(/(\d)\s*["”″]/g, "$1 inch ")
    .replace(/(\d)\.(\d)/g, "$1·$2")
    .replace(/[“”"]/g, " ")
    .replace(/([.,;:!?()])/g, " $1 ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = joined ? joined.split(" ") : [];
  const starts: number[] = [];
  let pos = 0;
  for (const t of tokens) {
    starts.push(joined.indexOf(t, pos));
    pos = starts.at(-1)! + t.length;
  }
  return {
    tokens,
    joined,
    tokenAt(offset) {
      let i = 0;
      while (i + 1 < starts.length && starts[i + 1]! <= offset) i++;
      return i;
    },
  };
}

/** Up to n tokens before index i, stopping at punctuation or "but". */
function before(t: Text, i: number, n: number): string[] {
  const out: string[] = [];
  for (let k = i - 1; k >= 0 && out.length < n; k--) {
    const tok = t.tokens[k]!;
    if (PUNCT.has(tok) || tok === "but") break;
    out.unshift(tok);
  }
  return out;
}

function after(t: Text, i: number, n: number): string[] {
  const out: string[] = [];
  for (let k = i + 1; k < t.tokens.length && out.length < n; k++) {
    const tok = t.tokens[k]!;
    if (PUNCT.has(tok) || tok === "but") break;
    out.push(tok);
  }
  return out;
}

/** "no buzzer", "without a screen", "instead of a motor", "the button isn't needed". */
function negated(t: Text, i: number): boolean {
  if (before(t, i, 4).some((w) => NEGATIONS.has(w))) return true;
  const next = after(t, i, 4);
  return (next.some((w) => NEEDED.has(w)) && next.some((w) => NEGATIONS.has(w) || w.endsWith("n't"))) || next.includes("unnecessary");
}

/** Adjectives allowed between a determiner/number and its noun: "two small red LEDs". */
const ADJECTIVES = new Set([
  ...COLORS, "small", "little", "tiny", "big", "large", "bright", "extra", "separate", "different", "single", "simple",
  "external", "push", "tactile", "momentary", "rotary", "round", "square", "new", "old", "cheap", "spare", "more",
]);

const LIKE_ADJECTIVES = new Set(["same", "identical", "similar", "matching", "standard", "normal", "regular", "basic", "nice", "cool"]);

/**
 * A word that describes the noun after it: a known adjective or color, a technical modifier with
 * digits ("i2c", "16x2", "128x64"), or a participle ("blinking", "flashing", "connected").
 * Pure numbers are NOT modifiers: they are the count we're looking for.
 */
function isModifier(w: string): boolean {
  if (ADJECTIVES.has(w) || LIKE_ADJECTIVES.has(w)) return true;
  if (/\d/.test(w) && /[a-z]/.test(w)) return true;
  return /^[a-z]{3,}(ing|ed)$/.test(w) && !/eed$/.test(w);
}

/**
 * The word in front of a noun phrase, skipping up to three modifiers directly before the noun.
 * "4 same red blinking LED" → "4"; "on an i2C display" → "an";
 * "pin 20 that I switch" → "i" (so "20" is NOT attached to "switch").
 */
function headBefore(t: Text, i: number): string | undefined {
  let k = i - 1;
  for (let skipped = 0; k >= 0 && skipped < 3 && isModifier(t.tokens[k]!); skipped++) k--;
  const w = t.tokens[k];
  return w === undefined || PUNCT.has(w) ? undefined : w;
}

/** Used as a thing, not a verb: "on a screen", "the display", "a small screen". "to display" is a verb. */
function nounContext(t: Text, i: number): boolean {
  const head = headBefore(t, i);
  return head !== undefined && head !== "to" && (DETERMINERS.has(head) || /^\d+$/.test(head));
}

function matches(t: Text, re: RegExp): number[] {
  const out: number[] = [];
  for (const m of t.joined.matchAll(new RegExp(re.source, "g"))) out.push(t.tokenAt(m.index!));
  return out;
}

// ---------------------------------------------------------------- unsupported parts

const SENSING_VERBS = /^(measure|measures|measuring|detect|detects|detecting|sense|senses|sensing|monitor|monitors|monitoring|track|tracks|log|logs|logging|check|checks)$/;
const QUANTITIES: Record<string, string> = {
  temperature: "a temperature or humidity sensor",
  distance: "a distance sensor",
  motion: "a motion sensor",
  movement: "a motion sensor",
  presence: "a motion sensor",
  light: "a light sensor",
  brightness: "a light sensor",
  darkness: "a light sensor",
  sound: "a microphone",
  noise: "a microphone",
  pressure: "a pressure sensor",
  gas: "a gas sensor",
  smoke: "a gas sensor",
  water: "a water sensor",
};
const CONDITIONS: Record<string, string> = {
  dark: "a light sensor",
  bright: "a light sensor",
  warm: "a temperature or humidity sensor",
  hot: "a temperature or humidity sensor",
  cold: "a temperature or humidity sensor",
  humid: "a temperature or humidity sensor",
  loud: "a microphone",
  close: "a distance sensor",
  near: "a distance sensor",
};
const PRODUCE = /^(make|makes|making|play|plays|playing|produce|produces|emit|emits)$/;

/** "easy to see on camera", "smile for the camera": filming, not a camera part (principle 9). */
function aboutFilming(t: Text, i: number): boolean {
  if (!/^cameras?$/.test(t.tokens[i]!)) return false;
  const [b1, b2] = [t.tokens[i - 1], t.tokens[i - 2]];
  return b1 === "on" || b1 === "off" || (b1 === "the" && ["for", "to", "at", "into", "on"].includes(b2 ?? ""));
}

/** The idea is about the Pico's own chip temperature only ("the CPU's temperature"), not the air's. */
const chipTemperatureOnly = (t: Text) => t.tokens.some((w) => OWN_TEMPERATURE.has(w)) && /\b(temperature|sensor)\b/.test(t.joined) && !OUTSIDE_TEMPERATURE.test(t.joined);

/**
 * Temperatures the air sensor can't measure: in or of a liquid, soil, a body, or outside its 0-50 °C
 * (DHT11 manual and shop page): these still need another sensor (M15).
 */
const NOT_AIR_TEMPERATURE = /\b(water|liquid|liquids|aquarium|pool|coffee|tea|food|soup|soil|body|skin|fever|oven|freezer|frozen|boiling)\b/;

/** "a temperature sensor", "the humidity sensor": the temperature part, when there is one. */
const TEMPERATURE_SENSOR_WORDS = new Set(["temperature", "humidity", "dht", "dht11", "thermal"]);

function unsupportedParts(t: Text): { unsupported: string[]; ambiguous: string[] } {
  const unsupported = new Set<string>();
  const ambiguous = new Set<string>();
  const internalSensor = chipTemperatureOnly(t);
  // A temperature part exists (M15): the air's temperature is supported, so neither refuse nor ask.
  const notAir = TEMPERATURE_PART !== undefined && !internalSensor && NOT_AIR_TEMPERATURE.test(t.joined);
  const temperatureOk = (label: string) => label.startsWith("a temperature or humidity") && (internalSensor || (TEMPERATURE_PART !== undefined && !notAir));
  const otherTemperatureSensor = strongEntry("temperature")!.label;

  for (const { re, label } of STRONG_WORDS) for (const i of matches(t, re)) if (!negated(t, i) && !aboutFilming(t, i)) unsupported.add(label);

  for (const { re, label, ok, question } of CONTEXTUAL_WORDS) {
    for (const i of matches(t, re)) {
      if (negated(t, i) || (ok === "onboard" && before(t, i, 3).some((w) => ONBOARD.has(w)))) continue;
      if (t.tokens[i]!.startsWith("sensor") && TEMPERATURE_PART && TEMPERATURE_SENSOR_WORDS.has(t.tokens[i - 1] ?? "")) continue;
      const producing = before(t, i, 3).some((w) => PRODUCE.test(w));
      if (!(nounContext(t, i) || producing || after(t, i, 1)[0] === "sensor")) continue;
      if (question && t.tokens[i] === question.word) ambiguous.add(question.text);
      else unsupported.add(label);
    }
  }

  // "the LED beeps", "it buzzes when…"
  for (const { re, label } of SOUND_VERB_WORDS) for (const i of matches(t, re)) if (!negated(t, i)) unsupported.add(label);

  // "measure the distance", "detect motion", "check the temperature"
  for (const [quantity, label] of Object.entries(QUANTITIES)) {
    for (const i of matches(t, new RegExp(`\\b${quantity}\\b`))) {
      if (negated(t, i)) continue;
      if (temperatureOk(label)) continue; // the Pico's own sensor, or the temperature part
      if (notAir && label.startsWith("a temperature")) {
        unsupported.add(otherTemperatureSensor);
        continue;
      }
      const sensing = before(t, i, 3).some((w) => SENSING_VERBS.test(w));
      // A bare "the temperature" may be the board's own: ask. Room, water, weather… need a sensor.
      if (quantity === "temperature" && !OUTSIDE_TEMPERATURE.test(t.joined)) ambiguous.add(TEMPERATURE_QUESTION);
      else if (sensing || quantity === "temperature") unsupported.add(label);
    }
  }

  // Conditions on the environment: "when it gets dark", "if something comes close".
  for (const [word, label] of Object.entries(CONDITIONS)) {
    for (const i of matches(t, new RegExp(`\\b${word}\\b`))) {
      const prev = before(t, i, 4);
      const condition = prev.some((w) => ["when", "if", "once", "until", "whenever", "as"].includes(w)) && prev.some((w) => /^(gets|get|is|becomes|goes|comes|turns|it's)$/.test(w));
      if (!condition || negated(t, i)) continue;
      if (temperatureOk(label)) continue;
      if (notAir && label.startsWith("a temperature")) {
        unsupported.add(otherTemperatureSensor);
        continue;
      }
      // "when it gets warm" without a room, water, weather…: maybe the board's own; ask (principle 3).
      if (label.startsWith("a temperature") && !OUTSIDE_TEMPERATURE.test(t.joined)) ambiguous.add(TEMPERATURE_QUESTION);
      else unsupported.add(label);
    }
  }

  return { unsupported: [...unsupported], ambiguous: [...ambiguous] };
}

// ---------------------------------------------------------------- parts we support

// Each part pack's words (agent.json words), as whole-word patterns.
const escape = (w: string) => w.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
const wordsRe = (words: string[]) => new RegExp(`\\b(${words.map(escape).join("|")})\\b`);

const SIZE_UNITS = new Set(["inch", "inches", "mm", "cm"]);

const asNumber = (w: string | undefined): number | null => (w === undefined ? null : /^\d+$/.test(w) ? Number(w) : (NUMBERS[w] ?? null));

/**
 * A count directly in front of the noun ("3 LEDs", "two small knobs"), never from another phrase.
 * "2 or 3 LEDs" is a choice → { n: 3, or: 2 }.
 */
function numberBefore(t: Text, i: number): { n: number; or?: number } | null {
  let k = i - 1;
  for (let skipped = 0; k >= 0 && skipped < 3; skipped++) {
    const w = t.tokens[k]!;
    // A size between the count and the noun: "two 1.3 inch OLEDs", "3 16 mm buttons", "a 0.96 OLED".
    if (SIZE_UNITS.has(w) && k > 0 && /^\d+(·\d+)?$/.test(t.tokens[k - 1]!)) k -= 2;
    else if (/^\d+·\d+$/.test(w) || isModifier(w)) k--;
    else break;
  }
  const n = asNumber(t.tokens[k]);
  if (n === null) return null;
  const lower = t.tokens[k - 1] === "or" ? asNumber(t.tokens[k - 2]) : null;
  return lower !== null ? { n, or: lower } : { n };
}

/**
 * A further part of the same kind (principle 6c): "a second button", "the third LED", "another
 * knob", "the other button" mean at least that many, so "one button starts it, a second button
 * resets it" is 2 buttons, not exactly 1.
 */
const ORDINALS: Record<string, number> = { second: 2, "2nd": 2, third: 3, "3rd": 3, fourth: 4, "4th": 4, fifth: 5, "5th": 5, sixth: 6, "6th": 6, another: 2, other: 2 };

function ordinalBefore(t: Text, i: number): number {
  // Checked before modifiers are skipped: "2nd" looks like a technical modifier ("16x2").
  for (let k = i - 1, skipped = 0; k >= 0 && skipped <= 3; k--, skipped++) {
    const w = t.tokens[k]!;
    if (ORDINALS[w]) return ORDINALS[w]!;
    if (!isModifier(w)) break;
  }
  return 0;
}

/** Colors in front of an LED noun: "a red LED", "red, yellow and green LEDs", "a red blinking LED". */
function colorsBefore(t: Text, i: number): string[] {
  const colors: string[] = [];
  for (let k = i - 1; k >= 0; k--) {
    const w = t.tokens[k]!;
    if (COLORS.has(w)) colors.push(w);
    // "a red, a green and a blue LED": an article starting a list item belongs to the list.
    else if ((w === "a" || w === "an") && colors.length && [",", "and", "or"].includes(t.tokens[k - 1] ?? "") && COLORS.has(t.tokens[k - 2] ?? "")) continue;
    else if (w !== "," && w !== "and" && w !== "or" && !isModifier(w)) break;
  }
  return colors;
}

/** Words that make a negation a swap ("instead of the red LED", "rather than the green one"): no count changes. */
const SWAPS = new Set(["instead", "rather", "replace", "replacing", "swap", "swapping", "except"]);

/**
 * The negated noun picks out one part of several: a colour ("the green LED"), an ordinal ("the second
 * button", "the other knob") or "one" ("remove one LED", "remove one of the LEDs").
 */
function oneOfSeveral(t: Text, i: number, colors: boolean): boolean {
  if (colors && colorsBefore(t, i).length > 0) return true;
  if (ordinalBefore(t, i) > 0) return true;
  const near = before(t, i, 4);
  return near.includes("one") || near.includes("other") || near.includes("1");
}

function partsOf(t: Text): { parts: Requirements["parts"]; removed: PartKind[]; fewer: Partial<Record<PartKind, number>>; onboard: boolean; named: PartKind[] } {
  const parts: Requirements["parts"] = {};
  const removed = new Set<PartKind>();
  const fewer: Partial<Record<PartKind, number>> = {};
  const named = new Set<PartKind>();
  const impliedOnly: { kind: PartKind; unlessNamed: string[] }[] = [];
  let onboard = false;
  // A word inside another part's phrase belongs to that phrase: "slide switch" is the slide switch,
  // not also a button ("switch"); "slider switch" isn't a potentiometer ("slider").
  const phrases = AGENT_PACKS.flatMap((p) =>
    p.agent!.words.nouns.filter((n) => n.includes(" ")).flatMap((n) => matches(t, wordsRe([n])).map((i) => ({ kind: p.meta.kind!, from: i, to: i + n.split(" ").length - 1 }))),
  );
  const insideOtherPhrase = (kind: string, i: number) => phrases.some((s) => s.kind !== kind && i >= s.from && i <= s.to);

  for (const pack of AGENT_PACKS) {
    const kind = pack.meta.kind!;
    const w = pack.agent!.words;
    const ctx = w.nounContext;
    // A part type we can't wire (an LCD) is reported as unsupported; then the generic word ("on an
    // LCD display") doesn't also count as this part.
    const other = ctx?.unlessUnsupported ? !!strongEntry(ctx.unlessUnsupported)?.re.test(t.joined) : false;
    let min = 0;
    let further = 0;
    const counts: { n: number; or?: number }[] = [];
    const colors = new Set<string>();
    for (const i of matches(t, wordsRe(w.nouns))) {
      if (insideOtherPhrase(kind, i)) continue;
      const word = t.tokens[i]!;
      // "the on-board LED" is the board's own part.
      if (w.builtIn && before(t, i, 2).some((x) => ONBOARD.has(x))) {
        onboard = true;
        continue;
      }
      // "switch on" / "to display the time" / the computer's screen: only the noun is a part.
      if (ctx && (ctx.words ? ctx.words.includes(word) : !ctx.except!.includes(word))) {
        if (!nounContext(t, i) || (ctx.notAfterComputer && before(t, i, 3).some((x) => COMPUTER.test(x))) || other) continue;
      }
      if (negated(t, i)) {
        // "remove the green LED": one fewer, not "no LEDs at all". A swap ("instead of the red LED")
        // changes no count; "remove the button" / "no screen" still means none of that kind.
        if (oneOfSeveral(t, i, !!w.colors)) {
          if (!before(t, i, 5).some((x) => SWAPS.has(x))) fewer[kind] = (fewer[kind] ?? 0) + 1;
          continue;
        }
        removed.add(kind);
        continue;
      }
      named.add(kind);
      const count = numberBefore(t, i);
      if (count) counts.push(count);
      min = Math.max(min, count ? Math.min(count.n, count.or ?? count.n) : 1);
      further = Math.max(further, ordinalBefore(t, i));
      if (w.colors) colorsBefore(t, i).forEach((c) => colors.add(c));
    }
    // At least as many as the colors listed and the highest "second"/"another" mentioned. With those,
    // "one X" only names the first of them ("one button goes up, the other goes down"), not a count.
    const floor = Math.max(colors.size, further);
    min = Math.max(min, floor);
    if (further) counts.splice(0, counts.length, ...counts.filter((c) => c.n !== 1 || c.or !== undefined));
    const distinct = [...new Set(counts.map((c) => `${c.n}|${c.or ?? ""}`))];
    // Words that imply the part when none is named ("press" → a button, "blink" → an LED): decided
    // after every part is read, because a named part can be what those words describe.
    const implied = w.impliedBy;
    if (implied && min === 0 && !(w.builtIn && onboard) && !removed.has(kind) && wordsRe(implied.words).test(t.joined) && !(implied.unless && wordsRe(implied.unless).test(t.joined))) {
      impliedOnly.push({ kind, unlessNamed: implied.unlessNamed ?? [] });
    }
    if (min > 0) {
      const need: PartNeed = { min };
      // Exactly one clear number (repeated mentions of the same number are fine) → exact.
      if (distinct.length === 1) {
        const c = counts[0]!;
        if (c.or !== undefined) Object.assign(need, { min: Math.max(Math.min(c.n, c.or), floor), max: Math.max(c.n, c.or) });
        else if (c.n >= floor) Object.assign(need, { min: c.n, exact: c.n });
      }
      parts[kind] = need;
    }
  }
  // Implied parts: "the display blinks" describes the named display, not an LED (principle 10).
  for (const { kind, unlessNamed } of impliedOnly) if (!unlessNamed.some((k) => named.has(k))) parts[kind] = { min: 1 };
  return { parts, removed: [...removed], fewer, onboard, named: [...named] };
}

/** Common English function words: an idea with none of them is treated as another language. */
const ENGLISH = new Set("a an the and or to of in on at by for with when while if then until after before as is are be it its my me i we you this that each every one two three make use turn want how so like can will".split(" "));
const looksEnglish = (t: Text) => {
  const words = t.tokens.filter((w) => /^[a-z']+$/.test(w));
  return words.length > 0 && words.filter((w) => ENGLISH.has(w)).length / words.length >= 0.15;
};

// ---------------------------------------------------------------- pins

/** "GP15"/"GPIO 15" are clear. A bare "pin 15" could mean physical pin 15 (GP11) or GPIO 15: ask. */
function pinsOf(t: Text, board: Board): { pins: string[]; ambiguous: string[] } {
  const pins = new Set<string>();
  const ambiguous: string[] = [];
  for (const m of t.joined.matchAll(/\bgp(?:io)? ?(\d{1,2})\b/g)) pins.add(`GP${Number(m[1])}`);
  for (const m of t.joined.matchAll(/(?<!\bgp|\bgpio )\bpin (?:number )?(\d{1,2})\b/g)) {
    const phys = Number(m[1]);
    const pin = board.pins.find((p) => p.phys === phys);
    const asPhysical = pin ? `physical pin ${phys} (${pin.name})` : `physical pin ${phys} (the Pico has only 40)`;
    ambiguous.push(`You wrote "pin ${phys}". Do you mean ${asPhysical}, or GPIO ${phys} (GP${phys})? Please write it as GP${phys} or name the physical pin.`);
  }
  return { pins: [...pins], ambiguous };
}

// ---------------------------------------------------------------- public API

export function analyzeIdea(text: string, board?: Board): Requirements {
  const t = tokenize(text);
  const { unsupported, ambiguous } = unsupportedParts(t);
  const { parts, removed, fewer, onboard, named } = partsOf(t);
  // M15 (user, 11/11/2026): the air's temperature or humidity needs the temperature part; the chip's
  // own sensor only when the idea is about the chip. Humidity always needs the part.
  if (TEMPERATURE_PART && !parts[TEMPERATURE_PART as PartKind] && !removed.includes(TEMPERATURE_PART as PartKind)) {
    const asked = (re: RegExp) => matches(t, re).some((i) => !negated(t, i));
    if (asked(/\b(humidity|humid)\b/) || (asked(/\b(temperatures?|weather)\b/) && !chipTemperatureOnly(t))) parts[TEMPERATURE_PART as PartKind] = { min: 1 };
  }
  const pins = board ? pinsOf(t, board) : { pins: [], ambiguous: [] };
  // "an alarm" with no sound word: with a buzzer part it may mean a sound or only lights, so ask.
  if (SOUND_PART && !parts[SOUND_PART as PartKind] && !removed.includes(SOUND_PART as PartKind) && matches(t, /\balarms?\b/).some((i) => !negated(t, i))) ambiguous.push(ALARM_SOUND_QUESTION);
  const words = t.tokens.filter((w) => !PUNCT.has(w)).length;
  return { unsupported, ambiguous: [...ambiguous, ...pins.ambiguous], parts, removed, ...(Object.keys(fewer).length ? { fewer } : {}), pins: pins.pins, onboard, tooShort: words < 3, named, english: looksEnglish(t) };
}

/** Later text (feedback) overrides earlier text (the idea) part by part (principle 7). */
export function mergeRequirements(base: Requirements, later: Requirements): Requirements {
  const parts = { ...base.parts };
  for (const k of later.removed) delete parts[k];
  // "remove the green LED": the earlier count goes down; none left → the kind is no longer asked for.
  for (const [k, n] of Object.entries(later.fewer ?? {}) as [PartKind, number][]) {
    const need = parts[k];
    if (!need || later.parts[k]) continue;
    const min = Math.max(0, need.min - n);
    if (min === 0) delete parts[k];
    else parts[k] = { min, ...(need.max !== undefined ? { max: Math.max(min, need.max - n) } : {}), ...(need.exact !== undefined ? { exact: Math.max(min, need.exact - n) } : {}) };
  }
  Object.assign(parts, later.parts);
  return {
    unsupported: [...new Set([...base.unsupported, ...later.unsupported])],
    ambiguous: later.ambiguous,
    parts,
    removed: [...new Set([...base.removed.filter((k) => !later.parts[k]), ...later.removed])],
    pins: [...new Set([...base.pins, ...later.pins])],
    onboard: base.onboard || later.onboard,
    tooShort: base.tooShort && later.tooShort,
    named: [...new Set([...base.named, ...later.named])],
    english: base.english && later.english,
  };
}

/** Problems with a plan, phrased for the repair prompt. Empty = the plan covers the request. */
export function planProblems(plan: Plan, req: Requirements): string[] {
  const problems: string[] = [];
  for (const [kind, need] of Object.entries(req.parts) as [PartKind, PartNeed][]) {
    const have = plan.parts.filter((p) => p.kind === kind).length;
    const [one, many] = agentOf(kind).names.label;
    const word = (n: number) => (n === 1 ? one.replace(/^an? /, "") : many);
    if (need.exact !== undefined && have !== need.exact) {
      problems.push(`The request asks for exactly ${need.exact} ${word(need.exact)}, but the plan has ${have}. Use exactly ${need.exact} parts of kind "${kind}".`);
    } else if (have < need.min) {
      problems.push(`The request mentions ${need.min === 1 ? one : `${need.min} ${many}`}, but the plan has ${have === 0 ? "none" : have}. Add ${need.min - have} part(s) of kind "${kind}".`);
    } else if (need.max !== undefined && have > need.max) {
      problems.push(`The request asks for at most ${need.max} ${many}, but the plan has ${have}. Remove ${have - need.max} part(s) of kind "${kind}".`);
    }
  }
  for (const kind of req.removed) {
    if (plan.parts.some((p) => p.kind === kind)) problems.push(`The user doesn't want any part of kind "${kind}". Remove it from the plan.`);
  }
  // Principle 8: an idea that names its parts (or only the on-board LED) gets nothing extra.
  if ((req.named.length || req.onboard) && req.english && !req.tooShort) {
    for (const kind of new Set(plan.parts.map((p) => p.kind))) {
      if (!req.parts[kind] && !req.removed.includes(kind)) {
        problems.push(`The request doesn't ask for any part of kind "${kind}". Only use the parts the request asks for; remove the ${agentOf(kind).names.label[1]}.`);
      }
    }
  }
  if (plan.parts.length === 0 && !req.onboard) {
    problems.push(`The plan has no parts. Add at least one ${joinList(AGENT_PACKS.flatMap((p) => (p.agent!.names.short ? [p.agent!.names.short[0]] : [])), "or")} (a plan with no parts is only right for projects that use the Pico's on-board LED).`);
  }
  return problems;
}

export function unsupportedMessage(found: string[]): string {
  const supports = joinList(AGENT_PACKS.flatMap((p) => (p.agent!.names.supports ? [p.agent!.names.supports] : [])), "and");
  return `This project needs ${found.join(", ")}, which the builder can't wire yet. For now it supports ${supports}, plus the Pico's own LED, temperature sensor and Wi-Fi.`;
}

/** The minimum parts the request needs, as layout requests (used to detect impossible requests early). */
export function minimumParts(req: Requirements): { kind: PartKind }[] {
  return (Object.entries(req.parts) as [PartKind, PartNeed][]).flatMap(([kind, need]) => Array.from({ length: need.min }, () => ({ kind })));
}
