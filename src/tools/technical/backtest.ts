import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getHistory } from "../../providers/yahoo-finance.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { computeSMA, computeRSI } from "./indicators.js";
import type { OHLCV } from "../../types/market.js";

export type Strategy = "sma_crossover" | "sma_50_200_crossover" | "rsi_mean_reversion";

export interface BacktestResult {
  strategy: string;
  totalReturn: number;
  buyAndHoldReturn: number;
  trades: number;
  wins: number;
  winRate: number;
  maxDrawdown: number;
  tradeLog: Array<{ type: "buy" | "sell"; date: string; price: number; pnl?: number }>;
}

export function runBacktest(bars: OHLCV[], strategy: Strategy): BacktestResult {
  const closes = bars.map((b) => b.close);

  if (strategy === "sma_crossover") {
    return backtestSMACrossover(bars, closes, 20, 50, strategy);
  }
  if (strategy === "sma_50_200_crossover") {
    return backtestSMACrossover(bars, closes, 50, 200, strategy);
  }
  return backtestRSIMeanReversion(bars, closes);
}

function backtestSMACrossover(
  bars: OHLCV[],
  closes: number[],
  shortWindow: number,
  longWindow: number,
  strategyName: Strategy,
): BacktestResult {
  const shortSma = computeSMA(closes, shortWindow);
  const longSma = computeSMA(closes, longWindow);

  if (longSma.length === 0) {
    return emptyResult(strategyName, closes);
  }

  const shortOffset = shortWindow - 1;
  const longOffset = longWindow - 1;

  let position = false;
  let entryPrice = 0;
  const tradeLog: BacktestResult["tradeLog"] = [];
  let equity = 1.0;
  let peak = 1.0;
  let maxDd = 0;

  for (let i = 0; i < longSma.length; i++) {
    const barIdx = i + longOffset;
    const shortSmaIdx = i + (longOffset - shortOffset);
    const sShort = shortSma[shortSmaIdx];
    const sLong = longSma[i];
    const price = closes[barIdx];

    if (!position && sShort > sLong) {
      // Buy signal
      position = true;
      entryPrice = price;
      tradeLog.push({ type: "buy", date: bars[barIdx].date, price });
    } else if (position && sShort < sLong) {
      // Sell signal
      const pnl = (price - entryPrice) / entryPrice;
      equity *= 1 + pnl;
      tradeLog.push({ type: "sell", date: bars[barIdx].date, price, pnl });
      position = false;
    }

    // Track mark-to-market equity for accurate drawdown
    const currentEquity = position
      ? equity * (1 + (price - entryPrice) / entryPrice)
      : equity;
    if (currentEquity > peak) peak = currentEquity;
    const dd = (peak - currentEquity) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  // Close open position at end
  if (position) {
    const lastPrice = closes[closes.length - 1];
    const pnl = (lastPrice - entryPrice) / entryPrice;
    equity *= 1 + pnl;
    tradeLog.push({ type: "sell", date: bars[bars.length - 1].date, price: lastPrice, pnl });
  }

  return buildResult(strategyName, equity - 1, closes, tradeLog, maxDd);
}

function backtestRSIMeanReversion(bars: OHLCV[], closes: number[]): BacktestResult {
  const rsi = computeRSI(closes, 14);

  if (rsi.length === 0) {
    return emptyResult("rsi_mean_reversion", closes);
  }

  // RSI starts at index 14 (after 14 periods of data)
  const rsiOffset = 14;
  let position = false;
  let entryPrice = 0;
  const tradeLog: BacktestResult["tradeLog"] = [];
  let equity = 1.0;
  let peak = 1.0;
  let maxDd = 0;

  for (let i = 0; i < rsi.length; i++) {
    const barIdx = i + rsiOffset;
    const r = rsi[i];
    const price = closes[barIdx];

    if (!position && r < 30) {
      // RSI oversold → buy
      position = true;
      entryPrice = price;
      tradeLog.push({ type: "buy", date: bars[barIdx].date, price });
    } else if (position && r > 70) {
      // RSI overbought → sell
      const pnl = (price - entryPrice) / entryPrice;
      equity *= 1 + pnl;
      tradeLog.push({ type: "sell", date: bars[barIdx].date, price, pnl });
      position = false;
    }

    // Track mark-to-market equity for accurate drawdown
    const currentEquity = position
      ? equity * (1 + (price - entryPrice) / entryPrice)
      : equity;
    if (currentEquity > peak) peak = currentEquity;
    const dd = (peak - currentEquity) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  // Close open position at end
  if (position) {
    const lastPrice = closes[closes.length - 1];
    const pnl = (lastPrice - entryPrice) / entryPrice;
    equity *= 1 + pnl;
    tradeLog.push({ type: "sell", date: bars[bars.length - 1].date, price: lastPrice, pnl });
  }

  return buildResult("rsi_mean_reversion", equity - 1, closes, tradeLog, maxDd);
}

function buildResult(
  strategy: string,
  totalReturn: number,
  closes: number[],
  tradeLog: BacktestResult["tradeLog"],
  maxDrawdown: number,
): BacktestResult {
  const sellTrades = tradeLog.filter((t) => t.type === "sell" && t.pnl != null);
  const wins = sellTrades.filter((t) => t.pnl! > 0).length;
  const buyAndHoldReturn = closes.length > 1
    ? (closes[closes.length - 1] - closes[0]) / closes[0]
    : 0;

  return {
    strategy,
    totalReturn,
    buyAndHoldReturn,
    trades: sellTrades.length,
    wins,
    winRate: sellTrades.length > 0 ? wins / sellTrades.length : 0,
    maxDrawdown,
    tradeLog,
  };
}

function emptyResult(strategy: string, closes: number[]): BacktestResult {
  return {
    strategy,
    totalReturn: 0,
    buyAndHoldReturn: closes.length > 1
      ? (closes[closes.length - 1] - closes[0]) / closes[0]
      : 0,
    trades: 0,
    wins: 0,
    winRate: 0,
    maxDrawdown: 0,
    tradeLog: [],
  };
}

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, MSFT, SPY)" }),
  strategy: Type.Union(
    [Type.Literal("sma_crossover"), Type.Literal("sma_50_200_crossover"), Type.Literal("rsi_mean_reversion")],
    { description: "Strategy: sma_crossover (buy when SMA20 > SMA50, sell on reverse), sma_50_200_crossover (buy when SMA50 > SMA200, sell on reverse), or rsi_mean_reversion (buy when RSI < 30, sell when RSI > 70)" },
  ),
  period: Type.Optional(
    Type.String({ description: "Historical period to backtest: 1y, 2y, 5y. Default: 2y" }),
  ),
});

export const backtestTool: AgentTool<typeof params> = {
  name: "backtest_strategy",
  label: "Backtest Strategy",
  description:
    "Backtest a simple trading strategy against historical data. Supported strategies: SMA crossover (SMA20/SMA50), standard long-term SMA crossover (SMA50/SMA200), and RSI mean-reversion (buy <30, sell >70). Returns total return, win rate, max drawdown, and comparison to buy-and-hold.",
  parameters: params,
  async execute(_toolCallId, args) {
    const symbol = args.symbol.toUpperCase();
    const period = args.period ?? "2y";
    const historyResult = await wrapProvider("yahoo", () => getHistory(symbol, period, "1d"));
    if (historyResult.status === "unavailable") {
      return {
        content: [{ type: "text", text: `⚠ Backtest unavailable for ${symbol} (${historyResult.reason}).` }],
        details: null as any,
      };
    }
    const bars = historyResult.data;

    const minBars = requiredBarsForStrategy(args.strategy);
    if (bars.length < minBars) {
      return {
        content: [{ type: "text", text: `Insufficient data for backtesting ${symbol} (need ${minBars}+ days, got ${bars.length})` }],
        details: null,
      };
    }

    const result = runBacktest(bars, args.strategy);

    const outperformance = result.totalReturn - result.buyAndHoldReturn;
    const lines = [
      `**${symbol} Backtest: ${strategyLabel(args.strategy)}** (${bars[0].date} to ${bars[bars.length - 1].date}, ${bars.length} days)`,
      ``,
      `Strategy Return: ${(result.totalReturn * 100).toFixed(2)}%`,
      `Buy & Hold Return: ${(result.buyAndHoldReturn * 100).toFixed(2)}%`,
      `Outperformance: ${outperformance >= 0 ? "+" : ""}${(outperformance * 100).toFixed(2)}%`,
      ``,
      `Trades: ${result.trades} | Wins: ${result.wins} | Win Rate: ${(result.winRate * 100).toFixed(0)}%`,
      `Max Drawdown: ${(result.maxDrawdown * 100).toFixed(2)}%`,
      ``,
      result.totalReturn > result.buyAndHoldReturn
        ? `Strategy outperformed buy-and-hold by ${(outperformance * 100).toFixed(2)}%.`
        : `Buy-and-hold outperformed the strategy by ${(-outperformance * 100).toFixed(2)}%.`,
    ];

    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: result,
    };
  },
};

function requiredBarsForStrategy(strategy: Strategy): number {
  if (strategy === "sma_50_200_crossover") return 200;
  return 60;
}

function strategyLabel(strategy: Strategy): string {
  switch (strategy) {
    case "sma_crossover":
      return "SMA 20/50 Crossover";
    case "sma_50_200_crossover":
      return "SMA 50/200 Crossover";
    case "rsi_mean_reversion":
      return "RSI Mean Reversion";
  }
}
