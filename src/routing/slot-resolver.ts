import type {
  ExtractedEntities,
  PortfolioSlots,
  OptionsScreenerSlots,
  SlotResolution,
  SlotSource,
} from "./types.js";
import { PORTFOLIO_DEFAULTS, OPTIONS_SCREENER_DEFAULTS } from "./defaults.js";

interface Preferences {
  riskProfile?: string;
  timeHorizon?: string;
  assetScope?: string;
  positionCount?: number;
  maxSinglePositionPct?: number;
  dteTarget?: string;
  objective?: string;
  moneynessPreference?: string;
  liquidityMinimum?: string;
}

function mapDteHintToTarget(dteHint: string | undefined): string | undefined {
  switch (dteHint) {
    case "week":
      return "7_to_14_days";
    case "month":
      return "25_to_45_days";
    case "leaps":
      return "180_plus_days";
    default:
      return undefined;
  }
}

function resolve<T>(
  userValue: T | undefined,
  prefValue: T | undefined,
  defaultValue: T,
): { value: T; source: SlotSource } {
  if (userValue !== undefined) return { value: userValue, source: "user" };
  if (prefValue !== undefined) return { value: prefValue, source: "preference" };
  return { value: defaultValue, source: "default" };
}

export function resolvePortfolioSlots(
  entities: ExtractedEntities,
  preferences: Preferences = {},
): SlotResolution<PortfolioSlots> {
  const sources = {} as Record<keyof PortfolioSlots, SlotSource>;
  const defaultsUsed: string[] = [];
  const missingRequired: string[] = [];

  // Budget: required, no default
  let budget = 0;
  if (entities.budget !== undefined) {
    budget = entities.budget;
    sources.budget = "user";
  } else {
    missingRequired.push("budget");
    sources.budget = "default";
  }

  const risk = resolve(entities.riskProfile, preferences.riskProfile, PORTFOLIO_DEFAULTS.riskProfile);
  sources.riskProfile = risk.source;
  if (risk.source === "default") defaultsUsed.push("riskProfile");

  const horizon = resolve(entities.timeHorizon, preferences.timeHorizon, PORTFOLIO_DEFAULTS.timeHorizon);
  sources.timeHorizon = horizon.source;
  if (horizon.source === "default") defaultsUsed.push("timeHorizon");

  const scope = resolve(undefined, preferences.assetScope, PORTFOLIO_DEFAULTS.assetScope);
  sources.assetScope = scope.source;
  if (scope.source === "default") defaultsUsed.push("assetScope");

  const count = resolve(undefined, preferences.positionCount, PORTFOLIO_DEFAULTS.positionCount);
  sources.positionCount = count.source;
  if (count.source === "default") defaultsUsed.push("positionCount");

  const maxPct = resolve(undefined, preferences.maxSinglePositionPct, PORTFOLIO_DEFAULTS.maxSinglePositionPct);
  sources.maxSinglePositionPct = maxPct.source;
  if (maxPct.source === "default") defaultsUsed.push("maxSinglePositionPct");

  return {
    resolved: {
      budget,
      riskProfile: risk.value,
      timeHorizon: horizon.value,
      assetScope: scope.value,
      positionCount: count.value,
      maxSinglePositionPct: maxPct.value,
    },
    sources,
    defaultsUsed,
    missingRequired,
  };
}

export function resolveOptionsScreenerSlots(
  entities: ExtractedEntities,
  preferences: Preferences = {},
): SlotResolution<OptionsScreenerSlots> {
  const sources = {} as Record<keyof OptionsScreenerSlots, SlotSource>;
  const defaultsUsed: string[] = [];
  const missingRequired: string[] = [];

  // Symbol: required, no default
  let symbol = "";
  if (entities.symbols.length > 0) {
    symbol = entities.symbols[0];
    sources.symbol = "user";
  } else {
    missingRequired.push("symbol");
    sources.symbol = "default";
  }

  // Direction: default to bullish
  const dir = resolve(entities.direction, undefined, "bullish" as const);
  sources.direction = dir.source;
  if (dir.source === "default") defaultsUsed.push("direction");

  const dte = resolve(mapDteHintToTarget(entities.dteHint), preferences.dteTarget, OPTIONS_SCREENER_DEFAULTS.dteTarget);
  sources.dteTarget = dte.source;
  if (dte.source === "default") defaultsUsed.push("dteTarget");

  const obj = resolve(undefined, preferences.objective, OPTIONS_SCREENER_DEFAULTS.objective);
  sources.objective = obj.source;
  if (obj.source === "default") defaultsUsed.push("objective");

  const moneyness = resolve(undefined, preferences.moneynessPreference, OPTIONS_SCREENER_DEFAULTS.moneynessPreference);
  sources.moneynessPreference = moneyness.source;
  if (moneyness.source === "default") defaultsUsed.push("moneynessPreference");

  const liquidity = resolve(undefined, preferences.liquidityMinimum, OPTIONS_SCREENER_DEFAULTS.liquidityMinimum);
  sources.liquidityMinimum = liquidity.source;
  if (liquidity.source === "default") defaultsUsed.push("liquidityMinimum");

  return {
    resolved: {
      symbol,
      direction: dir.value,
      dteTarget: dte.value,
      objective: obj.value,
      moneynessPreference: moneyness.value,
      liquidityMinimum: liquidity.value,
      budget: entities.budget,
      maxPremium: entities.maxPremium,
    },
    sources,
    defaultsUsed,
    missingRequired,
  };
}
