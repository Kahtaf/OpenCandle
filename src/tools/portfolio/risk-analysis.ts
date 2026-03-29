import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getHistory } from "../../providers/yahoo-finance.js";
import type { RiskMetrics } from "../../types/portfolio.js";

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, MSFT, SPY)" }),
  period: Type.Optional(
    Type.String({ description: "Historical period for analysis: 6mo, 1y, 2y. Default: 1y" }),
  ),
});

export const riskAnalysisTool: AgentTool<typeof params, RiskMetrics> = {
  name: "analyze_risk",
  label: "Risk Analysis",
  description:
    "Compute risk metrics for a stock: annualized return, volatility, Sharpe ratio, max drawdown, and Value at Risk (95%). All computed locally from historical data.",
  parameters: params,
  async execute(toolCallId, args) {
    const symbol = args.symbol.toUpperCase();
    const period = args.period ?? "1y";
    const bars = await getHistory(symbol, period, "1d");
    const closes = bars.map((b) => b.close);

    if (closes.length < 30) {
      return {
        content: [{ type: "text", text: `Insufficient data for risk analysis (need 30+ days, got ${closes.length})` }],
        details: null as any,
      };
    }

    const metrics = computeRiskMetrics(symbol, closes);

    const text = [
      `**${symbol} Risk Analysis** (${bars[0].date} to ${bars[bars.length - 1].date}, ${closes.length} days)`,
      ``,
      `Annualized Return: ${(metrics.annualizedReturn * 100).toFixed(2)}%`,
      `Annualized Volatility: ${(metrics.annualizedVolatility * 100).toFixed(2)}%`,
      `Sharpe Ratio: ${metrics.sharpeRatio.toFixed(2)} ${sharpeLabel(metrics.sharpeRatio)}`,
      `Max Drawdown: ${(metrics.maxDrawdown * 100).toFixed(2)}%`,
      `Value at Risk (95%, daily): ${(metrics.var95 * 100).toFixed(2)}%`,
      ``,
      riskSummary(metrics),
    ].join("\n");

    return { content: [{ type: "text", text }], details: metrics };
  },
};

export function computeRiskMetrics(symbol: string, closes: number[]): RiskMetrics {
  const dailyReturns = computeDailyReturns(closes);
  const avgDailyReturn = mean(dailyReturns);
  const dailyVol = stddev(dailyReturns);

  const annualizedReturn = avgDailyReturn * 252;
  const annualizedVolatility = dailyVol * Math.sqrt(252);

  // Sharpe ratio (assuming 5% risk-free rate)
  const riskFreeDaily = 0.05 / 252;
  const sharpeRatio =
    dailyVol === 0 ? 0 : ((avgDailyReturn - riskFreeDaily) / dailyVol) * Math.sqrt(252);

  const maxDrawdown = computeMaxDrawdown(closes);
  const var95 = computeVaR(dailyReturns, 0.05);

  return {
    symbol,
    annualizedReturn,
    annualizedVolatility,
    sharpeRatio,
    maxDrawdown,
    var95,
  };
}

export function computeDailyReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return returns;
}

export function computeMaxDrawdown(prices: number[]): number {
  let peak = prices[0];
  let maxDd = 0;
  for (const price of prices) {
    if (price > peak) peak = price;
    const dd = (peak - price) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

export function computeVaR(returns: number[], confidence: number): number {
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * confidence);
  return Math.abs(sorted[idx]);
}

function mean(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stddev(arr: number[]): number {
  const m = mean(arr);
  const variance = arr.reduce((sum, val) => sum + (val - m) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

function sharpeLabel(s: number): string {
  if (s >= 2) return "(Excellent)";
  if (s >= 1) return "(Good)";
  if (s >= 0) return "(Below average)";
  return "(Negative — losing money)";
}

function riskSummary(m: RiskMetrics): string {
  const signals: string[] = [];
  if (m.annualizedVolatility > 0.4) signals.push("High volatility stock");
  if (m.maxDrawdown > 0.3) signals.push("Large historical drawdown (>30%)");
  if (m.sharpeRatio < 0) signals.push("Negative risk-adjusted returns");
  if (m.sharpeRatio >= 1.5) signals.push("Strong risk-adjusted performance");
  if (m.var95 > 0.03) signals.push("High daily VaR (>3%)");
  return signals.length > 0 ? "Flags: " + signals.join(" | ") : "Risk profile appears moderate";
}
