import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureParentDir, getConfigPath } from "./infra/opencandle-paths.js";

export interface SentimentConfig {
  retentionDays: number;
  defaultSubreddits: string[];
  commentsPerPost: number;
  divergenceThreshold: number;
}

export type RouterMode = "rules" | "llm";

export interface Config {
  alphaVantageApiKey?: string;
  fredApiKey?: string;
  braveApiKey?: string;
  exaApiKey?: string;
  finnhubApiKey?: string;
  /** Enable adversarial bull/bear debate in comprehensive analysis. Default: true. */
  debate?: boolean;
  /**
   * Intent-router mode. `"llm"` (default) runs the LLM router ahead of prompt
   * assembly. `"rules"` runs the legacy regex `classifyIntent` +
   * `extractPreferences` path. Controlled by `OPENCANDLE_ROUTER_MODE`.
   */
  routerMode: RouterMode;
  sentiment?: SentimentConfig;
}

export interface OpenCandleFileConfig {
  providers?: {
    alphaVantage?: {
      apiKey?: string;
    };
    fred?: {
      apiKey?: string;
    };
    brave?: {
      apiKey?: string;
    };
    exa?: {
      apiKey?: string;
    };
    finnhub?: {
      apiKey?: string;
    };
  };
  /** Enable adversarial bull/bear debate in comprehensive analysis. Default: true. */
  debate?: boolean;
  sentiment?: {
    retentionDays?: number;
    defaultSubreddits?: string[];
    commentsPerPost?: number;
    divergenceThreshold?: number;
  };
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

const SENTIMENT_DEFAULTS: SentimentConfig = {
  retentionDays: 30,
  defaultSubreddits: ["wallstreetbets", "stocks", "investing", "options"],
  commentsPerPost: 5,
  divergenceThreshold: 0.4,
};

function resolveRouterMode(): RouterMode {
  const raw = process.env.OPENCANDLE_ROUTER_MODE;
  if (raw === undefined || raw === "") return "llm";
  if (raw === "rules" || raw === "llm") return raw;
  throw new Error(
    `Invalid OPENCANDLE_ROUTER_MODE="${raw}". Allowed values: "llm" (default) or "rules".`,
  );
}

function resolveConfig(fileConfig: OpenCandleFileConfig): Config {
  const debateEnv = process.env.OPENCANDLE_DEBATE;
  const fileSentiment = fileConfig.sentiment;
  return {
    alphaVantageApiKey:
      process.env.ALPHA_VANTAGE_API_KEY ?? fileConfig.providers?.alphaVantage?.apiKey,
    fredApiKey: process.env.FRED_API_KEY ?? fileConfig.providers?.fred?.apiKey,
    braveApiKey: process.env.BRAVE_API_KEY ?? fileConfig.providers?.brave?.apiKey,
    exaApiKey: process.env.EXA_API_KEY ?? fileConfig.providers?.exa?.apiKey,
    finnhubApiKey: process.env.FINNHUB_API_KEY ?? fileConfig.providers?.finnhub?.apiKey,
    debate: debateEnv !== undefined ? debateEnv !== "false" && debateEnv !== "0" : fileConfig.debate ?? true,
    routerMode: resolveRouterMode(),
    sentiment: {
      retentionDays: fileSentiment?.retentionDays ?? SENTIMENT_DEFAULTS.retentionDays,
      defaultSubreddits: fileSentiment?.defaultSubreddits ?? SENTIMENT_DEFAULTS.defaultSubreddits,
      commentsPerPost: fileSentiment?.commentsPerPost ?? SENTIMENT_DEFAULTS.commentsPerPost,
      divergenceThreshold: fileSentiment?.divergenceThreshold ?? SENTIMENT_DEFAULTS.divergenceThreshold,
    },
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

/** Test-only: clear the memoized config so the next `getConfig()` re-reads env. */
export function resetConfigCache(): void {
  cachedConfig = null;
}
