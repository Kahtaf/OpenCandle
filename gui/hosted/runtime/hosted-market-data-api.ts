import { buildFreshnessStamp } from "../../../src/infra/freshness.js";
import { isZeroFilledQuote, searchYahooInstruments } from "../../../src/market-state/resolve.js";
import { wrapProvider } from "../../../src/providers/wrap-provider.js";
import { getQuote, getYahooCompanyOverview } from "../../../src/providers/yahoo-finance.js";
import {
  fetchHistoryWithFallback,
  HISTORY_INTERVALS,
  type HISTORY_RANGES,
} from "../../../src/tools/market/stock-history.js";
import {
  buildMarketQuoteSnapshot,
  buildMarketIndicesSnapshot,
  buildUnavailableMarketQuoteSnapshot,
  type MarketQuoteState,
} from "../../shared/market-quote-snapshot.js";

type HistoryRange = (typeof HISTORY_RANGES)[number];
type HistoryInterval = (typeof HISTORY_INTERVALS)[number];
type GuiHistoryRange = "1D" | "5D" | "1M" | "6M" | "YTD" | "1Y" | "5Y" | "MAX";

const HISTORY_RANGE_MAP: Record<
  GuiHistoryRange,
  { range: HistoryRange; interval: HistoryInterval }
> = {
  "1D": { range: "1d", interval: "5m" },
  "5D": { range: "5d", interval: "15m" },
  "1M": { range: "1mo", interval: "1h" },
  "6M": { range: "6mo", interval: "1d" },
  YTD: { range: "ytd", interval: "1d" },
  "1Y": { range: "1y", interval: "1d" },
  "5Y": { range: "5y", interval: "1wk" },
  MAX: { range: "max", interval: "1mo" },
};

const DAILY_OR_LONGER_INTERVALS = new Set<HistoryInterval>(["1d", "1wk", "1mo"]);

export async function searchHostedInstrumentCandidates(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return { query: "", candidates: [] };
  try {
    return { query: trimmed, candidates: await searchYahooInstruments(trimmed) };
  } catch (error) {
    return {
      query: trimmed,
      candidates: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getHostedInstrumentQuoteSnapshot(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return { symbol: "", status: "unavailable" as const, reason: "symbol is required" };
  return { symbol: normalized, ...(await fetchHostedQuoteSnapshot(normalized)) };
}

export async function getHostedInstrumentOverviewSnapshot(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return { symbol: "", status: "unavailable" as const, reason: "symbol is required" };
  const result = await wrapProvider("yahoo", () => getYahooCompanyOverview(normalized));
  if (result.status === "unavailable") {
    return { symbol: normalized, status: "unavailable" as const, reason: result.reason };
  }
  return { symbol: normalized, status: "ok" as const, ...result.data, stale: result.stale === true };
}

export async function getHostedInstrumentHistorySnapshot(symbol: string, rangeLabel = "1D") {
  const normalized = symbol.trim().toUpperCase();
  const resolved = HISTORY_RANGE_MAP[rangeLabel as GuiHistoryRange];
  if (!resolved) {
    return { status: "invalid_request" as const, reason: `Unknown history range: ${rangeLabel}` };
  }
  const result = await fetchHistoryWithFallback(normalized, resolved.range, resolved.interval);
  if (result.status === "unavailable") {
    return { status: "unavailable" as const, reason: result.reason };
  }
  const source = historySource(result.provider);
  if (!source) {
    return { status: "unavailable" as const, reason: "History provider attribution is unavailable" };
  }
  const daily = DAILY_OR_LONGER_INTERVALS.has(resolved.interval);
  const bars = result.data.map((bar) => {
    const time =
      Number.isFinite(bar.timestamp) && bar.timestamp > 0
        ? bar.timestamp
        : daily
          ? Date.parse(`${bar.date}T00:00:00Z`) / 1_000
          : Number.NaN;
    const prices = [bar.open, bar.high, bar.low, bar.close];
    if (
      !Number.isFinite(time) ||
      !prices.every((price) => Number.isFinite(price) && price > 0) ||
      bar.low > Math.min(bar.open, bar.close) ||
      bar.high < Math.max(bar.open, bar.close) ||
      !Number.isFinite(bar.volume) ||
      bar.volume < 0
    ) {
      return null;
    }
    return { time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume };
  });
  if (bars.length === 0 || bars.some((bar) => bar == null)) {
    return { status: "unavailable" as const, reason: "History contains no usable price bars" };
  }
  return {
    status: "ok" as const,
    symbol: normalized,
    range: rangeLabel,
    interval: resolved.interval,
    source,
    fetchedAt: result.timestamp,
    dataAsOf: result.data.at(-1)?.date,
    stale: result.stale === true,
    prevClose: daily && result.data.length >= 2 ? result.data.at(-2)?.close ?? null : null,
    bars,
  };
}

export async function buildHostedMarketIndicesSnapshot() {
  return buildMarketIndicesSnapshot({
    fetchQuote: fetchHostedQuoteSnapshot,
  });
}

export function buildHostedMarketQuoteSnapshot(state: MarketQuoteState) {
  return buildMarketQuoteSnapshot(state, {
    fetchQuote: fetchHostedQuoteSnapshot,
  });
}

export function buildHostedUnavailableMarketQuoteSnapshot(
  state: MarketQuoteState,
  reason: string,
) {
  return buildUnavailableMarketQuoteSnapshot(state, reason);
}

async function fetchHostedQuoteSnapshot(symbol: string) {
  const result = await wrapProvider("yahoo", () => getQuote(symbol));
  if (result.status === "unavailable") return { status: "unavailable" as const, reason: result.reason };
  if (
    result.stale ||
    !Number.isFinite(result.data.price) ||
    result.data.price <= 0 ||
    isZeroFilledQuote(result.data)
  ) {
    return { status: "unavailable" as const, reason: "provider returned stale or invalid market data" };
  }
  const freshness = buildFreshnessStamp({
    asOf: result.data.asOf,
    cached: result.cached,
    stale: result.stale,
    cachedAt: result.timestamp,
  });
  if (freshness.isStaleForSession) {
    return { status: "unavailable" as const, reason: "provider returned stale market data" };
  }
  return {
    status: "ok" as const,
    name: result.data.name,
    price: result.data.price,
    change: result.data.change,
    changePercent: result.data.changePercent,
    volume: result.data.volume,
    high: result.data.high,
    low: result.data.low,
    week52High: result.data.week52High,
    week52Low: result.data.week52Low,
    marketCap: result.data.marketCap,
    fetchedAt: result.timestamp,
    dataAsOf: freshness.providerDataAt,
    marketState: result.data.marketState,
    extendedPrice: result.data.extendedPrice,
    extendedChange: result.data.extendedChange,
    extendedChangePercent: result.data.extendedChangePercent,
    extendedAsOf: result.data.extendedAsOf,
    stale: false as const,
    currency: result.data.currency ?? null,
  };
}

function historySource(provider: string | undefined) {
  if (provider === "yahoo") return "Yahoo Finance" as const;
  if (provider === "alphavantage") return "Alpha Vantage" as const;
  if (provider === "lse") return "London Strategic Edge" as const;
  return null;
}
