import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["tests/e2e/gui-release-smoke.test.ts"],
    testTimeout: 90_000,
    hookTimeout: 45_000,
  },
});
