import { defineProject } from "vitest/config";

export default defineProject({
  test: { name: "circuit-core", environment: "node" },
});
