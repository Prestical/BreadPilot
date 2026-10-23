import { defineProject } from "vitest/config";

// Only pure modules are unit-tested here (tutorial engine, scene model); no DOM needed.
export default defineProject({
  test: { name: "web", environment: "node", include: ["test/**/*.test.ts"] },
});
