// Hardware the builder can't wire, for the idea rules (requirements.ts) and the prompts. This is
// engine vocabulary, not part data: a part pack makes an entry supported by naming its id in
// agent.json `words.claims` (e.g. a buzzer pack claims "buzzer" and "sound"). Unclaimed entries
// keep their exact wording.
import { PACKS } from "@breadpilot/circuit-core";

/** The only display we can wire is the 1.3" I2C OLED; other kinds are named with this label. */
export const UNSUPPORTED_DISPLAY = 'a display other than the 1.3" I2C OLED (LCD, TFT, e-ink, segment, colour or touch screens)';

/** Component names that are never one of our parts (principle 1). */
const STRONG: { id: string; re: RegExp; label: string }[] = [
  { id: "motors", re: /\b(motors?|servos?|steppers?)\b/, label: "motors or servos" },
  { id: "buzzer", re: /\b(buzzers?|piezos?)\b/, label: "a buzzer or speaker" },
  { id: "speaker", re: /\b(speakers?|headphones?)\b/, label: "a buzzer or speaker" },
  {
    id: "displays",
    re: /\b(lcds?|tfts?|e-?ink|e-?paper|7-?segment|seven-?segment|(led|dot) matrix|matrix displays?|touch ?screens?|colou?r (screens?|displays?)|(?!128 ?x ?64\b)\d+ ?x ?\d+ (screens?|displays?))\b/,
    label: UNSUPPORTED_DISPLAY,
  },
  { id: "rgb", re: /\b(neopixels?|ws2812b?|rgb (leds?|strips?)|led strips?)\b/, label: "RGB or addressable LEDs" },
  { id: "temperature", re: /\b(dht\d*|bme\d+|bmp\d+|ds18b20|thermistors?|thermometers?|humidity|hygrometers?|moisture)\b/, label: "a temperature or humidity sensor" },
  { id: "distance", re: /\b(ultrasonic|hc-?sr04|lidar)\b/, label: "a distance sensor" },
  { id: "motion", re: /\b(pir|accelerometers?|gyroscopes?|gyros?|imu|mpu-?\d+)\b/, label: "a motion sensor" },
  { id: "light", re: /\b(ldr|photoresistors?|photocells?|light sensors?)\b/, label: "a light sensor" },
  { id: "microphone", re: /\b(microphones?|mics?)\b/, label: "a microphone" },
  { id: "relay", re: /\b(relays?|solenoids?|pumps?|heaters?|light ?bulbs?|mains|230 ?v|110 ?v|120 ?v)\b/, label: "a relay or high-power device" },
  { id: "input", re: /\b(keypads?|joysticks?|rotary encoders?|touch sensors?|capacitive)\b/, label: "an input module that isn't supported yet" },
  { id: "module", re: /\b(cameras?|rfid|nfc|gps|sd cards?|lasers?)\b/, label: "a module that isn't supported yet" },
];

/**
 * Words that are components only in context (principle 2): used as a noun, after a "make/play"
 * verb, or before "sensor". `ok` = supported exception. `question` = ask instead of blocking.
 */
const CONTEXTUAL: { id: string; re: RegExp; label: string; ok?: "onboard"; question?: { word: string; text: string } }[] = [
  {
    id: "sound",
    re: /\b(sound|sounds|tone|tones|tune|tunes|melody|melodies|music|song|songs|noise|beep|beeps|alarm)\b/,
    label: "a buzzer or speaker",
    // "alarm" is too broad to block on ("an alarm with LEDs"): ask instead (principle 3).
    question: { word: "alarm", text: "Your idea mentions an alarm. Should it make a sound (needs a buzzer, not supported yet) or only light up LEDs?" },
  },
  { id: "fan", re: /\b(fans?)\b/, label: "a fan (needs a driver)" },
  { id: "sensor", re: /\b(sensors?)\b/, label: "a sensor", ok: "onboard" },
];

/** "the LED beeps", "it buzzes when…" */
const SOUND_VERBS = { id: "sound", re: /\b(beeps|beeping|buzzes|buzzing|chimes|chiming|rings|ringing)\b/, label: "a buzzer or speaker" };

/** The prompt's "Anything else (…) is NOT available" list. */
const NOT_AVAILABLE: { id: string; text: string }[] = [
  { id: "motors", text: "motors" },
  { id: "motors", text: "servos" },
  { id: "buzzer", text: "buzzers" },
  { id: "speaker", text: "speakers" },
  { id: "displays", text: "other displays like LCD, TFT, e-ink, 7-segment, color or touch screens" },
  { id: "sensors", text: "sensors for temperature, distance, light or motion" },
  { id: "relay", text: "relays" },
  { id: "input", text: "keypads" },
];

export const VOCABULARY_IDS = new Set([...STRONG, ...CONTEXTUAL, SOUND_VERBS, ...NOT_AVAILABLE].map((e) => e.id));

const claimed = new Set(PACKS.flatMap((p) => p.agent?.words.claims ?? []));
const open = <T extends { id: string }>(xs: T[]) => xs.filter((x) => !claimed.has(x.id));

export const STRONG_WORDS = open(STRONG);
export const CONTEXTUAL_WORDS = open(CONTEXTUAL);
export const SOUND_VERB_WORDS = open([SOUND_VERBS]);
export const NOT_AVAILABLE_TEXT = open(NOT_AVAILABLE).map((x) => x.text);

/** Every strong entry, claimed or not (to tell "an LCD display" apart from our display). */
export const strongEntry = (id: string) => STRONG.find((e) => e.id === id);
