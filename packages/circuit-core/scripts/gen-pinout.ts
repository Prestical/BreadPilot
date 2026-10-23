import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PICO_2_W } from "../src/board";
import { pinoutMarkdown } from "../src/pinout-text";

export const PINOUT_MD_PATH = fileURLToPath(new URL("../../../data/boards/pico-2-w.pinout.generated.md", import.meta.url));

writeFileSync(PINOUT_MD_PATH, pinoutMarkdown(PICO_2_W));
console.log(`wrote ${PINOUT_MD_PATH}`);
