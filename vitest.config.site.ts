import { defineConfig } from "vitest/config";

// Interim single-project config for the public-site build contract tests.
// This file is a stopgap until the vitest.config.ts consolidation (a later
// commit in this same change) folds it into that config's `site` project.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/site/**/*.test.ts"],
    setupFiles: ["tests/setup/browser-shims.ts"],
  },
});
