import type { RiskLookbackPeriod } from "../types/portfolio.js";

export function isLongInvestmentHorizon(timeHorizon: string | undefined): boolean {
  if (!timeHorizon) return false;
  const normalized = timeHorizon.toLowerCase();
  if (normalized === "long" || normalized === "long_term") return true;
  const years = normalized.match(/^(\d+)_years$/);
  return years ? Number(years[1]) >= 3 : false;
}

const QUALITATIVE_HORIZON_MONTHS: Record<string, number> = {
  short: 6,
  short_term: 6,
  medium: 24,
  medium_term: 24,
  long: 60,
  long_term: 60,
};

function horizonMonths(timeHorizon: string): number | undefined {
  const normalized = timeHorizon.trim().toLowerCase();
  const qualitative = QUALITATIVE_HORIZON_MONTHS[normalized];
  if (qualitative !== undefined) return qualitative;
  const match = normalized.match(
    /^(\d+(?:\.\d+)?)\s*[-_ ]?\s*(mo|mos|month|months|y|yr|yrs|year|years)(?![a-z])/,
  );
  if (!match) return undefined;
  const amount = Number(match[1]);
  if (!(amount > 0)) return undefined;
  return match[2].startsWith("m") ? amount : amount * 12;
}

/**
 * Maps an investment horizon (e.g. "10y", "18mo", "3_years", "long") to the
 * historical lookback window the risk tools accept. The horizon is how long the
 * user plans to hold; the lookback is how much price history the metrics use.
 * Rule: up to 6 months -> 6mo, up to 1 year -> 1y, up to 2 years -> 2y,
 * anything longer -> 5y (the longest supported window). Qualitative horizons:
 * short -> 6mo, medium -> 2y, long -> 5y. Returns undefined when the horizon
 * cannot be interpreted.
 */
export function riskLookbackForHorizon(
  timeHorizon: string | undefined,
): RiskLookbackPeriod | undefined {
  if (!timeHorizon) return undefined;
  const months = horizonMonths(timeHorizon);
  if (months === undefined) return undefined;
  if (months <= 6) return "6mo";
  if (months <= 12) return "1y";
  if (months <= 24) return "2y";
  return "5y";
}

export type LookbackTool = "analyze_risk" | "analyze_correlation";

/**
 * Prompt instruction that pins analyze_risk / analyze_correlation to a supported
 * lookback window instead of letting the model copy the investment horizon
 * into the tool's period argument. Pass only the tools the prompt actually
 * asks for so the instruction never invites an extra call.
 */
export function riskLookbackInstruction(
  timeHorizon: string,
  tools: readonly LookbackTool[] = ["analyze_risk", "analyze_correlation"],
): string {
  const toolList = tools.join(" and ");
  const lookback = riskLookbackForHorizon(timeHorizon);
  if (!lookback) {
    return `Use a supported lookback window (6mo, 1y, 2y, or 5y) for ${toolList}; do not pass the investment horizon as the period.`;
  }
  return `Use a ${lookback} lookback window for ${toolList} (investment horizon: ${timeHorizon}). The lookback is the historical data period, not the investment horizon.`;
}
