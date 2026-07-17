import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { getConfig } from "../../config.js";
import { buildFreshnessStamp, type FreshnessStamp, formatAsOfLine } from "../../infra/freshness.js";
import { isOverSoftThreshold } from "../../infra/lse-byte-budget.js";
import { getDailyHistory } from "../../providers/alpha-vantage.js";
import { getLseCandles, type LseTimeframe, toLseTimeframe } from "../../providers/lse.js";
import { ProviderCredentialError } from "../../providers/provider-credential-error.js";
import { withFallback } from "../../providers/with-fallback.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { getHistory } from "../../providers/yahoo-finance.js";
import type { ProviderResult } from "../../runtime/evidence.js";
import type { OHLCV } from "../../types/market.js";

const DAILY_INTERVALS = new Set(["1d", "1wk", "1mo"]);
export const HISTORY_RANGES = [
  "1d",
  "5d",
  "1mo",
  "3mo",
  "6mo",
  "ytd",
  "1y",
  "2y",
  "5y",
  "10y",
  "max",
] as const;
export const HISTORY_INTERVALS = ["1m", "5m", "15m", "1h", "1d", "1wk", "1mo"] as const;

function lseFallbackEligible(interval: (typeof HISTORY_INTERVALS)[number]): boolean {
  return (
    toLseTimeframe(interval) !== undefined && !!getConfig().lseApiKey && !isOverSoftThreshold()
  );
}

export function hasIntradayHistoryFallback(interval: (typeof HISTORY_INTERVALS)[number]): boolean {
  return !DAILY_INTERVALS.has(interval) && lseFallbackEligible(interval);
}

export async function fetchHistoryWithFallback(
  symbol: string,
  range: (typeof HISTORY_RANGES)[number],
  interval: (typeof HISTORY_INTERVALS)[number],
): Promise<ProviderResult<OHLCV[]>> {
  const apiKey = getConfig().alphaVantageApiKey;
  const lseTimeframe = toLseTimeframe(interval);
  const lseEligible = lseTimeframe !== undefined && lseFallbackEligible(interval);
  const getLseHistory = async (timeframe: LseTimeframe): Promise<OHLCV[]> => {
    let rows: Awaited<ReturnType<typeof getLseCandles>>;
    try {
      const start = historyRangeToStart(range);
      rows = await getLseCandles(symbol, timeframe, {
        ...(start === undefined ? {} : { start }),
        order: "asc",
      });
    } catch (error) {
      if (error instanceof ProviderCredentialError && error.provider === "lse") {
        throw new Error(`LSE credential ${error.reason}`);
      }
      throw error;
    }
    return rows.map((row) => {
      // Verified UTC from a live 2026-07-14 1h capture: naive 08:00–23:00 bars
      // match the 04:00–19:00 ET extended session. Treat naive values as UTC.
      const utcTimestamp = /(?:Z|[+-]\d{2}:\d{2})$/i.test(row.ts) ? row.ts : `${row.ts}Z`;
      const timestamp = Date.parse(utcTimestamp) / 1_000;
      return {
        date: row.ts.slice(0, 10),
        ...(Number.isFinite(timestamp) ? { timestamp } : {}),
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      };
    });
  };

  if (DAILY_INTERVALS.has(interval)) {
    const yahooEntry = {
      provider: "yahoo",
      fn: () => getHistory(symbol, range, interval),
    };
    const entries = [yahooEntry];
    if (apiKey) {
      entries.push({
        provider: "alphavantage",
        fn: () => getDailyHistory(symbol, apiKey, range),
      });
    }
    if (lseEligible && lseTimeframe !== undefined) {
      entries.push({ provider: "lse", fn: () => getLseHistory(lseTimeframe) });
    }
    return entries.length === 1
      ? wrapProvider(yahooEntry.provider, yahooEntry.fn)
      : withFallback(entries);
  }

  if (lseEligible && lseTimeframe !== undefined) {
    return withFallback([
      { provider: "yahoo", fn: () => getHistory(symbol, range, interval) },
      { provider: "lse", fn: () => getLseHistory(lseTimeframe) },
    ]);
  }

  return wrapProvider("yahoo", () => getHistory(symbol, range, interval));
}

type HistoryRange = (typeof HISTORY_RANGES)[number];

export function historyRangeToStart(range: HistoryRange, now = new Date()): string | undefined {
  if (range === "max") return undefined;

  const start = new Date(now);
  switch (range) {
    case "1d":
      start.setUTCDate(start.getUTCDate() - 1);
      break;
    case "5d":
      start.setUTCDate(start.getUTCDate() - 5);
      break;
    case "1mo":
      start.setUTCMonth(start.getUTCMonth() - 1);
      break;
    case "3mo":
      start.setUTCMonth(start.getUTCMonth() - 3);
      break;
    case "6mo":
      start.setUTCMonth(start.getUTCMonth() - 6);
      break;
    case "ytd":
      return `${start.getUTCFullYear()}-01-01`;
    case "1y":
      start.setUTCFullYear(start.getUTCFullYear() - 1);
      break;
    case "2y":
      start.setUTCFullYear(start.getUTCFullYear() - 2);
      break;
    case "5y":
      start.setUTCFullYear(start.getUTCFullYear() - 5);
      break;
    case "10y":
      start.setUTCFullYear(start.getUTCFullYear() - 10);
      break;
  }
  return start.toISOString().slice(0, 10);
}

const params = Type.Object({
  symbol: Type.String({ description: "Stock ticker symbol (e.g. AAPL, MSFT)" }),
  range: Type.Optional(
    Type.Union(
      HISTORY_RANGES.map((range) => Type.Literal(range)),
      {
        description: "Time range: 1d, 5d, 1mo, 3mo, 6mo, ytd, 1y, 2y, 5y, 10y, max. Default: 6mo",
      },
    ),
  ),
  interval: Type.Optional(
    Type.Union(
      HISTORY_INTERVALS.map((interval) => Type.Literal(interval)),
      {
        description: "Data interval: 1m, 5m, 15m, 1h, 1d, 1wk, 1mo. Default: 1d",
      },
    ),
  ),
});

export interface StaleStockHistoryDetails {
  bars: OHLCV[];
  provider?: string;
  providerTimestamp: string;
  stale: true;
  freshness: FreshnessStamp;
}

export const stockHistoryTool: AgentTool<typeof params, OHLCV[] | StaleStockHistoryDetails> = {
  name: "get_stock_history",
  label: "Stock History",
  description: "Get historical OHLCV (open, high, low, close, volume) data for a stock",
  parameters: params,
  async execute(_toolCallId, args) {
    const symbol = args.symbol.toUpperCase();
    const range = args.range ?? "6mo";
    const interval = args.interval ?? "1d";
    const result = await fetchHistoryWithFallback(symbol, range, interval);

    if (result.status === "unavailable") {
      const intradayNote =
        !DAILY_INTERVALS.has(interval) && !hasIntradayHistoryFallback(interval)
          ? ` No alternate source for ${interval} data.`
          : "";
      return {
        content: [
          {
            type: "text",
            text: `⚠ Stock history unavailable for ${symbol} (${result.reason}).${intradayNote}`,
          },
        ],
        details: [],
      };
    }
    const bars = result.data;
    const freshness = buildFreshnessStamp({
      asOf: bars.at(-1)?.timestamp ?? bars.at(-1)?.date,
      stale: result.stale,
      cached: result.cached,
      cachedAt: result.stale ? result.timestamp : undefined,
    });

    const summary = [
      `${symbol} — ${bars.length} bars (${range}, ${interval})`,
      `Period: ${bars[0]?.date} to ${bars[bars.length - 1]?.date}`,
      ...(result.stale ? [`Data status: Stale cache. ${formatAsOfLine(freshness)}`] : []),
    ];

    // Include last 10 bars as sample
    const recent = bars.slice(-10);
    const table = recent
      .map(
        (b) =>
          `${b.date} | O:${b.open.toFixed(2)} H:${b.high.toFixed(2)} L:${b.low.toFixed(2)} C:${b.close.toFixed(2)} V:${b.volume.toLocaleString()}`,
      )
      .join("\n");

    const text = [...summary, "", "Recent bars:", table].join("\n");
    return {
      content: [{ type: "text", text }],
      details: result.stale
        ? {
            bars,
            provider: result.provider,
            providerTimestamp: result.timestamp,
            stale: true,
            freshness,
          }
        : bars,
    };
  },
};
