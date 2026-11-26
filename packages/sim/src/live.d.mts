// Types for live.mjs (plain JavaScript so a worker thread or a browser Web Worker can run it).
export interface LiveSlot {
  group: "switches" | "pots" | "sensors";
  key: string;
}
export function liveBytes(slots: number): number;
export function writeInput(sab: SharedArrayBuffer, index: number, value: number): void;
export function stopLive(sab: SharedArrayBuffer): void;
