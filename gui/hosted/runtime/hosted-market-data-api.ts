import { buildFreshnessStamp } from "../../../src/infra/freshness.js";
import { isZeroFilledQuote, searchYahooInstruments } from "../../../src/market-state/resolve.js";
import { wrapProvider } from "../../../src/providers/wrap-provider.js";
import {
  getHistory,
  getQuote,
  getYahooCompanyOverview,
} from "../../../src/providers/yahoo-finance.js";
import {
  fetchHistoryWithFallback,
  HISTORY_INTERVALS,
  type HISTORY_RANGES,
} from "../../../src/tools/market/stock-history.js";

type HistoryRange = (typeof HISTORY_RANGES)[number];
type HistoryInterval = (typeof HISTORY_INTERVALS)[number];
type GuiHistoryRange = "1D" | "5D" | "1M" | "6M" | "YTD" | "1Y" | "5Y" | "MAX";

const DEFAULT_HISTORY_RANGE_MAP: Record<
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

const MARKET_INDEX_SYMBOLS = ["^GSPC", "^IXIC", "^DJI", "BTC-USD"] as const;

type HostedMarketState = {
  watchlists?: Array<{ id: number; isDefault?: boolean; name?: string }>;
  portfolios?: Array<{
    id: number;
    isDefault?: boolean;
    name?: string;
    baseCurrency?: string | null;
  }>;
  watchlist?: Array<{ id: number; instrumentId: number; symbol: string }>;
  portfolio?: Array<{
    id: number;
    portfolioId: number;
    instrumentId: number;
    symbol: string;
    quantity: number;
    avgCost: number;
    currency: string;
    instrumentCurrency?: string | null;
  }>;
};

type HostedQuote = Awaited<ReturnType<typeof fetchHostedQuoteSnapshot>>;
type HostedSparkline = Awaited<ReturnType<typeof fetchHostedSparklineSnapshot>>;

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
  const quote = await fetchHostedQuoteSnapshot(normalized);
  return quote.status === "ok" ? { symbol: normalized, ...quote } : { symbol: normalized, ...quote };
}

export async function getHostedInstrumentOverviewSnapshot(symbol: string) {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return { symbol: "", status: "unavailable" as const, reason: "symbol is required" };
  const result = await wrapProvider("yahoo", () => getYahooCompanyOverview(normalized));
  if (result.status === "unavailable") {
    return { symbol: normalized, status: "unavailable" as const, reason: result.reason };
  }
  return {
    symbol: normalized,
    status: "ok" as const,
    ...result.data,
    stale: result.stale === true,
  };
}

export async function getHostedInstrumentHistorySnapshot(
  symbol: string,
  rangeLabel = "1D",
) {
  const normalized = symbol.trim().toUpperCase();
  const resolved = DEFAULT_HISTORY_RANGE_MAP[rangeLabel as GuiHistoryRange];
  if (!resolved) {
    return { status: "invalid_request" as const, reason: `Unknown history range: ${rangeLabel}` };
  }
  const result = await fetchHistoryWithFallback(normalized, resolved.range, resolved.interval);
  if (result.status === "unavailable") {
    return { status: "unavailable" as const, reason: result.reason };
  }
  const source =
    result.provider === "yahoo"
      ? "Yahoo Finance"
      : result.provider === "alphavantage"
        ? "Alpha Vantage"
        : result.provider === "lse"
          ? "London Strategic Edge"
          : undefined;
  if (!source) {
    return { status: "unavailable" as const, reason: "History provider attribution is unavailable" };
  }
  const bars = result.data.flatMap((bar) => {
    const time = Number.isFinite(bar.timestamp)
      ? bar.timestamp
      : Date.parse(`${bar.date}T00:00:00Z`) / 1_000;
    if (!Number.isFinite(time)) return [];
    return [{ time, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume }];
  });
  return {
    status: "ok" as const,
    symbol: normalized,
    range: rangeLabel,
    interval: resolved.interval,
    source,
    fetchedAt: result.timestamp,
    dataAsOf: result.data.at(-1)?.date,
    stale: result.stale === true,
    prevClose: resolved.interval === "1d" && result.data.length >= 2
      ? result.data.at(-2)?.close ?? null
      : null,
    bars,
  };
}

export async function buildHostedMarketIndicesSnapshot() {
  const indices = [];
  for (const symbol of MARKET_INDEX_SYMBOLS) {
    const quote = await fetchHostedQuoteSnapshot(symbol);
    if (quote.status === "unavailable") {
      indices.push({ symbol, status: "unavailable" as const, reason: quote.reason });
      continue;
    }
    indices.push({
      symbol,
      name: quote.name,
      status: "ok" as const,
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      currency: quote.currency,
      marketState: quote.marketState,
      dataAsOf: quote.dataAsOf,
      stale: quote.stale,
      sparkline: await fetchHostedSparklineSnapshot(symbol),
    });
  }
  return { generatedAt: new Date().toISOString(), indices };
}

export async function buildHostedMarketQuoteSnapshot(state: HostedMarketState) {
  const watchlist = state.watchlist ?? [];
  const portfolios = state.portfolios ?? [];
  const lots = state.portfolio ?? [];
  const symbols = [...new Set([...watchlist.map((item) => item.symbol), ...lots.map((lot) => lot.symbol)])];
  const quoteMap = new Map<string, HostedQuote>();
  const sparklineMap = new Map<string, HostedSparkline>();
  for (const symbol of symbols) {
    const quote = await fetchHostedQuoteSnapshot(symbol);
    quoteMap.set(symbol, quote);
    sparklineMap.set(
      symbol,
      quote.status === "ok"
        ? await fetchHostedSparklineSnapshot(symbol)
        : unavailableSparkline(quote.reason),
    );
  }

  const watchlistQuotes = watchlist.map((item) => {
    const quote = quoteMap.get(item.symbol);
    const sparkline = sparklineMap.get(item.symbol) ?? unavailableSparkline("History unavailable");
    if (!quote || quote.status === "unavailable") {
      return {
        itemId: item.id,
        instrumentId: item.instrumentId,
        symbol: item.symbol,
        status: "unavailable" as const,
        reason: quote?.reason ?? "quote unavailable",
        sparkline,
      };
    }
    return {
      itemId: item.id,
      instrumentId: item.instrumentId,
      symbol: item.symbol,
      status: "ok" as const,
      ...quote,
      sparkline,
    };
  });

  const portfolioResults = portfolios.map((portfolio) => {
    const baseCurrency = portfolio.baseCurrency ?? "USD";
    const portfolioLots = lots.filter((lot) => lot.portfolioId === portfolio.id);
    const quotes = portfolioLots.map((lot) => {
      const quote = quoteMap.get(lot.symbol);
      const totalCost = lot.avgCost * lot.quantity;
      const sparkline = sparklineMap.get(lot.symbol) ?? unavailableSparkline("History unavailable");
      if (!quote || quote.status === "unavailable") {
        return {
          lotId: lot.id,
          portfolioId: lot.portfolioId,
          instrumentId: lot.instrumentId,
          symbol: lot.symbol,
          status: "unavailable" as const,
          totalCost,
          currency: lot.currency,
          includedInTotals: false,
          reason: quote?.reason ?? "quote unavailable",
          sparkline,
        };
      }
      const quoteCurrency = quote.currency ?? lot.instrumentCurrency;
      if (!quoteCurrency) {
        return {
          lotId: lot.id,
          portfolioId: lot.portfolioId,
          instrumentId: lot.instrumentId,
          symbol: lot.symbol,
          status: "unavailable" as const,
          currentPrice: null,
          marketValue: null,
          totalCost,
          pnl: null,
          pnlPercent: null,
          currency: lot.currency,
          includedInTotals: false,
          reason: "Quote currency unavailable",
          fetchedAt: quote.fetchedAt,
          dataAsOf: quote.dataAsOf,
          marketState: quote.marketState,
          extendedPrice: quote.extendedPrice,
          extendedChange: quote.extendedChange,
          extendedChangePercent: quote.extendedChangePercent,
          extendedAsOf: quote.extendedAsOf,
          stale: quote.stale,
          sparkline,
        };
      }
      if (quoteCurrency !== lot.currency) {
        return {
          lotId: lot.id,
          portfolioId: lot.portfolioId,
          instrumentId: lot.instrumentId,
          symbol: lot.symbol,
          status: "unavailable" as const,
          currentPrice: null,
          marketValue: null,
          totalCost,
          pnl: null,
          pnlPercent: null,
          currency: lot.currency,
          includedInTotals: false,
          reason: `No FX conversion from ${quoteCurrency} to ${lot.currency}`,
          fetchedAt: quote.fetchedAt,
          dataAsOf: quote.dataAsOf,
          marketState: quote.marketState,
          extendedPrice: quote.extendedPrice,
          extendedChange: quote.extendedChange,
          extendedChangePercent: quote.extendedChangePercent,
          extendedAsOf: quote.extendedAsOf,
          stale: quote.stale,
          sparkline,
        };
      }
      const includedInTotals = quoteCurrency === lot.currency && lot.currency === baseCurrency;
      const marketValue = quote.price * lot.quantity;
      return {
        lotId: lot.id,
        portfolioId: lot.portfolioId,
        instrumentId: lot.instrumentId,
        symbol: lot.symbol,
        name: quote.name,
        status: "ok" as const,
        currentPrice: quote.price,
        changePercent: quote.changePercent,
        marketValue,
        totalCost,
        pnl: marketValue - totalCost,
        pnlPercent: totalCost > 0 ? ((marketValue - totalCost) / totalCost) * 100 : 0,
        currency: lot.currency,
        includedInTotals,
        fetchedAt: quote.fetchedAt,
        dataAsOf: quote.dataAsOf,
        marketState: quote.marketState,
        extendedPrice: quote.extendedPrice,
        extendedChange: quote.extendedChange,
        extendedChangePercent: quote.extendedChangePercent,
        extendedAsOf: quote.extendedAsOf,
        stale: quote.stale,
        sparkline,
        reason: includedInTotals ? undefined : `No FX conversion from ${quoteCurrency} to ${baseCurrency}`,
      };
    });
    const included = quotes.filter((quote) => quote.status === "ok" && quote.includedInTotals);
    const totalValue = included.reduce((sum, quote) => sum + (quote.marketValue ?? 0), 0);
    const totalCost = included.reduce((sum, quote) => sum + quote.totalCost, 0);
    const knownBaseCurrencyCost = quotes
      .filter((quote) => quote.currency === baseCurrency)
      .reduce((sum, quote) => sum + quote.totalCost, 0);
    const summaryStatus =
      portfolioLots.length === 0
        ? ("empty" as const)
        : included.length === 0
          ? ("unavailable" as const)
          : ("ok" as const);
    const allocatedQuotes = quotes.map((quote) =>
      quote.status === "ok" && quote.includedInTotals && totalValue > 0
        ? { ...quote, allocationPercent: ((quote.marketValue ?? 0) / totalValue) * 100 }
        : quote,
    );
    return {
      quotes: allocatedQuotes,
      summary: {
        portfolioId: portfolio.id,
        baseCurrency,
        status: summaryStatus,
        totalValue: summaryStatus === "unavailable" ? null : totalValue,
        totalCost: summaryStatus === "unavailable" ? knownBaseCurrencyCost : totalCost,
        totalPnl: summaryStatus === "unavailable" ? null : totalValue - totalCost,
        totalPnlPercent:
          summaryStatus === "unavailable"
            ? null
            : totalCost > 0
              ? ((totalValue - totalCost) / totalCost) * 100
              : 0,
        excludedFromTotals: allocatedQuotes
          .filter((quote) => quote.status !== "ok" || !quote.includedInTotals)
          .map((quote) => ({
            symbol: quote.symbol,
            currency: quote.currency,
            reason: quote.reason ?? "quote unavailable",
          })),
      },
    };
  });

  const defaultPortfolio = portfolios.find((portfolio) => portfolio.isDefault) ?? portfolios[0];
  const defaultResult = portfolioResults.find(
    (result) => result.summary.portfolioId === defaultPortfolio?.id,
  ) ?? portfolioResults[0];
  const emptySummary = {
    portfolioId: defaultPortfolio?.id ?? 0,
    baseCurrency: defaultPortfolio?.baseCurrency ?? "USD",
    status: "empty" as const,
    totalValue: 0,
    totalCost: 0,
    totalPnl: 0,
    totalPnlPercent: 0,
    excludedFromTotals: [],
  };
  return {
    generatedAt: new Date().toISOString(),
    watchlistQuotes,
    portfolioQuotes: portfolioResults.flatMap((result) => result.quotes),
    portfolioSummary: defaultResult?.summary ?? emptySummary,
    portfolioSummaries: portfolioResults.map((result) => result.summary),
  };
}

export function buildHostedUnavailableMarketQuoteSnapshot(
  state: HostedMarketState,
  reason: string,
) {
  const watchlistQuotes = (state.watchlist ?? []).map((item) => ({
    itemId: item.id,
    instrumentId: item.instrumentId,
    symbol: item.symbol,
    status: "unavailable" as const,
    reason,
    sparkline: unavailableSparkline(reason),
  }));
  const portfolios = state.portfolios ?? [];
  const portfolioResults = portfolios.map((portfolio) => {
    const quotes = (state.portfolio ?? [])
      .filter((lot) => lot.portfolioId === portfolio.id)
      .map((lot) => ({
        lotId: lot.id,
        portfolioId: lot.portfolioId,
        instrumentId: lot.instrumentId,
        symbol: lot.symbol,
        status: "unavailable" as const,
        totalCost: lot.avgCost * lot.quantity,
        currency: lot.currency,
        includedInTotals: false,
        reason,
        sparkline: unavailableSparkline(reason),
      }));
    return {
      quotes,
      summary: {
        portfolioId: portfolio.id,
        baseCurrency: portfolio.baseCurrency ?? "USD",
        status: quotes.length > 0 ? ("unavailable" as const) : ("empty" as const),
        totalValue: quotes.length > 0 ? null : 0,
        totalCost:
          quotes.length > 0
            ? quotes
                .filter((quote) => quote.currency === (portfolio.baseCurrency ?? "USD"))
                .reduce((sum, quote) => sum + quote.totalCost, 0)
            : 0,
        totalPnl: quotes.length > 0 ? null : 0,
        totalPnlPercent: quotes.length > 0 ? null : 0,
        excludedFromTotals: quotes.map((quote) => ({
          symbol: quote.symbol,
          currency: quote.currency,
          reason,
        })),
      },
    };
  });
  const defaultPortfolio = portfolios.find((portfolio) => portfolio.isDefault) ?? portfolios[0];
  const defaultResult = portfolioResults.find(
    (result) => result.summary.portfolioId === defaultPortfolio?.id,
  ) ?? portfolioResults[0];
  const emptySummary = {
    portfolioId: defaultPortfolio?.id ?? 0,
    baseCurrency: defaultPortfolio?.baseCurrency ?? "USD",
    status: "empty" as const,
    totalValue: 0,
    totalCost: 0,
    totalPnl: 0,
    totalPnlPercent: 0,
    excludedFromTotals: [],
  };
  return {
    generatedAt: new Date().toISOString(),
    watchlistQuotes,
    portfolioQuotes: portfolioResults.flatMap((result) => result.quotes),
    portfolioSummary: defaultResult?.summary ?? emptySummary,
    portfolioSummaries: portfolioResults.map((result) => result.summary),
  };
}

async function fetchHostedQuoteSnapshot(symbol: string) {
  const result = await wrapProvider("yahoo", () => getQuote(symbol));
  if (result.status === "unavailable") return { status: "unavailable" as const, reason: result.reason };
  if (result.stale || isZeroFilledQuote(result.data)) {
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
    dayHigh: result.data.high,
    dayLow: result.data.low,
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
    stale: false,
    currency: result.data.currency ?? null,
  };
}

async function fetchHostedSparklineSnapshot(symbol: string) {
  const result = await wrapProvider("yahoo", () => getHistory(symbol, "1d", "5m"));
  if (result.status === "unavailable") return unavailableSparkline(result.reason);
  const bars = result.data.filter((bar) => Number.isFinite(bar.close));
  if (result.stale || bars.length < 2) {
    return unavailableSparkline(result.stale ? "Historical data is stale" : "Not enough intraday history", bars.at(-1)?.date, result.stale === true);
  }
  return {
    status: "ok" as const,
    source: "Yahoo Finance" as const,
    points: bars.map((bar) => bar.close),
    fetchedAt: result.timestamp,
    dataAsOf: bars.at(-1)?.date,
    stale: false as const,
  };
}

function unavailableSparkline(reason: string, dataAsOf?: string, stale?: boolean) {
  return {
    status: "unavailable" as const,
    source: "Yahoo Finance" as const,
    reason,
    dataAsOf,
    stale,
  };
}
