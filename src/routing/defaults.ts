import type { PortfolioSlots, OptionsScreenerSlots } from "./types.js";

export const PORTFOLIO_DEFAULTS: Omit<PortfolioSlots, "budget"> = {
  riskProfile: "balanced",
  timeHorizon: "1y_plus",
  assetScope: "mixed_etf_and_large_cap_equities",
  positionCount: 4,
  maxSinglePositionPct: 35,
};

export const OPTIONS_SCREENER_DEFAULTS: Omit<OptionsScreenerSlots, "symbol" | "direction"> = {
  dteTarget: "25_to_45_days",
  objective: "balanced_leverage_and_probability",
  moneynessPreference: "atm_to_slightly_otm",
  liquidityMinimum: "high_open_interest_and_tight_spread",
};

export function parseDteTarget(dteTarget: string): { minDays: number; maxDays: number } | null {
  const rangeMatch = dteTarget.match(/^(\d+)_to_(\d+)_days$/);
  if (rangeMatch) {
    return { minDays: parseInt(rangeMatch[1], 10), maxDays: parseInt(rangeMatch[2], 10) };
  }
  const plusMatch = dteTarget.match(/^(\d+)_plus_days$/);
  if (plusMatch) {
    const min = parseInt(plusMatch[1], 10);
    return { minDays: min, maxDays: min + 180 };
  }
  return null;
}
