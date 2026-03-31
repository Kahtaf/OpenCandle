import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureParentDir, getConfigPath } from "./infra/opencandle-paths.js";

export interface Config {
  alphaVantageApiKey?: string;
  fredApiKey?: string;
}

export interface OpenCandleFileConfig {
  providers?: {
    alphaVantage?: {
      apiKey?: string;
    };
    fred?: {
      apiKey?: string;
    };
  };
}

export interface FinanceProviderReadiness {
  hasAlphaVantage: boolean;
  hasFred: boolean;
}

export function loadEnv(path = ".env"): void {
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return;
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (key && value) {
      process.env[key] = value;
    }
  }
}

let cachedConfig: Config | null = null;

function resolveConfig(fileConfig: OpenCandleFileConfig): Config {
  return {
    alphaVantageApiKey:
      process.env.ALPHA_VANTAGE_API_KEY ?? fileConfig.providers?.alphaVantage?.apiKey,
    fredApiKey: process.env.FRED_API_KEY ?? fileConfig.providers?.fred?.apiKey,
  };
}

export function loadFileConfig(path = getConfigPath()): OpenCandleFileConfig {
  if (!existsSync(path)) {
    return {};
  }

  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read OpenCandle config at ${path}: ${message}`);
  }

  try {
    const parsed = JSON.parse(content) as OpenCandleFileConfig;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid OpenCandle config at ${path}: ${message}`);
  }
}

export function saveFileConfig(config: OpenCandleFileConfig, path = getConfigPath()): void {
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

export function getFinanceProviderReadiness(path = getConfigPath()): FinanceProviderReadiness {
  loadEnv();
  const config = resolveConfig(loadFileConfig(path));
  return {
    hasAlphaVantage: Boolean(config.alphaVantageApiKey),
    hasFred: Boolean(config.fredApiKey),
  };
}

export function loadConfig(): Config {
  loadEnv();
  cachedConfig = resolveConfig(loadFileConfig());

  return cachedConfig;
}

export function getConfig(): Config {
  if (!cachedConfig) {
    return loadConfig();
  }
  return cachedConfig;
}
