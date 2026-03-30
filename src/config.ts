import { readFileSync } from "node:fs";

export interface Config {
  alphaVantageApiKey?: string;
  fredApiKey?: string;
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

export function loadConfig(): Config {
  loadEnv();

  cachedConfig = {
    alphaVantageApiKey: process.env.ALPHA_VANTAGE_API_KEY,
    fredApiKey: process.env.FRED_API_KEY,
  };

  return cachedConfig;
}

export function getConfig(): Config {
  if (!cachedConfig) {
    return loadConfig();
  }
  return cachedConfig;
}
