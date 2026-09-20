import type { ViteUserConfig } from "vitest/config";

// Named Vitest project configs, shared between the unified vitest.config.ts
// `test.projects` array and the standalone vitest.config.evals.ts shim (kept
// for tests/scripts/run-evals-table.ts, which invokes
// `vitest run --config vitest.config.evals.ts` directly instead of
// `--project evals`). Keep each project's include/exclude, environment,
// timeouts, and setup files exactly as they were before consolidation.

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

export const guiReleaseProject: ViteUserConfig = {
  test: {
    name: "gui-release",
    globals: true,
    include: ["tests/e2e/gui-release-smoke.test.ts"],
    testTimeout: 90_000,
    hookTimeout: 45_000,
  },
};
