import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureOpenCandleHomeDir,
  getConfigPath,
  getLogsDir,
  getOnboardingPath,
  getOpenCandleHomeDir,
  getStateDbPath,
  resolveOpenCandlePath,
} from "../../../src/infra/opencandle-paths.js";

describe("opencandle paths", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  const tempDirs: string[] = [];

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalEnv;
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("defaults to ~/.opencandle", () => {
    delete process.env.OPENCANDLE_HOME;

    expect(getOpenCandleHomeDir()).toBe(join(homedir(), ".opencandle"));
    expect(getConfigPath()).toBe(join(homedir(), ".opencandle", "config.json"));
    expect(getOnboardingPath()).toBe(join(homedir(), ".opencandle", "onboarding.json"));
    expect(getStateDbPath()).toBe(join(homedir(), ".opencandle", "state.db"));
    expect(getLogsDir()).toBe(join(homedir(), ".opencandle", "logs"));
  });

  it("honors OPENCANDLE_HOME overrides", () => {
    process.env.OPENCANDLE_HOME = "./tmp/custom-opencandle-home";

    expect(getOpenCandleHomeDir()).toBe(resolve("./tmp/custom-opencandle-home"));
    expect(resolveOpenCandlePath("state.db")).toBe(
      resolve("./tmp/custom-opencandle-home", "state.db"),
    );
  });

  it.skipIf(process.platform === "win32")("repairs existing home directory permissions", () => {
    const home = mkdtempSync(join(tmpdir(), "opencandle-home-perms-"));
    tempDirs.push(home);
    chmodSync(home, 0o755);
    process.env.OPENCANDLE_HOME = home;

    ensureOpenCandleHomeDir();

    expect(statSync(home).mode & 0o777).toBe(0o700);
  });
});
