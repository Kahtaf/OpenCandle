import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { ViteUserConfig } from "vitest/config";
import * as projects from "../../vitest.projects.js";

// Contract: `npm test` gives the same result on a developer machine with
// provider keys exported as it does in CI with none. Credible defect: a unit
// file reads a host credential (or the repo `.env`) and flips an onboarding or
// setup assertion, so the suite only passes on a clean shell.

const repoRoot = resolve(import.meta.dirname, "../..");

// The unit files that failed with host keys exported before the unit project
// isolated its env, plus a tool test that used to load the repo `.env`.
const HOST_SENSITIVE_FILES = [
  "tests/unit/pi/setup.test.ts",
  "tests/unit/gui-hosted/browser-model-runtime.test.ts",
  "tests/unit/gui-server/model-setup.test.ts",
  "tests/unit/gui-server/tool-metadata.test.ts",
  "tests/unit/onboarding/connect.test.ts",
  "tests/unit/onboarding/provider-status.test.ts",
  "tests/unit/tools/stock-quote.test.ts",
];

// Obviously fake values: this proves the unit project ignores whatever the
// caller exports, so no real credential is ever needed or read.
const DUMMY_KEYS = {
  GEMINI_API_KEY: "dummy",
  OPENAI_API_KEY: "dummy",
  ANTHROPIC_API_KEY: "dummy",
  OPENROUTER_API_KEY: "dummy",
  FRED_API_KEY: "dummy",
  FINNHUB_API_KEY: "dummy",
  ALPHA_VANTAGE_API_KEY: "dummy",
  EXA_API_KEY: "dummy",
  BRAVE_API_KEY: "dummy",
  LSE_API_KEY: "dummy",
};

describe("unit project env isolation", () => {
  it("passes the host-sensitive unit files with dummy provider keys exported", () => {
    const result = spawnSync(
      process.execPath,
      [
        resolve(repoRoot, "node_modules/vitest/vitest.mjs"),
        "run",
        "--project",
        "unit",
        ...HOST_SENSITIVE_FILES,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, ...DUMMY_KEYS, CI: "1", FORCE_COLOR: "0" },
        timeout: 240_000,
      },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  }, 300_000);
});

describe("env isolation lane boundary", () => {
  const setupFiles = (project: ViteUserConfig): string[] => {
    const files = project.test?.setupFiles ?? [];
    return Array.isArray(files) ? files : [files];
  };

  it("isolates the in-process projects and undoes per-test env stubs", () => {
    for (const project of [
      projects.unitProject,
      projects.siteProject,
      projects.agentToolsProject,
    ]) {
      expect(setupFiles(project)[0], project.test?.name).toBe("tests/setup/isolate-env.ts");
      expect(project.test?.unstubEnvs, project.test?.name).toBe(true);
    }
  });

  it("leaves the live lanes on the host env so explicitly exported keys still reach them", () => {
    for (const project of [
      projects.evalsProject,
      projects.guiBrowserProject,
      projects.guiReleaseProject,
    ]) {
      expect(setupFiles(project), project.test?.name).not.toContain("tests/setup/isolate-env.ts");
    }
  });
});
