// 3D models of parts whose pack isn't written yet (PLAN §13.12, phases 17.1 to 17.7: all 46). Each `view` is in the
// view.json format: when the part's pack is made, it moves there unchanged and its entry here is
// removed. `legs` are only the holes the preview stands in (the pack's layout.json decides the
// real ones); pin names and orders are the usual ones for these parts until the exact module is
// chosen. No size here is measured.
import type { Column, ComponentDef, ResolvedPart, ViewSpec } from "@breadpilot/circuit-core";

export interface UpcomingModel {
  id: string;
  name: string;
  view: ViewSpec;
  /** Leg → hole: [rows below the preview's first row, column]. */
  legs: Record<string, [number, Column]>;
}

const NOTE = "Not measured: the usual size of this part.";
const BLUE = "#1d3c8f";
const PURPLE = "#5b2a86";
const RED = "#a8242b";
const GREEN = "#35d04f";
const POWER = "#ff4a3d";

/** A row of legs in next-to-each-other rows of one column. */
const inRow = (ids: string[], col: Column = "f"): Record<string, [number, Column]> => Object.fromEntries(ids.map((id, i) => [id, [i, col]]));

export const UPCOMING_MODELS: UpcomingModel[] = [
  {
    id: "rgb-led",
    name: "RGB LED",
    view: { shape: "rgb-led", legs: ["red", "common", "green", "blue"], body: "#f4f6f8", note: NOTE },
    legs: inRow(["red", "common", "green", "blue"], "g"),
  },
  {
    id: "hc-sr04",
    name: "Ultrasonic distance sensor (HC-SR04)",
    view: {
      shape: "upright-module",
      pins: ["vcc", "trig", "echo", "gnd"],
      board: { size: [45, 20], color: BLUE, note: NOTE },
      hole: false,
      features: [
        { type: "transducer", at: [-13, 11], radius: 8, height: 12 },
        { type: "transducer", at: [13, 11], radius: 8, height: 12 },
        { type: "crystal", at: [0, 16.5] },
      ],
      labels: ["VCC", "TRIG", "ECHO", "GND"],
    },
    legs: inRow(["vcc", "trig", "echo", "gnd"]),
  },
  {
    id: "joystick",
    name: "Joystick module",
    view: {
      shape: "upright-module",
      pins: ["gnd", "vcc", "vrx", "vry", "sw"],
      board: { size: [26, 34], color: "#22252b", note: NOTE },
      hole: false,
      features: [{ type: "stick", at: [0, 21] }],
      labels: ["GND", "+5V", "VRx", "VRy", "SW"],
    },
    legs: inRow(["gnd", "vcc", "vrx", "vry", "sw"]),
  },
  {
    id: "rotary-encoder",
    name: "Rotary encoder",
    view: {
      shape: "upright-module",
      pins: ["clk", "dt", "sw", "vcc", "gnd"],
      board: { size: [19, 26], color: "#22252b", note: NOTE },
      hole: false,
      features: [
        { type: "resistor", at: [-6.5, 9] },
        { type: "resistor", at: [6.5, 9] },
        { type: "encoder", at: [0, 17] },
      ],
      labels: ["CLK", "DT", "SW", "+", "GND"],
    },
    legs: inRow(["clk", "dt", "sw", "vcc", "gnd"]),
  },
  {
    id: "keypad-4x4",
    name: "4x4 keypad",
    view: {
      shape: "keypad",
      pins: ["r1", "r2", "r3", "r4", "c1", "c2", "c3", "c4"],
      size: [69, 77],
      keys: [["1", "2", "3", "A"], ["4", "5", "6", "B"], ["7", "8", "9", "C"], ["*", "0", "#", "D"]],
      body: "#1c1d21",
      key: "#2f6fd6",
      accent: "#d93a3a",
      note: NOTE,
    },
    legs: inRow(["r1", "r2", "r3", "r4", "c1", "c2", "c3", "c4"], "g"),
  },
  {
    id: "seven-segment",
    name: "7-segment digit",
    view: { shape: "seven-segment", pins: ["e", "d", "com1", "c", "dp", "b", "a", "com2", "f", "g"], size: [12.6, 19, 8], body: "#e8e8e4", face: "#17181b", lit: "#ff3b30", note: NOTE },
    // pins 1-5 along one side of the channel, 6-10 back along the other
    legs: { e: [0, "d"], d: [1, "d"], com1: [2, "d"], c: [3, "d"], dp: [4, "d"], b: [4, "h"], a: [3, "h"], com2: [2, "h"], f: [1, "h"], g: [0, "h"] },
  },
  {
    id: "tm1637-display",
    name: "4-digit display (TM1637)",
    view: {
      shape: "upright-module",
      pins: ["clk", "dio", "vcc", "gnd"],
      board: { size: [42, 24], color: BLUE, note: NOTE },
      hole: false,
      features: [{ type: "digits", at: [0, 15.5], size: [30, 14], count: 4, color: "#ff3b30", colon: true }],
      labels: ["CLK", "DIO", "VCC", "GND"],
    },
    legs: inRow(["clk", "dio", "vcc", "gnd"]),
  },
  {
    id: "traffic-light",
    name: "Traffic light module",
    view: {
      shape: "upright-module",
      pins: ["gnd", "r", "y", "g"],
      board: { size: [21, 56], color: "#22252b", note: NOTE },
      hole: false,
      features: [
        { type: "lamp", at: [0, 46], radius: 4, color: "#ff3b30" },
        { type: "lamp", at: [0, 33], radius: 4, color: "#ffd21f" },
        { type: "lamp", at: [0, 20], radius: 4, color: GREEN },
        { type: "resistor", at: [-7, 11] },
        { type: "resistor", at: [0, 11] },
        { type: "resistor", at: [7, 11] },
      ],
      labels: ["GND", "R", "Y", "G"],
    },
    legs: inRow(["gnd", "r", "y", "g"]),
  },
  // ---- phase 17.3: parts on the shared I2C bus ----
  {
    id: "vl53l0x",
    name: "Laser distance sensor (VL53L0X)",
    view: {
      shape: "header-module",
      pins: ["vin", "gnd", "scl", "sda", "gpio1", "xshut"],
      board: { size: [10.7, 25], height: 8.5, color: "#22252b", note: NOTE },
      holes: false,
      features: [
        { type: "sensor", at: [0, 6.6], size: [4.4, 2.4], color: "#101114" },
        { type: "resistor", at: [-5, 6.6] },
        { type: "resistor", at: [5, 6.6] },
        { type: "hole", at: [-10.4, 5.4], radius: 1.4 },
        { type: "hole", at: [10.4, 5.4], radius: 1.4 },
      ],
    },
    legs: inRow(["vin", "gnd", "scl", "sda", "gpio1", "xshut"]),
  },
  // ---- phase 17.4: 1-Wire ----
  // ---- phase 17.5: basic parts ----
  {
    id: "diode-1n4007",
    name: "Diode (1N4007)",
    view: { shape: "diode", legs: ["anode", "cathode"], size: [5.2, 1.35], body: "#17181b", band: "#c9cdd3", note: NOTE },
    legs: { anode: [0, "g"], cathode: [4, "g"] },
  },
  {
    id: "electrolytic-capacitor",
    name: "Electrolytic capacitor",
    view: { shape: "can-capacitor", legs: ["plus", "minus"], radius: 2.5, height: 11, color: "#1f3f8f", stripe: "#d9dde3", note: NOTE },
    legs: inRow(["plus", "minus"], "g"),
  },
  {
    id: "ceramic-capacitor",
    name: "Ceramic capacitor",
    view: { shape: "disc-capacitor", legs: ["a", "b"], radius: 2.6, color: "#d9a441", label: "104", note: NOTE },
    legs: { a: [0, "g"], b: [2, "g"] },
  },
  {
    id: "npn-transistor",
    name: "NPN transistor",
    // The printed name and the leg order depend on the type that is chosen later.
    view: { shape: "to92", legs: ["e", "b", "c"], color: "#17181b", label: "NPN", note: NOTE },
    legs: inRow(["e", "b", "c"], "g"),
  },
  {
    id: "logic-mosfet",
    name: "Logic-level MOSFET",
    view: { shape: "to220", legs: ["g", "d", "s"], color: "#17181b", label: "MOSFET", note: NOTE },
    legs: inRow(["g", "d", "s"], "g"),
  },
  // ---- phase 17.6: 5 V parts and parts that need a driver ----
  {
    id: "servo-sg90",
    name: "Servo (SG90)",
    view: { shape: "tethered", pins: ["signal", "vcc", "gnd"], wires: ["#f08a24", "#d93a3a", "#6b4423"], plug: true, unit: { type: "servo", color: "#2a6fe0" }, note: NOTE },
    legs: inRow(["signal", "vcc", "gnd"], "g"),
  },
  {
    id: "relay-module",
    name: "Relay module",
    view: {
      shape: "upright-module",
      pins: ["vcc", "gnd", "in"],
      board: { size: [26, 50], color: BLUE, note: NOTE },
      hole: false,
      features: [
        { type: "led", at: [-9.5, 9.5], color: POWER },
        { type: "resistor", at: [-9.5, 13] },
        { type: "to92", at: [8, 13] },
        { type: "relay", at: [0, 26] },
        { type: "terminal", at: [0, 43], ways: 3 },
      ],
      labels: ["VCC", "GND", "IN"],
    },
    legs: inRow(["vcc", "gnd", "in"]),
  },
  {
    id: "dc-motor",
    name: "DC motor",
    view: { shape: "tethered", pins: ["a", "b"], wires: ["#d93a3a", "#2a2c31"], unit: { type: "dc-motor" }, note: NOTE },
    legs: { a: [0, "g"], b: [2, "g"] },
  },
  {
    id: "stepper-28byj-48",
    name: "Stepper motor (28BYJ-48) and driver",
    view: { shape: "tethered", pins: ["in1", "in2", "in3", "in4", "vcc", "gnd"], wires: ["#f2d21b", "#f07d12", "#35d04f", "#2f6fd6", "#d93a3a", "#2a2c31"], unit: { type: "stepper", board: "#1f6b3a" }, note: NOTE },
    legs: inRow(["in1", "in2", "in3", "in4", "vcc", "gnd"], "g"),
  },
  {
    id: "neopixel-stick",
    name: "RGB LED stick (WS2812B)",
    view: {
      shape: "upright-module",
      pins: ["gnd", "din", "vcc", "gnd2"],
      board: { size: [51, 10.2], color: "#17181b", note: NOTE },
      hole: false,
      features: ["#ff3b30", "#ff9a1f", "#ffd21f", "#35d04f", "#22c7d6", "#2f7bff", "#8a4bff", "#ff4fa3"].map((color, i) => ({ type: "pixel" as const, at: [(i - 3.5) * 6.2, 6] as [number, number], color })),
    },
    legs: inRow(["gnd", "din", "vcc", "gnd2"]),
  },
  {
    id: "pir-hc-sr501",
    name: "Motion sensor (HC-SR501)",
    view: {
      shape: "header-module",
      pins: ["vcc", "out", "gnd"],
      board: { size: [24, 32], height: 8.5, color: "#1f6b3a", note: NOTE },
      features: [{ type: "dome", at: [0, 12.5], radius: 11.5 }],
    },
    legs: inRow(["vcc", "out", "gnd"]),
  },
  {
    id: "lcd-1602-i2c",
    name: "LCD 16x2 (I2C)",
    view: { shape: "tethered", pins: ["gnd", "vcc", "sda", "scl"], wires: ["#2a2c31", "#d93a3a", "#35d04f", "#f2d21b"], unit: { type: "lcd", board: "#1f6b3a", screen: "#1d4fd8", lines: ["Hello, world!", "BreadPilot"] }, note: NOTE },
    legs: inRow(["gnd", "vcc", "sda", "scl"], "g"),
  },
  {
    id: "vibration-motor",
    name: "Vibration motor",
    view: { shape: "tethered", pins: ["a", "b"], wires: ["#d93a3a", "#2f6fd6"], unit: { type: "coin-motor" }, note: NOTE },
    legs: inRow(["a", "b"], "g"),
  },
  // ---- phase 17.7: SPI and UART parts ----
  {
    id: "matrix-max7219",
    name: "8x8 LED matrix (MAX7219)",
    view: {
      shape: "upright-module",
      pins: ["vcc", "gnd", "din", "cs", "clk"],
      board: { size: [32, 52], color: BLUE, note: NOTE },
      hole: false,
      features: [
        { type: "sensor", at: [0, 12.2], size: [20, 6.6], color: "#17181b" },
        { type: "matrix", at: [0, 34.5], size: 32, color: "#ff3b30", rows: [".##..##.", "########", "########", "########", ".######.", "..####..", "...##...", "........"] },
      ],
      labels: ["VCC", "GND", "DIN", "CS", "CLK"],
    },
    legs: inRow(["vcc", "gnd", "din", "cs", "clk"]),
  },
  {
    id: "rfid-rc522",
    name: "RFID reader (RC522)",
    view: {
      shape: "header-module",
      pins: ["sda", "sck", "mosi", "miso", "irq", "gnd", "rst", "vcc"],
      board: { size: [60, 40], height: 8.5, color: BLUE, note: NOTE },
      features: [
        { type: "sensor", at: [-6, 15], size: [5, 5], color: "#17181b" },
        { type: "crystal", at: [8, 14] },
        { type: "resistor", at: [0, 11] },
        { type: "led", at: [14, 11], color: POWER },
        { type: "coil", at: [0, 39], size: [33, 31] },
      ],
      labels: true,
    },
    legs: inRow(["sda", "sck", "mosi", "miso", "irq", "gnd", "rst", "vcc"]),
  },
  {
    id: "sd-card-module",
    name: "Micro SD card module",
    view: {
      shape: "upright-module",
      pins: ["cs", "sck", "mosi", "miso", "vcc", "gnd"],
      board: { size: [24, 42], color: BLUE, note: NOTE },
      hole: false,
      features: [
        { type: "chip", at: [-5, 13.5] },
        { type: "to92", at: [6.5, 14.5] },
        { type: "resistor", at: [0, 20] },
        { type: "sd-slot", at: [0, 31] },
      ],
      labels: ["CS", "SCK", "MOSI", "MISO", "VCC", "GND"],
    },
    legs: inRow(["cs", "sck", "mosi", "miso", "vcc", "gnd"]),
  },
  {
    id: "tft-st7735",
    name: "Colour display 1.8\" (ST7735)",
    view: {
      shape: "header-module",
      pins: ["led", "sck", "sda", "a0", "reset", "cs", "gnd", "vcc"],
      board: { size: [58, 35], height: 8.5, color: RED, note: NOTE },
      features: [{ type: "tft", at: [0, 33.5], size: [31, 39] }],
      labels: true,
    },
    legs: inRow(["led", "sck", "sda", "a0", "reset", "cs", "gnd", "vcc"]),
  },
  {
    id: "gps-neo-6m",
    name: "GPS module (NEO-6M)",
    view: {
      shape: "header-module",
      pins: ["vcc", "rx", "tx", "gnd"],
      board: { size: [36, 26], height: 8.5, color: BLUE, note: NOTE },
      holes: false,
      features: [
        { type: "shield", at: [0, 10.5], size: [16, 12] },
        { type: "led", at: [10.5, 8], color: GREEN },
        { type: "patch", at: [0, 28], size: 22 },
      ],
    },
    legs: inRow(["vcc", "rx", "tx", "gnd"]),
  },
];

/**
 * The models in the lists the parts dialog shows one at a time: every preview is its own 3D canvas
 * and a browser keeps only about 16 of them alive, so no list may be longer than that.
 */
/**
 * The "Coming next" lists, by the phase each model belongs to. A model leaves this file when its
 * pack is made (M17), and a list with no models left isn't shown.
 */
const GROUPS: { id: string; label: string; ids: string[] }[] = [
  { id: "multi-pin", label: "Next: several pins", ids: ["rgb-led", "hc-sr04", "joystick", "rotary-encoder", "keypad-4x4", "seven-segment", "tm1637-display", "traffic-light"] },
  { id: "i2c", label: "Next: I2C and 1-Wire", ids: ["vl53l0x"] },
  { id: "basic", label: "Next: basic parts", ids: ["diode-1n4007", "electrolytic-capacitor", "ceramic-capacitor", "npn-transistor", "logic-mosfet"] },
  { id: "power", label: "Next: motors and 5 V parts", ids: ["servo-sg90", "relay-module", "dc-motor", "stepper-28byj-48", "neopixel-stick", "pir-hc-sr501", "lcd-1602-i2c", "vibration-motor"] },
  { id: "spi", label: "Next: SPI and UART", ids: ["matrix-max7219", "rfid-rc522", "sd-card-module", "tft-st7735", "gps-neo-6m"] },
];

export const UPCOMING_GROUPS: { id: string; label: string; models: UpcomingModel[] }[] = GROUPS.map((g) => ({
  id: g.id,
  label: g.label,
  models: UPCOMING_MODELS.filter((m) => g.ids.includes(m.id)),
})).filter((g) => g.models.length > 0);

/** The first row a preview model stands in (below the Pico, like real parts). */
const FIRST_ROW = 30;

/** The model as a placed part, so the scene can draw it like any other. */
export function upcomingPart(m: UpcomingModel): ResolvedPart {
  const def: ComponentDef = { id: m.id, name: m.name, category: "upcoming", legs: [], elements: [] };
  return { ref: m.id, def, legs: Object.fromEntries(Object.entries(m.legs).map(([id, [row, col]]) => [id, { row: FIRST_ROW + row, col }])), props: {} };
}
