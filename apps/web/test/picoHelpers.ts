// Small re-exports for the Pico build tests.
import { driversFor } from "@breadpilot/circuit-core";
export { parseUf2 } from "@breadpilot/circuit-core";

const sh1106 = driversFor(["oled-sh1106-i2c"])[0]!;
export const SH1106_DRIVER_FILE = { name: sh1106.file, content: sh1106.source };
