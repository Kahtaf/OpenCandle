import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureParentDir, getConfigPath } from "./infra/opencandle-paths.js";
import type { PlanningBehaviorMode, TaskFamily } from "./routing/planning.js";

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

export type RouterMode = "llm";
export type ToolScopeMode = "observe" | "enforce";
export type PlanningMigrationStatuses = Partial<Record<TaskFamily, PlanningBehaviorMode>>;

export interface Config {
  alphaVantageApiKey?: string;
  fredApiKey?: string;
  braveApiKey?: string;
  exaApiKey?: string;
  finnhubApiKey?: string;
  lseApiKey?: string;
  /**
   * Intent-router mode. The LLM router is the only production routing path;
   * `OPENCANDLE_ROUTER_MODE` accepts only `"llm"` (or unset). The removed
   * `"rules"` value fails startup with migration guidance.
   */
  routerMode: RouterMode;
  /**
   * Route-selected tool scope mode. `"observe"` (default) records selected
   * bundles and active-tool candidates. `"enforce"` applies Pi active tools
   * for the turn via `pi.setActiveTools`.
   */
  toolScopeMode: ToolScopeMode;
  /**
   * Per-task planning behavior rollback/activation overrides. Controlled by
   * `OPENCANDLE_PLANNING_MIGRATION_STATUSES`, e.g.
   * `asset_compare=dual_run,single_asset_decision=observe_only`.
   */
  planningMigrationStatuses?: PlanningMigrationStatuses;
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

const PLANNING_TASK_FAMILIES = [
  "single_asset_decision",
  "asset_compare",
  "portfolio_build",
  "portfolio_review",
  "macro_allocation_review",
  "options_strategy",
  "current_event_explanation",
  "ticker_disambiguation",
  "filing_thesis_review",
  "sentiment_snapshot",
  "concept_explainer",
  "retail_finance_tradeoff",
  "stateful_tracking_update",
  "backtest_review",
  "general_fallback",
] as const satisfies readonly TaskFamily[];

const PLANNING_BEHAVIOR_MODES = [
  "observe_only",
  "dual_run",
  "replacement_active",
] as const satisfies readonly PlanningBehaviorMode[];

function resolveRouterMode(): RouterMode {
  const raw = process.env.OPENCANDLE_ROUTER_MODE;
  if (raw === undefined || raw === "" || raw === "llm") return "llm";
  if (raw === "rules") {
    throw new Error(
      'OPENCANDLE_ROUTER_MODE="rules" was removed: the deterministic rules router is no longer a production routing path. Unset OPENCANDLE_ROUTER_MODE to use the LLM router.',
    );
  }
  throw new Error(`Invalid OPENCANDLE_ROUTER_MODE="${raw}". Allowed value: "llm" (default).`);
}

function resolveToolScopeMode(): ToolScopeMode {
  const raw = process.env.OPENCANDLE_TOOL_SCOPE_MODE;
  if (raw === undefined || raw === "") return "observe";
  if (raw === "observe" || raw === "enforce") return raw;
  throw new Error(
    `Invalid OPENCANDLE_TOOL_SCOPE_MODE="${raw}". Allowed values: "observe" (default) or "enforce".`,
  );
}

function resolvePlanningMigrationStatuses(): PlanningMigrationStatuses | undefined {
  const raw = process.env.OPENCANDLE_PLANNING_MIGRATION_STATUSES;
  if (raw === undefined || raw.trim() === "") return undefined;

  const statuses: PlanningMigrationStatuses = {};
  for (const entry of raw.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const parts = trimmed.split("=");
    const taskFamily = parts[0]?.trim();
    const behaviorMode = parts[1]?.trim();
    if (
      parts.length !== 2 ||
      !isPlanningTaskFamily(taskFamily) ||
      !isPlanningBehaviorMode(behaviorMode)
    ) {
      throw new Error(`Invalid OPENCANDLE_PLANNING_MIGRATION_STATUSES entry "${trimmed}".`);
    }
    statuses[taskFamily] = behaviorMode;
  }

  return Object.keys(statuses).length > 0 ? statuses : undefined;
}

function isPlanningTaskFamily(value: string | undefined): value is TaskFamily {
  return PLANNING_TASK_FAMILIES.includes(value as TaskFamily);
}

function isPlanningBehaviorMode(value: string | undefined): value is PlanningBehaviorMode {
  return PLANNING_BEHAVIOR_MODES.includes(value as PlanningBehaviorMode);
}

function resolveConfig(fileConfig: OpenCandleFileConfig): Config {
  const fileSentiment = fileConfig.sentiment;
  return {
    alphaVantageApiKey:
      process.env.ALPHA_VANTAGE_API_KEY ?? fileConfig.providers?.alphaVantage?.apiKey,
    fredApiKey: process.env.FRED_API_KEY ?? fileConfig.providers?.fred?.apiKey,
    braveApiKey: process.env.BRAVE_API_KEY ?? fileConfig.providers?.brave?.apiKey,
    exaApiKey: process.env.EXA_API_KEY ?? fileConfig.providers?.exa?.apiKey,
    finnhubApiKey: process.env.FINNHUB_API_KEY ?? fileConfig.providers?.finnhub?.apiKey,
    lseApiKey: process.env.LSE_API_KEY ?? fileConfig.providers?.lse?.apiKey,
    routerMode: resolveRouterMode(),
    toolScopeMode: resolveToolScopeMode(),
    planningMigrationStatuses: resolvePlanningMigrationStatuses(),
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
