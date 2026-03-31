import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getDefaultOnboardingState,
  loadOnboardingState,
  saveOnboardingState,
} from "../../../src/onboarding/state.js";

describe("onboarding state", () => {
  let tempDir: string;
  const originalOpenCandleHome = process.env.OPENCANDLE_HOME;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    if (originalOpenCandleHome == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalOpenCandleHome;
    }
  });

  it("returns defaults when onboarding.json does not exist", () => {
    tempDir = mkdtempSync(join(tmpdir(), "opencandle-onboarding-"));
    process.env.OPENCANDLE_HOME = tempDir;

    expect(loadOnboardingState()).toEqual(getDefaultOnboardingState());
  });

  it("persists onboarding.json under OPENCANDLE_HOME", () => {
    tempDir = mkdtempSync(join(tmpdir(), "opencandle-onboarding-"));
    process.env.OPENCANDLE_HOME = tempDir;

    saveOnboardingState({ version: 1, financeSetupStatus: "dismissed" });

    expect(loadOnboardingState()).toEqual({ version: 1, financeSetupStatus: "dismissed" });
    expect(readFileSync(join(tempDir, "onboarding.json"), "utf-8")).toContain("dismissed");
  });
});
