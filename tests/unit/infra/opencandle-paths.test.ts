import { afterEach, describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  getConfigPath,
  getLogsDir,
  getOnboardingPath,
  getPortfolioPath,
  getPredictionsPath,
  getStateDbPath,
  getOpenCandleHomeDir,
  getWatchlistPath,
  resolveOpenCandlePath,
} from "../../../src/infra/opencandle-paths.js";

describe("opencandle paths", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalEnv;
    }
  });

  it("defaults to ~/.opencandle", () => {
    delete process.env.OPENCANDLE_HOME;

    expect(getOpenCandleHomeDir()).toBe(join(homedir(), ".opencandle"));
    expect(getWatchlistPath()).toBe(join(homedir(), ".opencandle", "watchlist.json"));
    expect(getPortfolioPath()).toBe(join(homedir(), ".opencandle", "portfolio.json"));
    expect(getPredictionsPath()).toBe(join(homedir(), ".opencandle", "predictions.json"));
    expect(getConfigPath()).toBe(join(homedir(), ".opencandle", "config.json"));
    expect(getOnboardingPath()).toBe(join(homedir(), ".opencandle", "onboarding.json"));
    expect(getStateDbPath()).toBe(join(homedir(), ".opencandle", "state.db"));
    expect(getLogsDir()).toBe(join(homedir(), ".opencandle", "logs"));
  });

  it("honors OPENCANDLE_HOME overrides", () => {
    process.env.OPENCANDLE_HOME = "./tmp/custom-opencandle-home";

    expect(getOpenCandleHomeDir()).toBe(resolve("./tmp/custom-opencandle-home"));
    expect(resolveOpenCandlePath("watchlist.json")).toBe(
      resolve("./tmp/custom-opencandle-home", "watchlist.json"),
    );
  });
});
