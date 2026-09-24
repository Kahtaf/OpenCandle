import type { ViteUserConfig } from "vitest/config";

// Named Vitest project configs consumed by the unified vitest.config.ts
// `test.projects` array. Every surface (npm test, the eval front door, the
// browser suites) selects one of these with `--project <name>`, so each
// project's include/exclude, environment, timeouts, and setup files stay
// exactly as they were before consolidation.

export const unitProject: ViteUserConfig = {
  test: {
    name: "unit",
    globals: true,
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/setup/browser-shims.ts"],
  },
};

export const siteProject: ViteUserConfig = {
  test: {
    name: "site",
    globals: true,
    environment: "node",
    include: ["tests/site/**/*.test.ts"],
    setupFiles: ["tests/setup/browser-shims.ts"],
  },
};

export const agentToolsProject: ViteUserConfig = {
  test: {
    name: "agent-tools",
    globals: true,
    environment: "node",
    include: ["tests/agent-tools/**/*.test.ts"],
  },
};

export const evalsProject: ViteUserConfig = {
  test: {
    name: "evals",
    globals: true,
    environment: "node",
    include: ["tests/evals/cases/**/*.eval.ts"],
    testTimeout: 180_000,
  },
};

export const guiBrowserProject: ViteUserConfig = {
  test: {
    name: "gui-browser",
    globals: true,
    include: ["tests/e2e/gui-browser.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
};

// Deterministic browser lane: serves the real GUI bundle from an isolated local
// server but mocks HTTP/WS/SSE in the page, so it needs no model credentials.
// The lifecycle file proves the isolated server cleans up its process group and
// temporary home on both graceful stop and failed startup.
export const guiIntegrationProject: ViteUserConfig = {
  test: {
    name: "gui-integration",
    globals: true,
    include: [
      "tests/e2e/gui-integration.test.ts",
      "tests/e2e/gui-integration-lifecycle.test.ts",
    ],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
};

export const guiReleaseProject: ViteUserConfig = {
  test: {
    name: "gui-release",
    globals: true,
    include: ["tests/e2e/gui-release-smoke.test.ts"],
    testTimeout: 90_000,
    hookTimeout: 45_000,
  },
};

// Full-stack deterministic GUI journeys: a real Playwright browser against a
// real `gui/server/server.ts` child with local external-HTTP fixtures. Serial
// because the suite owns one server child and one browser.
export const guiJourneyProject: ViteUserConfig = {
  test: {
    name: "gui-journey",
    globals: true,
    environment: "node",
    include: ["tests/e2e/gui-session-journey.test.ts"],
    testTimeout: 180_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
};
