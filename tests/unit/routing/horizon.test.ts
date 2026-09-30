import { describe, expect, it } from "vitest";
import { riskLookbackForHorizon } from "../../../src/routing/horizon.js";
import { correlationTool } from "../../../src/tools/portfolio/correlation.js";
import { riskAnalysisTool } from "../../../src/tools/portfolio/risk-analysis.js";
import { RISK_LOOKBACK_PERIODS } from "../../../src/types/portfolio.js";

function periodLiterals(schema: unknown): string[] {
  const period = (schema as { properties: { period: { anyOf: Array<{ const: string }> } } })
    .properties.period;
  return period.anyOf.map((option) => option.const);
}

describe("riskLookbackForHorizon", () => {
  it.each([
    ["3mo", "6mo"],
    ["6mo", "6mo"],
    ["6 months", "6mo"],
    ["9mo", "1y"],
    ["1y", "1y"],
    ["1y_plus", "1y"],
    ["12 months", "1y"],
    ["18mo", "2y"],
    ["2y", "2y"],
    ["2_years", "2y"],
    ["3y", "5y"],
    ["5y", "5y"],
    ["10y", "5y"],
    ["10_years", "5y"],
    ["10 years", "5y"],
    ["20-year", "5y"],
    ["short", "6mo"],
    ["short_term", "6mo"],
    ["medium", "2y"],
    ["long", "5y"],
    ["long_term", "5y"],
  ])("maps %s to the %s lookback", (horizon, expected) => {
    expect(riskLookbackForHorizon(horizon)).toBe(expected);
  });

  it.each([undefined, "", "soon", "0y", "whenever"])(
    "returns undefined for unmappable horizon %s",
    (horizon) => {
      expect(riskLookbackForHorizon(horizon)).toBeUndefined();
    },
  );

  it("only returns periods accepted by analyze_risk and analyze_correlation", () => {
    expect(periodLiterals(riskAnalysisTool.parameters)).toEqual([...RISK_LOOKBACK_PERIODS]);
    expect(periodLiterals(correlationTool.parameters)).toEqual([...RISK_LOOKBACK_PERIODS]);
    for (const horizon of ["1mo", "1y", "18mo", "30y", "short", "long"]) {
      expect(RISK_LOOKBACK_PERIODS).toContain(riskLookbackForHorizon(horizon));
    }
  });
});
