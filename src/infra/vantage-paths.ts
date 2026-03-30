import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const VANTAGE_HOME_ENV = "VANTAGE_HOME";

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

export function getVantageHomeDir(): string {
  const override = process.env[VANTAGE_HOME_ENV];
  return override ? resolve(override) : join(homedir(), ".vantage");
}

export function ensureVantageHomeDir(): string {
  const home = getVantageHomeDir();
  ensureDir(home);
  return home;
}

export function resolveVantagePath(...segments: string[]): string {
  return join(getVantageHomeDir(), ...segments);
}

export function ensureParentDir(path: string): string {
  const parent = dirname(path);
  ensureDir(parent);
  return parent;
}

export function getWatchlistPath(): string {
  return resolveVantagePath("watchlist.json");
}

export function getPortfolioPath(): string {
  return resolveVantagePath("portfolio.json");
}

export function getPredictionsPath(): string {
  return resolveVantagePath("predictions.json");
}

export function getConfigPath(): string {
  return resolveVantagePath("config.json");
}

export function getOnboardingPath(): string {
  return resolveVantagePath("onboarding.json");
}

export function getStateDbPath(): string {
  return resolveVantagePath("state.db");
}

export function getLogsDir(): string {
  return resolveVantagePath("logs");
}
