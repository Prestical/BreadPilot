import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./vitest.setup.ts"],
    projects: ["packages/*", "apps/api", "apps/web"],
  },
});
