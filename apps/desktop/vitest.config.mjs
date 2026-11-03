import { defineProject } from "vitest/config";

// The desktop helpers that don't need Electron (window state, log, problem dialogs).
export default defineProject({
  test: { name: "desktop", environment: "node" },
});
