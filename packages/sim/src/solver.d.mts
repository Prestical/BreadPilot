// Types for solver.mjs (plain JavaScript so a worker thread or a browser Web Worker can run it).
import type { ElectricalModel } from "./circuit";

export interface PartState {
  switches: Record<string, number>;
  pots: Record<string, number>;
  sensors: Record<string, number | undefined>;
}
export interface PinState {
  mode: "in" | "out" | "pwm" | "od" | "alt";
  pull?: number;
  level?: number;
  duty?: number;
  freq?: number;
}
export interface Solved {
  volts(node: number): number | null;
  group(node: number): number;
  ledMa: Record<string, number>;
  conflicts: string[];
}
export function stateAt(scenario: unknown, t: number): PartState;
export function scenarioTimes(scenario: unknown): number[];
export function solveCircuit(model: ElectricalModel, state: PartState, pins: Record<number, PinState>): Solved;
export function readPin(model: ElectricalModel, solved: Solved, gpio: number, pull: number): { level: number; volts: number | null; floating: boolean; between: boolean };
export function readAdc(model: ElectricalModel, solved: Solved, ch: number): { volts: number; floating: boolean };
export function devices(model: ElectricalModel, solved: Solved, pins: Record<number, PinState>): { leds: Record<string, number>; actuators: Record<string, { on: number; freq: number }> };
