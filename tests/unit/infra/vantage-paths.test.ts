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
  getVantageHomeDir,
  getWatchlistPath,
  resolveVantagePath,
} from "../../../src/infra/vantage-paths.js";

describe("vantage paths", () => {
  const originalEnv = process.env.VANTAGE_HOME;

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.VANTAGE_HOME;
    } else {
      process.env.VANTAGE_HOME = originalEnv;
    }
  });

  it("defaults to ~/.vantage", () => {
    delete process.env.VANTAGE_HOME;

    expect(getVantageHomeDir()).toBe(join(homedir(), ".vantage"));
    expect(getWatchlistPath()).toBe(join(homedir(), ".vantage", "watchlist.json"));
    expect(getPortfolioPath()).toBe(join(homedir(), ".vantage", "portfolio.json"));
    expect(getPredictionsPath()).toBe(join(homedir(), ".vantage", "predictions.json"));
    expect(getConfigPath()).toBe(join(homedir(), ".vantage", "config.json"));
    expect(getOnboardingPath()).toBe(join(homedir(), ".vantage", "onboarding.json"));
    expect(getStateDbPath()).toBe(join(homedir(), ".vantage", "state.db"));
    expect(getLogsDir()).toBe(join(homedir(), ".vantage", "logs"));
  });

  it("honors VANTAGE_HOME overrides", () => {
    process.env.VANTAGE_HOME = "./tmp/custom-vantage-home";

    expect(getVantageHomeDir()).toBe(resolve("./tmp/custom-vantage-home"));
    expect(resolveVantagePath("watchlist.json")).toBe(
      resolve("./tmp/custom-vantage-home", "watchlist.json"),
    );
  });
});
