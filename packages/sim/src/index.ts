// Behaviour simulator (M18 18.7): runs a project's MicroPython on the official WebAssembly build
// against parts simulated from the circuit.

export { MICROPYTHON_API } from "@breadpilot/circuit-core";

/** The official WebAssembly build the simulator runs (same MicroPython version as the firmware). */
export const ENGINE = { package: "@micropython/micropython-webassembly-pyscript", version: "1.29.0-6", wasm: "micropython.wasm" } as const;
export { runProgram, parseTraceback, type RunOptions, type Scenario, type SimError, type SimEvent, type SimInputs, type SimResult } from "./run";
export { electricalModel, type ElectricalModel } from "./circuit";
export { checkBehaviour, type BehaviourCheck } from "./check";
export { findings, type Finding } from "./findings";
export { checkClaims, claimWords, MAX_CLAIMS, type CheckedClaim, type Claim, type ClaimWords } from "./claims";
export { testRun, type Phase, type TestRun } from "./scenario";
export { applyEvents, emptyPreview, framePixels, inputSlots, ledFullMa, MAX_PRINTS, type InputSlot, type PreviewState } from "./preview";
export { liveBytes, stopLive, writeInput } from "./live.mjs";
export { endOf } from "./trace";
