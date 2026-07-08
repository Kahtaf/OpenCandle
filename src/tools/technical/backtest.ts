import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { getHistory } from "../../providers/yahoo-finance.js";
import type { OHLCV } from "../../types/market.js";
import { computeRSI, computeSMA } from "./indicators.js";

export type Strategy = "sma_crossover" | "sma_50_200_crossover" | "rsi_mean_reversion";

/** Flat per-side transaction cost assumption, in basis points. */
export const DEFAULT_COST_BPS = 5;

/** What this simulator deliberately does not model. Rendered in tool output. */
export const BACKTEST_LIMITATIONS = [
  "Fills are simulated at the next bar's open after a signal; intrabar moves and gaps beyond that open are not modeled",
  "Only a flat per-side cost is applied — no slippage model, spreads, or market impact",
  "Dividends, taxes, and financing costs are excluded",
  "Liquidity is assumed unlimited at the fill price",
];

export interface BacktestOptions {
  /** Flat per-side cost in basis points applied to every fill. */
  costBps?: number;
}

export interface BacktestTrade {
  type: "buy" | "sell";
  date: string;
  price: number;
  pnl?: number;
  forced?: boolean;
}

export interface BacktestResult {
  strategy: string;
  totalReturn: number;
  buyAndHoldReturn: number;
  trades: number;
  forcedClosures: number;
  wins: number;
  winRate: number;
  maxDrawdown: number;
  costBpsPerSide: number;
  /** Signal generated on the final bar that has no next open to fill at. */
  pendingSignal: { type: "buy" | "sell"; date: string } | null;
  tradeLog: BacktestTrade[];
}

type Signal = "enter" | "exit" | null;

export function runBacktest(
  bars: OHLCV[],
  strategy: Strategy,
  options?: BacktestOptions,
): BacktestResult {
  const closes = bars.map((b) => b.close);
  const costBps = options?.costBps ?? DEFAULT_COST_BPS;

  if (strategy === "sma_crossover" || strategy === "sma_50_200_crossover") {
    const [shortWindow, longWindow] = strategy === "sma_crossover" ? [20, 50] : [50, 200];
    const shortSma = computeSMA(closes, shortWindow);
    const longSma = computeSMA(closes, longWindow);
    if (longSma.length === 0) {
      return emptyResult(strategy, closes, costBps);
    }
    const signalAt = (barIdx: number): Signal => {
      const sShort = shortSma[barIdx - (shortWindow - 1)];
      const sLong = longSma[barIdx - (longWindow - 1)];
      if (sShort > sLong) return "enter";
      if (sShort < sLong) return "exit";
      return null;
    };
    return simulate(bars, closes, signalAt, longWindow - 1, strategy, costBps);
  }

  const rsi = computeRSI(closes, 14);
  if (rsi.length === 0) {
    return emptyResult("rsi_mean_reversion", closes, costBps);
  }
  const rsiOffset = 14;
  const signalAt = (barIdx: number): Signal => {
    const r = rsi[barIdx - rsiOffset];
    if (r < 30) return "enter";
    if (r > 70) return "exit";
    return null;
  };
  return simulate(bars, closes, signalAt, rsiOffset, "rsi_mean_reversion", costBps);
}

// Shared fill engine: a signal computed from bar N's close fills at bar N+1's
// open (no same-bar lookahead), with a flat per-side cost on every fill. A
// signal on the final bar is reported as pending instead of a phantom trade.
function simulate(
  bars: OHLCV[],
  closes: number[],
  signalAt: (barIdx: number) => Signal,
  startIdx: number,
  strategyName: Strategy,
  costBps: number,
): BacktestResult {
  const cost = costBps / 10_000;
  let position = false;
  let entryFill = 0;
  let pendingAction: Signal = null;
  let pendingSignal: BacktestResult["pendingSignal"] = null;
  const tradeLog: BacktestResult["tradeLog"] = [];
  let equity = 1.0;
  let peak = 1.0;
  let maxDd = 0;

  for (let i = startIdx; i < bars.length; i++) {
    // Execute the previous bar's signal at this bar's open.
    if (pendingAction === "enter" && !position) {
      const fillPrice = bars[i].open;
      if (fillPrice > 0) {
        position = true;
        entryFill = fillPrice * (1 + cost);
        tradeLog.push({ type: "buy", date: bars[i].date, price: fillPrice });
      }
    } else if (pendingAction === "exit" && position) {
      const fillPrice = bars[i].open;
      if (fillPrice > 0 && entryFill > 0) {
        const pnl = (fillPrice * (1 - cost) - entryFill) / entryFill;
        equity *= 1 + pnl;
        tradeLog.push({ type: "sell", date: bars[i].date, price: fillPrice, pnl });
        position = false;
      }
    }
    pendingAction = null;

    // Evaluate the signal at this bar's close.
    const signal = signalAt(i);
    if ((signal === "enter" && !position) || (signal === "exit" && position)) {
      if (i + 1 >= bars.length) {
        pendingSignal = { type: signal === "enter" ? "buy" : "sell", date: bars[i].date };
      } else {
        pendingAction = signal;
      }
    }

    // Track mark-to-market equity for accurate drawdown.
    const price = closes[i];
    const currentEquity =
      position && entryFill > 0 && price > 0
        ? equity * (1 + (price - entryFill) / entryFill)
        : equity;
    if (currentEquity > peak) peak = currentEquity;
    const dd = (peak - currentEquity) / peak;
    if (dd > maxDd) maxDd = dd;
  }

  // Close any open position at the final close for reporting.
  if (position && entryFill > 0) {
    const lastPrice = closes[closes.length - 1];
    if (lastPrice > 0) {
      const pnl = (lastPrice * (1 - cost) - entryFill) / entryFill;
      equity *= 1 + pnl;
      tradeLog.push({
        type: "sell",
        date: bars[bars.length - 1].date,
        price: lastPrice,
        pnl,
        forced: true,
      });
    }
  }

  return buildResult(strategyName, equity - 1, closes, tradeLog, maxDd, costBps, pendingSignal);
}

function buildResult(
  strategy: string,
  totalReturn: number,
  closes: number[],
  tradeLog: BacktestResult["tradeLog"],
  maxDrawdown: number,
  costBpsPerSide: number,
  pendingSignal: BacktestResult["pendingSignal"],
): BacktestResult {
  const sellTrades = tradeLog.filter(
    (t): t is BacktestTrade & { type: "sell"; pnl: number } =>
      t.type === "sell" && t.pnl != null && !t.forced,
  );
  const forcedClosures = tradeLog.filter((t) => t.type === "sell" && t.forced).length;
  const wins = sellTrades.filter((t) => t.pnl > 0).length;
  const buyAndHoldReturn =
    closes.length > 1 && closes[0] > 0 ? (closes[closes.length - 1] - closes[0]) / closes[0] : 0;

  return {
    strategy,
    totalReturn,
    buyAndHoldReturn,
    trades: sellTrades.length,
    forcedClosures,
    wins,
    winRate: sellTrades.length > 0 ? wins / sellTrades.length : 0,
    maxDrawdown,
    costBpsPerSide,
    pendingSignal,
    tradeLog,
  };
}

function emptyResult(strategy: string, closes: number[], costBpsPerSide: number): BacktestResult {
  return {
    strategy,
    totalReturn: 0,
    buyAndHoldReturn:
      closes.length > 1 && closes[0] > 0 ? (closes[closes.length - 1] - closes[0]) / closes[0] : 0,
    trades: 0,
    forcedClosures: 0,
    wins: 0,
    winRate: 0,
    maxDrawdown: 0,
    costBpsPerSide,
    pendingSignal: null,
    tradeLog: [],
  };
}

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, MSFT, SPY)" }),
  strategy: Type.Union(
    [
      Type.Literal("sma_crossover"),
      Type.Literal("sma_50_200_crossover"),
      Type.Literal("rsi_mean_reversion"),
    ],
    {
      description:
        "Strategy: sma_crossover (buy when SMA20 > SMA50, sell on reverse), sma_50_200_crossover (buy when SMA50 > SMA200, sell on reverse), or rsi_mean_reversion (buy when RSI < 30, sell when RSI > 70)",
    },
  ),
  period: Type.Optional(
    Type.Union([Type.Literal("1y"), Type.Literal("2y"), Type.Literal("5y")], {
      description: "Historical period to backtest: 1y, 2y, 5y. Default: 2y",
    }),
  ),
  cost_bps: Type.Optional(
    Type.Number({
      minimum: 0,
      maximum: 100,
      description: `Flat per-side transaction cost in basis points applied to every fill. Default: ${DEFAULT_COST_BPS}`,
    }),
  ),
});

export const backtestTool: AgentTool<typeof params> = {
  name: "backtest_strategy",
  label: "Backtest Strategy",
  description:
    "Replay a simple trading strategy against historical daily bars. Signals fill at the next bar's open with a flat per-side cost assumption; dividends, taxes, slippage beyond that cost, and liquidity are not modeled. Supported strategies: SMA crossover (SMA20/SMA50), standard long-term SMA crossover (SMA50/SMA200), and RSI mean-reversion (buy <30, sell >70). Returns total return, win rate, max drawdown, and comparison to buy-and-hold.",
  parameters: params,
  async execute(_toolCallId, args) {
    const symbol = args.symbol.toUpperCase();
    const period = args.period ?? "2y";
    const historyResult = await wrapProvider("yahoo", () => getHistory(symbol, period, "1d"));
    if (historyResult.status === "unavailable") {
      return {
        content: [
          { type: "text", text: `⚠ Backtest unavailable for ${symbol} (${historyResult.reason}).` },
        ],
        details: null,
      };
    }
    const bars = historyResult.data;

    const minBars = requiredBarsForStrategy(args.strategy);
    if (bars.length < minBars) {
      return {
        content: [
          {
            type: "text",
            text: `Insufficient data for backtesting ${symbol} (need ${minBars}+ days, got ${bars.length})`,
          },
        ],
        details: null,
      };
    }

    const costBps = args.cost_bps ?? DEFAULT_COST_BPS;
    const result = runBacktest(bars, args.strategy, { costBps });

    const outperformance = result.totalReturn - result.buyAndHoldReturn;
    const lines = [
      `**${symbol} Backtest: ${strategyLabel(args.strategy)}** (${bars[0].date} to ${bars[bars.length - 1].date}, ${bars.length} days)`,
      ``,
      `Strategy Return (net of costs): ${(result.totalReturn * 100).toFixed(2)}%`,
      `Buy & Hold Return (gross): ${(result.buyAndHoldReturn * 100).toFixed(2)}%`,
      `Outperformance: ${outperformance >= 0 ? "+" : ""}${(outperformance * 100).toFixed(2)}%`,
      ``,
      `Signal Trades: ${result.trades} | Forced Closures: ${result.forcedClosures} | Wins: ${result.wins} | Win Rate: ${(result.winRate * 100).toFixed(0)}%`,
      `Max Drawdown: ${(result.maxDrawdown * 100).toFixed(2)}%`,
      ``,
      `Execution assumptions: signals fill at the next bar's open with a flat cost of ${costBps} bps per side.`,
      ...(result.pendingSignal
        ? [
            `Note: a ${result.pendingSignal.type} signal fired on the final bar (${result.pendingSignal.date}) and is pending — it has no next open to fill at and is not counted as a signal trade.`,
          ]
        : []),
      ...(result.forcedClosures > 0
        ? [
            `Note: ${result.forcedClosures} open position${result.forcedClosures === 1 ? " was" : "s were"} liquidated at the final close for return reporting; forced closures are not counted as signal trades.`,
          ]
        : []),
      ``,
      result.totalReturn > result.buyAndHoldReturn
        ? `In this simulation the strategy outperformed buy-and-hold by ${(outperformance * 100).toFixed(2)}%.`
        : `In this simulation buy-and-hold outperformed the strategy by ${(-outperformance * 100).toFixed(2)}%.`,
      ``,
      `Limitations — this is a strategy replay, not an execution simulation:`,
      ...BACKTEST_LIMITATIONS.map((limit) => `- ${limit}`),
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
