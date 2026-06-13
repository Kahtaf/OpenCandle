import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const OPENCANDLE_HOME_ENV = "OPENCANDLE_HOME";

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
  }
}

export function getOpenCandleHomeDir(): string {
  const override = process.env[OPENCANDLE_HOME_ENV];
  return override ? resolve(override) : join(homedir(), ".opencandle");
}

export function ensureOpenCandleHomeDir(): string {
  const home = getOpenCandleHomeDir();
  ensureDir(home);
  if (process.platform !== "win32") chmodSync(home, 0o700);
  return home;
}

export function resolveOpenCandlePath(...segments: string[]): string {
  return join(getOpenCandleHomeDir(), ...segments);
}

export function ensureParentDir(path: string): string {
  const parent = dirname(path);
  ensureDir(parent);
  return parent;
}

export function getConfigPath(): string {
  return resolveOpenCandlePath("config.json");
}

export function getOnboardingPath(): string {
  return resolveOpenCandlePath("onboarding.json");
}

export function getStateDbPath(): string {
  return resolveOpenCandlePath("state.db");
}

export function getLogsDir(): string {
  return resolveOpenCandlePath("logs");
}

export function getBrowserProfileDir(): string {
  return resolveOpenCandlePath("browser-profile");
}
