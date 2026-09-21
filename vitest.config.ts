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
      include: ["src/**/*.ts"],
    },
  },
});
