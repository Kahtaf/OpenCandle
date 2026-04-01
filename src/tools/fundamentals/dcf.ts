import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getOverview, getFinancials } from "../../providers/alpha-vantage.js";
import { getQuote } from "../../providers/yahoo-finance.js";
import { getConfig } from "../../config.js";
import type { FinancialStatement } from "../../types/fundamentals.js";

export interface DCFResult {
  intrinsicValue: number;
  enterpriseValue: number;
  terminalValue: number;
  netDebt: number;
  projectedCashFlows: Array<{ year: number; fcf: number; presentValue: number }>;
  assumptions: {
    fcf: number;
    growthRate: number;
    discountRate: number;
    terminalGrowth: number;
    years: number;
  };
  sensitivityTable: Array<{ growthRate: number; discountRate: number; intrinsicValue: number }>;
  warnings: string[];
}

export interface DCFParams {
  freeCashFlow: number;
  growthRate: number;
  discountRate: number;
  terminalGrowth: number;
  years: number;
  netDebt: number;
  sharesOutstanding: number;
}

export function computeDCF(params: DCFParams): DCFResult {
  const { freeCashFlow, growthRate, discountRate, terminalGrowth, years, netDebt, sharesOutstanding } = params;

  // Project future cash flows (mid-year convention: discount at year-0.5)
  const projectedCashFlows: Array<{ year: number; fcf: number; presentValue: number }> = [];
  for (let y = 1; y <= years; y++) {
    const fcf = freeCashFlow * (1 + growthRate) ** y;
    const pv = fcf / (1 + discountRate) ** (y - 0.5); // mid-year convention
    projectedCashFlows.push({ year: y, fcf, presentValue: pv });
  }

  // Terminal value (Gordon Growth Model), discounted at full year (end of projection)
  const finalFCF = freeCashFlow * (1 + growthRate) ** years;
  const terminalValue = (finalFCF * (1 + terminalGrowth)) / (discountRate - terminalGrowth);
  const pvTerminal = terminalValue / (1 + discountRate) ** years;

  // Enterprise value
  const sumPVs = projectedCashFlows.reduce((s, cf) => s + cf.presentValue, 0);
  const enterpriseValue = sumPVs + pvTerminal;

  // Equity value → per share
  const equityValue = enterpriseValue - netDebt;
  const intrinsicValue = equityValue / sharesOutstanding;

  // Sensitivity table: vary growth ±2% and discount ±2%
  const sensitivityTable: Array<{ growthRate: number; discountRate: number; intrinsicValue: number }> = [];
  for (let gDelta = -0.02; gDelta <= 0.02; gDelta += 0.01) {
    for (let dDelta = -0.02; dDelta <= 0.02; dDelta += 0.01) {
      const g = growthRate + gDelta;
      const d = discountRate + dDelta;
      if (d <= terminalGrowth || d <= 0 || g < 0) continue;
      const sensResult = computeDCFSimple(freeCashFlow, g, d, terminalGrowth, years, netDebt, sharesOutstanding);
      sensitivityTable.push({ growthRate: g, discountRate: d, intrinsicValue: sensResult });
    }
  }

  // Validation warnings (inspired by Anthropic financial plugins + Dexter)
  const warnings: string[] = [];
  const tvPctOfEV = pvTerminal / enterpriseValue;
  if (tvPctOfEV > 0.85) {
    warnings.push(`Terminal value is ${(tvPctOfEV * 100).toFixed(0)}% of enterprise value (typical: 40-80%). The valuation is heavily dependent on terminal assumptions.`);
  }
  const spreadPct = discountRate - terminalGrowth;
  if (spreadPct < 0.02) {
    warnings.push(`Terminal growth (${(terminalGrowth * 100).toFixed(1)}%) is very close to discount rate (${(discountRate * 100).toFixed(1)}%). Small changes in assumptions will produce large swings in value.`);
  }
  if (discountRate < 0.05 || discountRate > 0.20) {
    warnings.push(`Discount rate of ${(discountRate * 100).toFixed(1)}% is outside typical WACC range (5-20%).`);
  }
  if (growthRate > 0.20) {
    warnings.push(`Growth rate of ${(growthRate * 100).toFixed(1)}% exceeds 20%. High growth is difficult to sustain — consider a multi-stage model.`);
  }

  return {
    intrinsicValue,
    enterpriseValue,
    terminalValue,
    netDebt,
    projectedCashFlows,
    assumptions: {
      fcf: freeCashFlow,
      growthRate,
      discountRate,
      terminalGrowth,
      years,
    },
    sensitivityTable,
    warnings,
  };
}

function computeDCFSimple(
  fcf: number, g: number, d: number, tg: number, years: number, debt: number, shares: number,
): number {
  let sumPV = 0;
  for (let y = 1; y <= years; y++) {
    sumPV += (fcf * (1 + g) ** y) / (1 + d) ** (y - 0.5); // mid-year convention
  }
  const finalFCF = fcf * (1 + g) ** years;
  const tv = (finalFCF * (1 + tg)) / (d - tg);
  const pvTV = tv / (1 + d) ** years;
  return (sumPV + pvTV - debt) / shares;
}

export function computeNetDebt(f: FinancialStatement): number {
  if (f.totalDebt != null && f.cashAndEquivalents != null) {
    return f.totalDebt - f.cashAndEquivalents;
  }
  // Fallback: totalLiabilities - totalAssets (negative means net cash position)
  return f.totalLiabilities - f.totalAssets;
}

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, MSFT)" }),
  growth_rate: Type.Optional(
    Type.Number({ description: "Annual FCF growth rate as decimal (e.g. 0.10 for 10%). If omitted, estimated from historical data." }),
  ),
  discount_rate: Type.Optional(
    Type.Number({ description: "Discount rate / WACC as decimal (default: 0.10 for 10%)" }),
  ),
  terminal_growth: Type.Optional(
    Type.Number({ description: "Terminal growth rate as decimal (default: 0.03 for 3%)" }),
  ),
  projection_years: Type.Optional(
    Type.Number({ description: "Years to project forward (default: 5)" }),
  ),
});

export const dcfTool: AgentTool<typeof params> = {
  name: "compute_dcf",
  label: "DCF Valuation",
  description:
    "Compute a Discounted Cash Flow (DCF) intrinsic value estimate for a stock. Uses free cash flow, growth projections, and a discount rate to estimate what the stock is worth. Returns intrinsic value per share, margin of safety vs current price, and a sensitivity table.",
  parameters: params,
  async execute(toolCallId, args) {
    const symbol = args.symbol.toUpperCase();
    const config = getConfig();

    if (!config.alphaVantageApiKey) {
      throw new Error("Alpha Vantage API key not configured. Set ALPHA_VANTAGE_API_KEY or add ~/.opencandle/config.json.");
    }

    const [overview, financials, quote] = await Promise.all([
      getOverview(symbol, config.alphaVantageApiKey),
      getFinancials(symbol, config.alphaVantageApiKey),
      getQuote(symbol),
    ]);

    const latestFCF = financials[0]?.freeCashFlow ?? 0;
    if (latestFCF <= 0) {
      return {
        content: [{ type: "text", text: `${symbol} has negative or zero free cash flow ($${latestFCF.toLocaleString()}). DCF is not meaningful for companies without positive FCF.` }],
        details: null,
      };
    }

    // Estimate growth from historical FCF if not provided
    let growthRate = args.growth_rate ?? 0.10;
    if (!args.growth_rate && financials.length >= 2) {
      const olderFCF = financials[1]?.freeCashFlow;
      if (olderFCF && olderFCF > 0) {
        growthRate = Math.max(0.02, Math.min(0.25, (latestFCF - olderFCF) / olderFCF));
      }
    }

    const discountRate = args.discount_rate ?? 0.10;
    const terminalGrowth = args.terminal_growth ?? 0.03;
    const years = args.projection_years ?? 5;
    const sharesOutstanding = quote.price > 0 ? overview.marketCap / quote.price : 1;
    const netDebt = financials[0] ? computeNetDebt(financials[0]) : 0;

    const result = computeDCF({
      freeCashFlow: latestFCF,
      growthRate,
      discountRate,
      terminalGrowth,
      years,
      netDebt: Math.max(0, netDebt),
      sharesOutstanding,
    });

    const marginOfSafety = (result.intrinsicValue - quote.price) / result.intrinsicValue;
    const upside = (result.intrinsicValue - quote.price) / quote.price;

    const lines = [
      `**${symbol} DCF Valuation**`,
      ``,
      `Current Price: $${quote.price.toFixed(2)}`,
      `Intrinsic Value: $${result.intrinsicValue.toFixed(2)}`,
      `Margin of Safety: ${(marginOfSafety * 100).toFixed(1)}%`,
      `Upside/Downside: ${upside >= 0 ? "+" : ""}${(upside * 100).toFixed(1)}%`,
      ``,
      `**Assumptions**`,
      `Free Cash Flow: $${(latestFCF / 1e9).toFixed(2)}B`,
      `Growth Rate: ${(growthRate * 100).toFixed(1)}%`,
      `Discount Rate (WACC): ${(discountRate * 100).toFixed(1)}%`,
      `Terminal Growth: ${(terminalGrowth * 100).toFixed(1)}%`,
      `Projection: ${years} years`,
      ``,
      `**Projected Cash Flows**`,
      ...result.projectedCashFlows.map((cf) =>
        `  Year ${cf.year}: FCF $${(cf.fcf / 1e9).toFixed(2)}B → PV $${(cf.presentValue / 1e9).toFixed(2)}B`
      ),
      `  Terminal Value: $${(result.terminalValue / 1e9).toFixed(2)}B`,
      `  Enterprise Value: $${(result.enterpriseValue / 1e9).toFixed(2)}B`,
      ``,
      `**Sensitivity Table** (Intrinsic Value at different Growth/Discount rates)`,
      ...formatSensitivityTable(result.sensitivityTable),
    ];

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: { ...result, currentPrice: quote.price, marginOfSafety, upside },
    };
  },
};

function formatSensitivityTable(
  table: Array<{ growthRate: number; discountRate: number; intrinsicValue: number }>,
): string[] {
  if (table.length === 0) return ["  (insufficient data for sensitivity table)"];

  const discountRates = [...new Set(table.map((e) => e.discountRate))].sort((a, b) => a - b);
  const growthRates = [...new Set(table.map((e) => e.growthRate))].sort((a, b) => a - b);

  const header = `  ${"Growth↓/WACC→".padEnd(14)} ${discountRates.map((d) => `${(d * 100).toFixed(0)}%`.padStart(8)).join("")}`;
  const rows = growthRates.map((g) => {
    const cells = discountRates.map((d) => {
      const entry = table.find((e) => e.growthRate === g && e.discountRate === d);
      return entry ? `$${entry.intrinsicValue.toFixed(0)}`.padStart(8) : "N/A".padStart(8);
    });
    return `  ${`${(g * 100).toFixed(0)}%`.padEnd(14)} ${cells.join("")}`;
  });

  return [header, ...rows];
}
