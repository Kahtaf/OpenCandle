import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["tests/evals/cases/**/*.eval.ts"],
    testTimeout: 180_000,
  },
});
