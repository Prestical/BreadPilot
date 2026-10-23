// ---------- Board ----------
export type PinType = "gpio" | "ground" | "power" | "control" | "reference";

export interface DocRef {
  doc: string;
  page: number;
  section?: string;
}

export interface BoardPin {
  phys: number;
  name: string;
  type: PinType;
  aliases?: string[];
  gpio?: number;
  adc?: number;
  functions?: string[];
  defaultFunctions?: string[];
  voltage?: number;
  voltageRange?: [number, number];
  maxLoadMa?: number;
  description?: string;
  src: DocRef[];
}

export interface Board {
  id: string;
  name: string;
  variants: string[];
  electrical: { logicVoltage: number; gpioMaxInputVoltage: number; adcPinMaxInputVoltage: number };
  internalGpio: { name: string; use: string }[];
  pins: BoardPin[];
}

// ---------- Breadboard ----------
export type Column = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h" | "i" | "j";
export type Side = "L" | "R";
export type RailId = "RL+" | "RL-" | "RR+" | "RR-";

export interface Hole {
  row: number;
  col: Column;
}

// ---------- Components ----------
export type LegKind = "power_in" | "ground" | "digital_in" | "digital_out" | "analog_out" | "i2c_sda" | "i2c_scl";

export interface LegDef {
  id: string;
  label: string;
  kind?: LegKind;
  /**
   * "vcc": the line can reach the component's supply voltage (a digital_out swings to it; an
   * I2C line may be pulled up to it on the module).
   */
  level?: "vcc";
  voltageRange?: [number, number];
  /** power_in legs: the highest supply that is safe for the Pico (E014), when lower than voltageRange allows. */
  maxSafeVoltage?: number;
  highCurrent?: boolean;
}

export type ElementKind = "led" | "resistor" | "switch" | "short" | "load";

export interface ElementDef {
  kind: ElementKind;
  /** For "led": a = anode, b = cathode. */
  a: string;
  b: string;
  currentMa?: number;
}

export interface ComponentDef {
  id: string;
  name: string;
  category: string;
  legs: LegDef[];
  elements: ElementDef[];
  props?: Record<string, { enum?: string[]; type?: string; default: string | number }>;
  specs?: Record<string, unknown>;
}

// ---------- Build (what the user builds on the breadboard) ----------
export type GpioMode =
  | "out"
  | "pwm"
  | "in"
  | "in_pullup"
  | "in_pulldown"
  | "adc"
  | `i2c${0 | 1}_${"sda" | "scl"}`
  | `spi${0 | 1}_${"rx" | "tx" | "sck" | "csn"}`
  | `uart${0 | 1}_${"tx" | "rx"}`;

export interface Part {
  /** Reference designator, e.g. "LED1", "R1", "BTN1". */
  ref: string;
  /** Component id from the catalog, e.g. "led-5mm". */
  type: string;
  /** Leg id → hole, e.g. { anode: "27g", cathode: "28g" }. */
  legs: Record<string, string>;
  props?: Record<string, string | number>;
}

export type Endpoint =
  | { kind: "pico"; phys: number; label: string }
  | { kind: "hole"; row: number; col?: Column; label?: string }
  | { kind: "rail"; rail: RailId; row?: number; label?: string };

export interface Wire {
  from: Endpoint;
  to: Endpoint;
  color?: string;
}

export interface Build {
  boardId: string;
  parts: Part[];
  wires: Wire[];
  /** Keyed by GPIO name, e.g. { GP15: "out" }. */
  gpioModes: Record<string, GpioMode>;
}

// ---------- Validation ----------
export type Severity = "error" | "warning";

export interface Issue {
  code: string;
  severity: Severity;
  /** Beginner-friendly explanation. */
  message: string;
  /** Set when the problem only appears in some switch positions, e.g. "when BTN1 is pressed". */
  when?: string;
  wires?: number[];
  parts?: string[];
  pins?: string[];
}

export interface ValidationReport {
  ok: boolean;
  errors: number;
  warnings: number;
  issues: Issue[];
}
