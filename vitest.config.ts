import { defineConfig } from "vitest/config";
import {
  agentToolsProject,
  evalsProject,
  guiBrowserProject,
  guiReleaseProject,
  siteProject,
  unitProject,
} from "./vitest.projects.js";

export default defineConfig({
  test: {
    // Vitest 5 enables `clearMocks` by default, which wipes every mock's call
    // history before each test. These suites were written against the Vitest 4
    // default (`false`) and some assert on calls recorded in earlier tests
    // (for example the registerEvalSuite wiring smoke test), so keep the v4
    // default to preserve test semantics across the major upgrade.
    clearMocks: false,
    projects: [
      unitProject,
      siteProject,
      agentToolsProject,
      evalsProject,
      guiBrowserProject,
      guiReleaseProject,
    ],
    coverage: {
      provider: "v8",
      // Measure only in-process (Node) execution. Browser, child-process, and
      // WebContainer-only surfaces are still listed so an uninstrumented file
      // stays in the denominator; scripts/coverage-report.mjs labels every
      // surface that this run cannot execute instead of reporting it as zero.
      include: [
        "src/**/*.{ts,tsx,js,jsx}",
        "gui/server/**/*.{ts,tsx,js,jsx}",
        "gui/shared/**/*.{ts,tsx,js,jsx}",
        "gui/web/src/**/*.{ts,tsx,js,jsx}",
        "gui/hosted/src/**/*.{ts,tsx,js,jsx}",
        "gui/hosted/runtime/**/*.{ts,tsx,js,jsx}",
        "packages/ui/src/**/*.{ts,tsx,js,jsx}",
        "workers/provider-relay/src/**/*.{ts,tsx,js,jsx}",
      ],
      // Generated declarations/source and build output only, with reasons.
      // Never excluded: real source that is merely difficult to execute.
      exclude: [
        "**/*.d.ts", // generated TypeScript declarations
        "**/*.generated.{ts,tsx,js,jsx}", // generated source (e.g. pi model catalog)
        "**/worker-configuration.d.ts", // generated Cloudflare worker env declaration
        "**/node_modules/**", // vendored dependencies
        "**/dist/**", // built artifacts
        "**/*.{test,spec}.{ts,tsx,js,jsx}", // test files, not production source
        "**/*.config.{ts,js,mjs,cjs}", // tooling configuration
      ],
      reporter: ["text-summary", "json-summary", "lcov"],
      reportsDirectory: "coverage",
    },
  },
});
