import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // scripts/coverage-merge.mjs merges this lane's raw Istanbul map with the
      // root in-process run. Include both worker sources so an unexecuted relay
      // file still contributes its full denominator instead of vanishing.
      include: ["src/**/*.{ts,tsx,js,jsx}"],
      reporter: ["text-summary", "json"],
      reportsDirectory: "../../coverage/relay",
    },
  },
});
