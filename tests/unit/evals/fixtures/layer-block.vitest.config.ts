import { defineConfig } from "vitest/config";

// Isolated Vitest project for the eval-suite layer-block fixtures.
//
// These fixtures deliberately register a suite whose aggregate clears the 0.8
// threshold while one layer has `passed: false`, so the real registration
// runner must exit non-zero. Keeping them on their own config (and out of the
// unit project's `tests/unit/**/*.test.ts` include) lets the spawning test
// prove that without failing `npm test` itself.
export default defineConfig({
  test: {
    name: "eval-layer-block-fixture",
    globals: true,
    environment: "node",
    clearMocks: false,
    include: ["tests/unit/evals/fixtures/*.fixture.ts"],
  },
});
