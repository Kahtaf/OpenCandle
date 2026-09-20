import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureParentDir, getConfigPath } from "./infra/opencandle-paths.js";

export interface SentimentConfig {
  retentionDays: number;
  defaultSubreddits: string[];
  commentsPerPost: number;
  divergenceThreshold: number;
  minUsefulSampleSize?: number;
  maxInsightDriversPerPolarity?: number;
  maxRepresentativeItemsPerSource?: number;
  maxAggregateRepresentativeItems?: number;
  maxNotableClaims?: number;
}

export interface Config {
  alphaVantageApiKey?: string;
  fredApiKey?: string;
  braveApiKey?: string;
  exaApiKey?: string;
  finnhubApiKey?: string;
  lseApiKey?: string;
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
    lse?: {
      apiKey?: string;
    };
  };
  sentiment?: {
    retentionDays?: number;
    defaultSubreddits?: string[];
    commentsPerPost?: number;
    divergenceThreshold?: number;
    minUsefulSampleSize?: number;
    maxInsightDriversPerPolarity?: number;
    maxRepresentativeItemsPerSource?: number;
    maxAggregateRepresentativeItems?: number;
    maxNotableClaims?: number;
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
    if (key && value && process.env[key] === undefined) {
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
  minUsefulSampleSize: 10,
  maxInsightDriversPerPolarity: 3,
  maxRepresentativeItemsPerSource: 5,
  maxAggregateRepresentativeItems: 8,
  maxNotableClaims: 5,
};

/**
 * The LLM router is the only production routing path, and nothing reads a
 * router-mode value. This only rejects a stale `OPENCANDLE_ROUTER_MODE` so a
 * config left over from the rules era fails loudly instead of being ignored.
 */
function assertSupportedRouterMode(): void {
  const raw = process.env.OPENCANDLE_ROUTER_MODE;
  if (raw === undefined || raw === "" || raw === "llm") return;
  if (raw === "rules") {
    throw new Error(
      'OPENCANDLE_ROUTER_MODE="rules" was removed: the deterministic rules router is no longer a production routing path. Unset OPENCANDLE_ROUTER_MODE to use the LLM router.',
    );
  }
  throw new Error(`Invalid OPENCANDLE_ROUTER_MODE="${raw}". Allowed value: "llm" (default).`);
}

function resolveConfig(fileConfig: OpenCandleFileConfig): Config {
  assertSupportedRouterMode();
  const fileSentiment = fileConfig.sentiment;
  return {
    alphaVantageApiKey:
      process.env.ALPHA_VANTAGE_API_KEY ?? fileConfig.providers?.alphaVantage?.apiKey,
    fredApiKey: process.env.FRED_API_KEY ?? fileConfig.providers?.fred?.apiKey,
    braveApiKey: process.env.BRAVE_API_KEY ?? fileConfig.providers?.brave?.apiKey,
    exaApiKey: process.env.EXA_API_KEY ?? fileConfig.providers?.exa?.apiKey,
    finnhubApiKey: process.env.FINNHUB_API_KEY ?? fileConfig.providers?.finnhub?.apiKey,
    lseApiKey: process.env.LSE_API_KEY ?? fileConfig.providers?.lse?.apiKey,
    sentiment: {
      retentionDays: fileSentiment?.retentionDays ?? SENTIMENT_DEFAULTS.retentionDays,
      defaultSubreddits: fileSentiment?.defaultSubreddits ?? SENTIMENT_DEFAULTS.defaultSubreddits,
      commentsPerPost: fileSentiment?.commentsPerPost ?? SENTIMENT_DEFAULTS.commentsPerPost,
      divergenceThreshold:
        fileSentiment?.divergenceThreshold ?? SENTIMENT_DEFAULTS.divergenceThreshold,
      minUsefulSampleSize:
        fileSentiment?.minUsefulSampleSize ?? SENTIMENT_DEFAULTS.minUsefulSampleSize,
      maxInsightDriversPerPolarity:
        fileSentiment?.maxInsightDriversPerPolarity ??
        SENTIMENT_DEFAULTS.maxInsightDriversPerPolarity,
      maxRepresentativeItemsPerSource:
        fileSentiment?.maxRepresentativeItemsPerSource ??
        SENTIMENT_DEFAULTS.maxRepresentativeItemsPerSource,
      maxAggregateRepresentativeItems:
        fileSentiment?.maxAggregateRepresentativeItems ??
        SENTIMENT_DEFAULTS.maxAggregateRepresentativeItems,
      maxNotableClaims: fileSentiment?.maxNotableClaims ?? SENTIMENT_DEFAULTS.maxNotableClaims,
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
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600,
  });
  if (process.platform !== "win32") chmodSync(path, 0o600);
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
