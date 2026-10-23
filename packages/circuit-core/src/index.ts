// Source-only internal package: consumed directly as TypeScript by Vite (web),
// esbuild (api build), tsx (api dev) and Vitest. No separate build step.

export const CIRCUIT_CORE_VERSION = "0.1.0";

export * from "./types";
export { PICO_2_W, getBoard, pinByPhys, pinByGpio, labelMatchesPin, isPinLikeLabel, parseBoard } from "./board";
export { CATALOG, getComponent } from "./catalog";
export { BREADBOARD, parseHole, picoPinHole, picoFreeHoles, isBlockedByPico, sideOf } from "./breadboard";
export { parseConnection, parseConnections, parseEndpoint, formatEndpoint, formatWire, type ParseError, type ParseResult } from "./dsl";
export { resolveBuild, type Resolved, type ResolvedPart, type ResolvedWire, type ResolvedEnd } from "./resolve";
export { buildNets, type Net, type Nets } from "./netlist";
export { validateBuild, isDriven } from "./validate";
export { layoutProject, allocate, allocatePins, gpioPreference, i2cPairs, LayoutError, WIRE_COLORS, POWER_MODES, WIRES_PER_PICO_PIN, type BlockKind, type BlockRequest, type Layout, type LayoutOptions, type PinChoice, type PlacedBlock, type PowerMode } from "./layout";
export { pinoutMarkdown } from "./pinout-text";
export { buildSteps, resistorBands, formatOhms, wireRole, defaultColor, StepsError, type BuildStep, type StepKind, type WireRole } from "./steps";
export { holeKey, stripOfHole, railNode, RAIL_IDS, PICO_LAST_ROW } from "./breadboard";
export { checkMicroPython, stripStringsAndComments, PICO_MODULES, type CodeCheckReport, type CodeIssue } from "./codecheck";
export { driversFor, type DriverFile } from "./drivers";
export { buildUf2, firmwareInfo, parseUf2, writeUf2, Uf2Error, UF2, type BuildOptions, type FirmwareInfo, type Uf2Block } from "./uf2";
export { PACKS, PACK_FORMAT, getPack, packByKind, packOfPart, loadPack, loadPacks, unverifiedFacts, fillTemplate, propVars, PackError, type ViewSpec, type AgentInfo, type CodeRules, type LayoutTemplate, type Pack, type PackMeta, type PackSource, type Source, type TextTemplates } from "./packs";
