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
  // The passive buzzer (M15) plays tones; recorded sound or speech still needs a speaker.
  { id: "speaker", re: /\b(speakers?|headphones?)\b/, label: "a speaker or headphones (for recorded sound or speech; the buzzer only plays tones)" },
  {
    id: "displays",
    re: /\b(lcds?|tfts?|e-?ink|e-?paper|7-?segment|seven-?segment|(led|dot) matrix|matrix displays?|touch ?screens?|colou?r (screens?|displays?)|(?!128 ?x ?64\b)\d+ ?x ?\d+ (screens?|displays?))\b/,
    label: UNSUPPORTED_DISPLAY,
  },
  { id: "rgb", re: /\b(neopixels?|ws2812b?|rgb (leds?|strips?)|led strips?)\b/, label: "RGB or addressable LEDs" },
  // The DHT11 (and a plain "DHT", "humidity", "thermometer") can be a part (M15: the dht11 pack claims
  // it); other temperature sensors stay unsupported.
  { id: "dht11", re: /\b(dhts?|dht-?11s?|humidity|hygrometers?|thermometers?)\b/, label: "a temperature or humidity sensor" },
  // M17 17.1 (17/11/2026): the DHT22 and the NTC thermistor have packs (they claim these entries);
  // the other temperature sensors, soil moisture and Hall sensors stay unsupported.
  { id: "dht22", re: /\b(dht-?22s?|am2302s?)\b/, label: "a DHT22 temperature and humidity sensor" },
  { id: "thermistor", re: /\b(thermistors?|ntcs?)\b/, label: "a thermistor" },
  { id: "ds18b20", re: /\b(ds18b20s?)\b/, label: "a DS18B20 temperature sensor" },
  { id: "bme280", re: /\b(bme280s?|bmp280s?)\b/, label: "a BME280 or BMP280 pressure sensor" },
  { id: "temperature", re: /\b(dht-?(1[02-9]|2[013-9]|[3-9]\d)s?|bme(?!280)\d+|bmp(?!280)\d+|lm35|tmp36|max6675|thermocouples?)\b/, label: "a temperature sensor other than the DHT11, DHT22, DS18B20 or BME280 (such as a TMP36 or a thermocouple)" },
  { id: "moisture", re: /\b(moisture)\b/, label: "a soil moisture sensor" },
  { id: "hall", re: /\b(hall(-| )effect|hall sensors?|a3144)\b/, label: "a Hall (magnet) sensor" },
  { id: "distance", re: /\b(ultrasonic|hc-?sr04|lidar)\b/, label: "a distance sensor" },
  { id: "imu", re: /\b(accelerometers?|gyroscopes?|gyros?|imus?|mpu-?6050s?|gy-?521)\b/, label: "an accelerometer or gyroscope" },
  { id: "motion", re: /\b(pir|mpu-?(?!6050)\d+)\b/, label: "a motion sensor" },
  { id: "light", re: /\b(ldr|photoresistors?|photocells?|light sensors?)\b/, label: "a light sensor" },
  { id: "microphone", re: /\b(microphones?|mics?)\b/, label: "a microphone" },
  { id: "relay", re: /\b(relays?|solenoids?|pumps?|heaters?|light ?bulbs?|mains|230 ?v|110 ?v|120 ?v)\b/, label: "a relay or high-power device" },
  { id: "touch", re: /\b(touch sensors?|touch pads?|capacitive touch|ttp223)\b/, label: "a touch sensor" },
  { id: "input", re: /\b(keypads?|joysticks?|rotary encoders?)\b/, label: "an input module that isn't supported yet" },
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
  { id: "speaker", text: "speakers for recorded sound or speech" },
  { id: "displays", text: "other displays like LCD, TFT, e-ink, 7-segment, color or touch screens" },
  { id: "distance", text: "distance sensors" },
  { id: "light", text: "light sensors" },
  { id: "motion", text: "motion sensors" },
  { id: "temperature-sensing", text: "temperature or humidity sensors" },
  { id: "dht22", text: "the DHT22" },
  { id: "thermistor", text: "thermistors" },
  { id: "ds18b20", text: "the DS18B20" },
  { id: "bme280", text: "pressure sensors (BME280)" },
  { id: "imu", text: "accelerometers and gyroscopes" },
  { id: "temperature", text: "other temperature sensors (TMP36, thermocouples)" },
  { id: "moisture", text: "soil moisture sensors" },
  { id: "hall", text: "Hall (magnet) sensors" },
  { id: "touch", text: "touch sensors" },
  { id: "relay", text: "relays" },
  { id: "input", text: "keypads" },
];

/**
 * Things an idea can ask to sense ("detect water", "when it gets dark", requirements.ts QUANTITIES and
 * CONDITIONS). A pack that claims one is added to the plan for it instead of the idea being refused
 * (M17). "temperature-sensor": the pack measures temperature too, so naming it is enough for a
 * temperature idea (the DHT11 isn't added on top).
 */
export const SENSED_IDS = ["light-level", "sound-level", "water", "nearby", "flame", "distance", "motion", "pressure", "gas", "moisture", "vibration", "imu", "temperature-sensor"] as const;
export type SensedId = (typeof SENSED_IDS)[number];

export const VOCABULARY_IDS = new Set([...[...STRONG, ...CONTEXTUAL, SOUND_VERBS, ...NOT_AVAILABLE].map((e) => e.id), ...SENSED_IDS]);

/** The part kind whose pack claims this vocabulary id, if any. */
export const kindClaiming = (id: string) => PACKS.find((p) => p.agent?.words.claims?.includes(id))?.meta.kind;

/**
 * The part kind that measures the air's temperature and humidity, when a pack claims
 * "temperature-sensing" (M15: the DHT11). Then "the room temperature", "humidity" or a bare
 * "temperature" mean that part, not "unsupported"; the Pico's own chip sensor is used only when the
 * idea is about the chip (requirements.ts, user 11/11/2026).
 */
export const SOUND_PART = PACKS.find((p) => p.agent?.words.claims?.includes("sound"))?.meta.kind;

/** With a buzzer part (M15), "alarm" alone may or may not mean sound: ask (principle 3). */
export const ALARM_SOUND_QUESTION = "Your idea mentions an alarm. Should it sound with the buzzer, or only light up LEDs?";

export const TEMPERATURE_PART = PACKS.find((p) => p.agent?.words.claims?.includes("temperature-sensing"))?.meta.kind;

const claimed = new Set(PACKS.flatMap((p) => p.agent?.words.claims ?? []));
const open = <T extends { id: string }>(xs: T[]) => xs.filter((x) => !claimed.has(x.id));

export const STRONG_WORDS = open(STRONG);
export const CONTEXTUAL_WORDS = open(CONTEXTUAL);
export const SOUND_VERB_WORDS = open([SOUND_VERBS]);
export const NOT_AVAILABLE_TEXT = open(NOT_AVAILABLE).map((x) => x.text);

/** Every strong entry, claimed or not (to tell "an LCD display" apart from our display). */
export const strongEntry = (id: string) => STRONG.find((e) => e.id === id);
