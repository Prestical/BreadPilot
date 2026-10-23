// Runs once before any test file loads: the part packs list (parts.generated.ts) is generated, not
// committed, so `npx vitest` works without `npm test`'s pretest step too.
import { writePartsModule } from "./packages/circuit-core/scripts/gen-parts";

export default function setup() {
  writePartsModule();
}
