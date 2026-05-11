import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/e2e/gui-browser.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});
