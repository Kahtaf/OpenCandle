import type Database from "better-sqlite3";
import { buildFreshnessStamp } from "../../src/infra/freshness.js";
import { isZeroFilledQuote, searchYahooInstruments } from "../../src/market-state/resolve.js";
import { MarketStateService } from "../../src/market-state/service.js";
import { initDefaultDatabase } from "../../src/memory/sqlite.js";
import { wrapProvider } from "../../src/providers/wrap-provider.js";
import { getQuote } from "../../src/providers/yahoo-finance.js";

export interface MarketStateSnapshot {
  instruments: Array<NonNullable<ReturnType<MarketStateService["getInstrument"]>>>;
  watchlists: ReturnType<MarketStateService["listWatchlists"]>;
  portfolios: ReturnType<MarketStateService["listPortfolios"]>;
  watchlist: ReturnType<MarketStateService["listWatchlistItems"]>;
  portfolio: ReturnType<MarketStateService["listPortfolioLots"]>;
  alerts: ReturnType<MarketStateService["listAlertRules"]>;
  alertEvents: ReturnType<MarketStateService["listAlertEvents"]>;
  alertCheckRuns: ReturnType<MarketStateService["listAlertCheckRuns"]>;
  reportTemplates: ReturnType<MarketStateService["listReportTemplates"]>;
  reportRuns: ReturnType<MarketStateService["listReportRuns"]>;
  runnerLease: ReturnType<MarketStateService["getAutomationRunnerLease"]>;
  notifications: ReturnType<MarketStateService["listNotificationEvents"]>;
  notificationDeliveryAttempts: ReturnType<MarketStateService["listNotificationDeliveryAttempts"]>;
}

export interface MarketStateQuoteSnapshot {
  generatedAt: string;
  watchlistQuotes: Array<{
    itemId: number;
    instrumentId: number;
    symbol: string;
    status: "ok" | "unavailable";
    price?: number;
    changePercent?: number;
    fetchedAt?: string;
    stale?: boolean;
    reason?: string;
  }>;
  portfolioQuotes: Array<{
    lotId: number;
    portfolioId: number;
    instrumentId: number;
    symbol: string;
    status: "ok" | "unavailable";
    currentPrice?: number | null;
    changePercent?: number;
    marketValue?: number | null;
    totalCost: number;
    pnl?: number | null;
    pnlPercent?: number | null;
    allocationPercent?: number;
    currency: string;
    includedInTotals: boolean;
    fetchedAt?: string;
    stale?: boolean;
    reason?: string;
  }>;
  portfolioSummary: {
    portfolioId: number;
    baseCurrency: string;
    totalValue: number;
    totalCost: number;
    totalPnl: number;
    totalPnlPercent: number;
    excludedFromTotals: Array<{ symbol: string; currency: string; reason: string }>;
  };
  portfolioSummaries: Array<{
    portfolioId: number;
    baseCurrency: string;
    totalValue: number;
    totalCost: number;
    totalPnl: number;
    totalPnlPercent: number;
    excludedFromTotals: Array<{ symbol: string; currency: string; reason: string }>;
  }>;
}

interface SavedSymbolsMemoOptions {
  ttlMs?: number;
  now?: () => number;
}

export function createSavedSymbolsMemo(
  load: () => string[],
  options: SavedSymbolsMemoOptions = {},
): () => string[] {
  const ttlMs = options.ttlMs ?? 30_000;
  const now = options.now ?? Date.now;
  let cachedAt = 0;
  let cached: string[] | null = null;
  return () => {
    const current = now();
    if (cached && current - cachedAt < ttlMs) return cached;
    cached = load();
    cachedAt = current;
    return cached;
  };
}

export const getSavedMarketStateSymbols = createSavedSymbolsMemo(loadSavedMarketStateSymbols);

export function buildMarketStateSnapshot(db?: Database.Database): MarketStateSnapshot {
  const ownedDb = db ?? initDefaultDatabase();
  const service = new MarketStateService(ownedDb);
  try {
    const alerts = service.listAlertRules();
    const instrumentIds = [
      ...new Set(alerts.map((rule) => rule.instrumentId).filter((id) => id != null)),
    ];
    const watchlists = service.listWatchlists();
    const portfolios = service.listPortfolios();
    return {
      instruments: instrumentIds
        .map((id) => service.getInstrument(id))
        .filter((instrument) => instrument != null),
      watchlists,
      portfolios,
      watchlist: watchlists.flatMap((watchlist) => service.listWatchlistItems(watchlist.id)),
      portfolio: portfolios.flatMap((portfolio) => service.listPortfolioLots(portfolio.id)),
      alerts,
      alertEvents: service.listAlertEvents(),
      alertCheckRuns: service.listAlertCheckRuns(),
      reportTemplates: service.listReportTemplates(),
      reportRuns: service.listReportRuns(),
      runnerLease: service.getAutomationRunnerLease(),
      notifications: service.listNotificationEvents(),
      notificationDeliveryAttempts: service.listNotificationDeliveryAttempts(),
    };
  } finally {
    if (!db) ownedDb.close();
  }
}

function loadSavedMarketStateSymbols(): string[] {
  const db = initDefaultDatabase();
  const service = new MarketStateService(db);
  try {
    const symbols = [
      ...service.listWatchlists().flatMap((watchlist) =>
        service.listWatchlistItems(watchlist.id).map((item) => item.symbol),
      ),
      ...service
        .listPortfolios()
        .flatMap((portfolio) => service.listPortfolioLots(portfolio.id).map((lot) => lot.symbol)),
    ];
    return normalizeSymbols(symbols);
  } finally {
    db.close();
  }
}

function normalizeSymbols(symbols: string[]): string[] {
  const normalized: string[] = [];
  for (const symbol of symbols) {
    const next = symbol.trim().toUpperCase();
    if (!next || normalized.includes(next)) continue;
    normalized.push(next);
  }
  return normalized;
}

export async function buildMarketStateQuoteSnapshot(
  db?: Database.Database,
): Promise<MarketStateQuoteSnapshot> {
  const ownedDb = db ?? initDefaultDatabase();
  const service = new MarketStateService(ownedDb);
  try {
    const watchlist = service
      .listWatchlists()
      .flatMap((watchlist) => service.listWatchlistItems(watchlist.id));
    const portfolios = service.listPortfolios();
    const portfolioLots = portfolios.flatMap((portfolio) => service.listPortfolioLots(portfolio.id));
    const symbols = [
      ...new Set([
        ...watchlist.map((item) => item.symbol),
        ...portfolioLots.map((lot) => lot.symbol),
      ]),
    ];
    const quoteMap = new Map<string, Awaited<ReturnType<typeof fetchQuoteSnapshot>>>();
    for (const symbol of symbols) {
      quoteMap.set(symbol, await fetchQuoteSnapshot(symbol));
    }

    const generatedAt = new Date().toISOString();
    const watchlistQuotes = watchlist.map((item) => {
      const quote = quoteMap.get(item.symbol);
      if (quote == null || quote.status === "unavailable") {
        return {
          itemId: item.id,
          instrumentId: item.instrumentId,
          symbol: item.symbol,
          status: "unavailable" as const,
          reason: quote?.reason ?? "quote unavailable",
        };
      }
      return {
        itemId: item.id,
        instrumentId: item.instrumentId,
        symbol: item.symbol,
        status: "ok" as const,
        price: quote.price,
        changePercent: quote.changePercent,
        fetchedAt: quote.fetchedAt,
        stale: quote.stale,
      };
    });

    const portfolioResults = portfolios.map((portfolio) =>
      buildPortfolioQuoteResult({
        portfolio,
        lots: portfolioLots.filter((lot) => lot.portfolioId === portfolio.id),
        quoteMap,
      }),
    );
    const defaultPortfolio = portfolios.find((portfolio) => portfolio.isDefault) ?? portfolios[0];
    const defaultResult =
      portfolioResults.find((result) => result.summary.portfolioId === defaultPortfolio.id) ??
      portfolioResults[0];
    return {
      generatedAt,
      watchlistQuotes,
      portfolioQuotes: portfolioResults.flatMap((result) => result.quotes),
      portfolioSummary: defaultResult.summary,
      portfolioSummaries: portfolioResults.map((result) => result.summary),
    };
  } finally {
    if (!db) ownedDb.close();
  }
}

function buildPortfolioQuoteResult({
  portfolio,
  lots,
  quoteMap,
}: {
  portfolio: ReturnType<MarketStateService["listPortfolios"]>[number];
  lots: ReturnType<MarketStateService["listPortfolioLots"]>;
  quoteMap: Map<string, Awaited<ReturnType<typeof fetchQuoteSnapshot>>>;
}): {
  quotes: MarketStateQuoteSnapshot["portfolioQuotes"];
  summary: MarketStateQuoteSnapshot["portfolioSummary"];
} {
  const baseCurrency = portfolio.baseCurrency ?? "USD";
  const portfolioQuotes = lots.map((lot) => {
    const quote = quoteMap.get(lot.symbol);
    const lotCurrency = lot.currency || baseCurrency;
    const quoteCurrency = lot.instrumentCurrency || lotCurrency;
    const includedInTotals = lotCurrency === baseCurrency && quoteCurrency === baseCurrency;
    const totalCost = lot.avgCost * lot.quantity;
    if (quote == null || quote.status === "unavailable") {
      return {
        lotId: lot.id,
        portfolioId: lot.portfolioId,
        instrumentId: lot.instrumentId,
        symbol: lot.symbol,
        status: "unavailable" as const,
        totalCost,
        currency: lotCurrency,
        includedInTotals: false,
        reason: quote?.reason ?? "quote unavailable",
      };
    }
    const resolvedQuoteCurrency = quote.currency ?? quoteCurrency;
    if (resolvedQuoteCurrency !== lotCurrency) {
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
        currency: lotCurrency,
        includedInTotals: false,
        reason: `No FX conversion from ${resolvedQuoteCurrency} to ${lotCurrency}`,
        fetchedAt: quote.fetchedAt,
        stale: quote.stale,
      };
    }
    const marketValue = quote.price * lot.quantity;
    return {
      lotId: lot.id,
      portfolioId: lot.portfolioId,
      instrumentId: lot.instrumentId,
      symbol: lot.symbol,
      status: "ok" as const,
      currentPrice: quote.price,
      changePercent: quote.changePercent,
      marketValue,
      totalCost,
      pnl: marketValue - totalCost,
      pnlPercent: totalCost > 0 ? ((marketValue - totalCost) / totalCost) * 100 : 0,
      currency: lotCurrency,
      includedInTotals,
      fetchedAt: quote.fetchedAt,
      stale: quote.stale,
      reason: includedInTotals
        ? undefined
        : `No FX conversion from ${lotCurrency === baseCurrency ? quoteCurrency : lotCurrency} to ${baseCurrency}`,
    };
  });
  const included = portfolioQuotes.filter(
    (quote) => quote.status === "ok" && quote.includedInTotals,
  );
  const totalValue = included.reduce((sum, quote) => sum + (quote.marketValue ?? 0), 0);
  const totalCost = included.reduce((sum, quote) => sum + quote.totalCost, 0);
  const quotes = portfolioQuotes.map((quote) => {
    if (quote.status !== "ok" || !quote.includedInTotals || totalValue <= 0) return quote;
    return {
      ...quote,
      allocationPercent: ((quote.marketValue ?? 0) / totalValue) * 100,
    };
  });
  const excludedFromTotals = quotes
    .filter((quote) => quote.status !== "ok" || !quote.includedInTotals)
    .map((quote) => ({
      symbol: quote.symbol,
      currency: quote.currency,
      reason: quote.reason ?? "quote unavailable",
    }));
  return {
    quotes,
    summary: {
      portfolioId: portfolio.id,
      baseCurrency,
      totalValue,
      totalCost,
      totalPnl: totalValue - totalCost,
      totalPnlPercent: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
      excludedFromTotals,
    },
  };
}

export async function searchInstrumentCandidates(query: string): Promise<{
  query: string;
  candidates: Awaited<ReturnType<typeof searchYahooInstruments>>;
  error?: string;
}> {
  const trimmed = query.trim();
  if (!trimmed) return { query: "", candidates: [] };
  try {
    return {
      query: trimmed,
      candidates: await searchYahooInstruments(trimmed),
    };
  } catch (err) {
    return {
      query: trimmed,
      candidates: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getInstrumentQuoteSnapshot(symbol: string): Promise<
  | {
      symbol: string;
      status: "ok";
      price: number;
      changePercent: number;
      fetchedAt: string;
      stale: boolean;
      currency: string | null;
    }
  | { symbol: string; status: "unavailable"; reason: string }
> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) return { symbol: "", status: "unavailable", reason: "symbol is required" };
  const quote = await fetchQuoteSnapshot(normalized);
  return quote.status === "ok" ? { symbol: normalized, ...quote } : { symbol: normalized, ...quote };
}

async function fetchQuoteSnapshot(symbol: string): Promise<
  | {
      status: "ok";
      price: number;
      changePercent: number;
      fetchedAt: string;
      stale: boolean;
      currency: string | null;
    }
  | { status: "unavailable"; reason: string }
> {
  const result = await wrapProvider("yahoo", () => getQuote(symbol));
  if (result.status === "unavailable") return { status: "unavailable", reason: result.reason };
  if (result.stale) return { status: "unavailable", reason: "provider returned stale market data" };
  if (isZeroFilledQuote(result.data)) {
    return { status: "unavailable", reason: "Yahoo returned no valid market data." };
  }
  const freshness = buildFreshnessStamp({
    asOf: result.data.asOf,
    cached: result.cached,
    stale: result.stale,
    cachedAt: result.timestamp,
  });
  if (freshness.isStaleForSession) {
    return { status: "unavailable", reason: "provider returned stale market data" };
  }
  return {
    status: "ok",
    price: result.data.price,
    changePercent: result.data.changePercent,
    fetchedAt: freshness.providerDataAt ?? result.timestamp,
    stale: Boolean(result.stale),
    currency: result.data.currency ?? null,
  };
}
