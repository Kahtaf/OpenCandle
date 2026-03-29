import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getHistory } from "../../providers/yahoo-finance.js";
import { computeSMA, computeRSI } from "./indicators.js";
import type { OHLCV } from "../../types/market.js";

export type Strategy = "sma_crossover" | "rsi_mean_reversion";

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
  const buyAndHoldReturn = closes.length > 1
    ? (closes[closes.length - 1] - closes[0]) / closes[0]
    : 0;

  if (strategy === "sma_crossover") {
    return backtestSMACrossover(bars, closes);
  }
  return backtestRSIMeanReversion(bars, closes);
}

function backtestSMACrossover(bars: OHLCV[], closes: number[]): BacktestResult {
  const sma20 = computeSMA(closes, 20);
  const sma50 = computeSMA(closes, 50);

  if (sma50.length === 0) {
    return emptyResult("sma_crossover", closes);
  }

  // Align: SMA(20) starts at index 19, SMA(50) at index 49
  // sma20[i] corresponds to closes[i + 19], sma50[i] to closes[i + 49]
  const offset20 = 19;
  const offset50 = 49;

  let position = false;
  let entryPrice = 0;
  const tradeLog: BacktestResult["tradeLog"] = [];
  let equity = 1.0;
  let peak = 1.0;
  let maxDd = 0;

  for (let i = 0; i < sma50.length; i++) {
    const barIdx = i + offset50;
    const sma20Idx = i + (offset50 - offset20);
    const s20 = sma20[sma20Idx];
    const s50 = sma50[i];
    const price = closes[barIdx];

    if (!position && s20 > s50) {
      // Buy signal
      position = true;
      entryPrice = price;
      tradeLog.push({ type: "buy", date: bars[barIdx].date, price });
    } else if (position && s20 < s50) {
      // Sell signal
      const pnl = (price - entryPrice) / entryPrice;
      equity *= 1 + pnl;
      tradeLog.push({ type: "sell", date: bars[barIdx].date, price, pnl });
      position = false;
    }

    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  // Close open position at end
  if (position) {
    const lastPrice = closes[closes.length - 1];
    const pnl = (lastPrice - entryPrice) / entryPrice;
    equity *= 1 + pnl;
    tradeLog.push({ type: "sell", date: bars[bars.length - 1].date, price: lastPrice, pnl });
  }

  return buildResult("sma_crossover", equity - 1, closes, tradeLog, maxDd);
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

    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
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
    [Type.Literal("sma_crossover"), Type.Literal("rsi_mean_reversion")],
    { description: "Strategy: sma_crossover (buy when SMA20 > SMA50, sell on reverse) or rsi_mean_reversion (buy when RSI < 30, sell when RSI > 70)" },
  ),
  period: Type.Optional(
    Type.String({ description: "Historical period to backtest: 1y, 2y, 5y. Default: 2y" }),
  ),
});

export const backtestTool: AgentTool<typeof params> = {
  name: "backtest_strategy",
  label: "Backtest Strategy",
  description:
    "Backtest a simple trading strategy against historical data. Supported strategies: SMA crossover (SMA20/SMA50) and RSI mean-reversion (buy <30, sell >70). Returns total return, win rate, max drawdown, and comparison to buy-and-hold.",
  parameters: params,
  async execute(toolCallId, args) {
    const symbol = args.symbol.toUpperCase();
    const period = args.period ?? "2y";
    const bars = await getHistory(symbol, period, "1d");

    if (bars.length < 60) {
      return {
        content: [{ type: "text", text: `Insufficient data for backtesting ${symbol} (need 60+ days, got ${bars.length})` }],
        details: null,
      };
    }

    const result = runBacktest(bars, args.strategy);

    const outperformance = result.totalReturn - result.buyAndHoldReturn;
    const lines = [
      `**${symbol} Backtest: ${args.strategy}** (${bars[0].date} to ${bars[bars.length - 1].date}, ${bars.length} days)`,
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
