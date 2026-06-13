import type { OptionsScreenerSlots, PortfolioSlots } from "./types.js";

export const PORTFOLIO_DEFAULTS: Omit<PortfolioSlots, "budget"> = {
  riskProfile: "balanced",
  timeHorizon: "1y_plus",
  assetScope: "diversified_etf_building_blocks",
  positionCount: 6,
  maxSinglePositionPct: 20,
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
    return { minDays: min, maxDays: Math.max(min, 1095) };
  }
  return null;
}
