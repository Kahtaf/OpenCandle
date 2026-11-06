import { securityFromSnapshot } from "../../src/portfolio/acquisition.js";
import type { FxResult } from "../../src/portfolio/fx.js";
import { valuePortfolio } from "../../src/portfolio/valuation.js";
import { createFxResolver } from "../../src/providers/yahoo-fx.js";
import {
  buildPortfolioView,
  presentPortfolioValuation,
} from "../../src/tools/portfolio/portfolio-view.js";
export type MarketQuoteResult =
  | {
      status: "ok";
      name?: string;
      rawCurrency?: string;
      price: number;
      change: number;
      changePercent: number;
      volume: number;
      high: number;
      low: number;
      week52High: number;
      week52Low: number;
      marketCap: number;
      fetchedAt: string;
      dataAsOf?: string;
      marketState?: "PRE" | "REGULAR" | "POST" | "CLOSED";
      extendedPrice?: number;
      extendedChange?: number;
      extendedChangePercent?: number;
      extendedAsOf?: string;
      stale: boolean;
      currency: string | null;
    }
  | { status: "unavailable"; reason: string; dataAsOf?: string; fetchedAt?: string };

export interface MarketQuoteState {
  watchlists?: Array<{ id: number; isDefault?: boolean; name?: string }>;
  portfolios?: Array<{
    id: number;
    isDefault?: boolean;
    name?: string;
    baseCurrency?: string | null;
  }>;
  watchlist?: Array<{ id: number; instrumentId: number; symbol: string; assetType: string }>;
  portfolio?: Array<{
    id: number;
    portfolioId: number;
    instrumentId: number;
    symbol: string;
    assetType: string;
    quantity: number;
    avgCost: number;
    currency: string;
    instrumentCurrency?: string | null;
  }>;
}

export interface MarketQuoteSnapshotDependencies {
  fetchQuote(symbol: string): Promise<MarketQuoteResult>;
  now?: () => Date;
  resolveFx?: (source: string, target: string) => Promise<FxResult> | FxResult;
}

export const MARKET_INDEX_SYMBOLS = ["^GSPC", "^NDX", "^DJI", "BTC-USD"] as const;

const MARKET_INDEX_ASSET_TYPES = {
  "^GSPC": "index",
  "^NDX": "index",
  "^DJI": "index",
  "BTC-USD": "crypto",
} as const;

export async function buildMarketIndicesSnapshot(
  dependencies: Pick<MarketQuoteSnapshotDependencies, "fetchQuote">,
) {
  const indices = [];
  for (const symbol of MARKET_INDEX_SYMBOLS) {
    const quote = await dependencies.fetchQuote(symbol);
    const assetType = MARKET_INDEX_ASSET_TYPES[symbol];
    if (quote.status === "unavailable") {
      indices.push({ symbol, assetType, status: "unavailable" as const, reason: quote.reason });
      continue;
    }
    indices.push({
      symbol,
      assetType,
      name: quote.name,
      status: "ok" as const,
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      currency: quote.currency,
      marketState: quote.marketState,
      dataAsOf: quote.dataAsOf,
      stale: quote.stale,
    });
  }
  return { generatedAt: new Date().toISOString(), indices };
}

export type MarketIndicesSnapshot = Awaited<ReturnType<typeof buildMarketIndicesSnapshot>>;

export async function buildMarketQuoteSnapshot(
  state: MarketQuoteState,
  dependencies: MarketQuoteSnapshotDependencies,
) {
  const watchlist = state.watchlist ?? [];
  const portfolios = state.portfolios ?? [];
  const lots = state.portfolio ?? [];
  const symbols = [
    ...new Set([...watchlist.map((item) => item.symbol), ...lots.map((lot) => lot.symbol)]),
  ];
  const quoteMap = new Map<string, MarketQuoteResult>();
  for (const symbol of symbols) {
    const quote = await dependencies.fetchQuote(symbol);
    quoteMap.set(symbol, quote);
  }

  const watchlistQuotes = watchlist.map((item) => {
    const quote = quoteMap.get(item.symbol);
    if (!quote || quote.status === "unavailable") {
      return {
        itemId: item.id,
        instrumentId: item.instrumentId,
        symbol: item.symbol,
        assetType: item.assetType,
        status: "unavailable" as const,
        reason: quote?.reason ?? "quote unavailable",
      };
    }
    return {
      itemId: item.id,
      instrumentId: item.instrumentId,
      symbol: item.symbol,
      assetType: item.assetType,
      name: quote.name,
      status: "ok" as const,
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      volume: quote.volume,
      dayHigh: quote.high,
      dayLow: quote.low,
      week52High: quote.week52High,
      week52Low: quote.week52Low,
      currency: quote.currency,
      fetchedAt: quote.fetchedAt,
      dataAsOf: quote.dataAsOf,
      marketState: quote.marketState,
      extendedPrice: quote.extendedPrice,
      extendedChange: quote.extendedChange,
      extendedChangePercent: quote.extendedChangePercent,
      extendedAsOf: quote.extendedAsOf,
      stale: quote.stale,
    };
  });

  const now = (dependencies.now ?? (() => new Date()))().getTime();
  const resolveFx = dependencies.resolveFx ?? createFxResolver(now);
  const portfolioResults = await Promise.all(
    portfolios.map(async (portfolio) => {
      const baseCurrency = portfolio.baseCurrency ?? "USD";
      const portfolioLots = lots.filter((lot) => lot.portfolioId === portfolio.id);
      const view = await buildPortfolioView(
        portfolioLots,
        baseCurrency,
        async (symbol) =>
          securityFromSnapshot(
            quoteMap.get(symbol) ?? { status: "unavailable", reason: "quote unavailable" },
          ),
        { now: () => now, resolveFx },
      );
      return snapshotPortfolio(portfolio.id, portfolioLots, view, quoteMap);
    }),
  );

  const defaultPortfolio = portfolios.find((portfolio) => portfolio.isDefault) ?? portfolios[0];
  const defaultResult =
    portfolioResults.find((result) => result.summary.portfolioId === defaultPortfolio?.id) ??
    portfolioResults[0];
  const emptySummary = createEmptySummary(defaultPortfolio);
  return {
    generatedAt: new Date(now).toISOString(),
    watchlistQuotes,
    portfolioQuotes: portfolioResults.flatMap((result) => result.quotes),
    portfolioSummary: defaultResult?.summary ?? emptySummary,
    portfolioSummaries: portfolioResults.map((result) => result.summary),
  };
}

export function buildUnavailableMarketQuoteSnapshot(state: MarketQuoteState, reason: string) {
  return buildMarketQuoteSnapshotFromUnavailableState(state, reason, new Date());
}

function buildMarketQuoteSnapshotFromUnavailableState(
  state: MarketQuoteState,
  reason: string,
  generatedAt: Date,
) {
  const portfolios = state.portfolios ?? [];
  const watchlistQuotes = (state.watchlist ?? []).map((item) => ({
    itemId: item.id,
    instrumentId: item.instrumentId,
    symbol: item.symbol,
    assetType: item.assetType,
    status: "unavailable" as const,
    reason,
  }));
  const portfolioResults = portfolios.map((portfolio) => {
    const baseCurrency = portfolio.baseCurrency ?? "USD";
    const lots = (state.portfolio ?? []).filter((lot) => lot.portfolioId === portfolio.id);
    const valuation = valuePortfolio({
      lots: lots.map((lot) => ({ ...lot, id: String(lot.id), costCurrency: lot.currency })),
      reportingCurrency: baseCurrency,
      quotes: Object.fromEntries(
        lots.map((lot) => [
          lot.symbol,
          { price: NaN, currency: "", observedAt: null, eligible: false, reason },
        ]),
      ),
      rates: [],
      now: generatedAt.getTime(),
    });
    return snapshotPortfolio(
      portfolio.id,
      lots,
      presentPortfolioValuation(lots, baseCurrency, valuation),
      new Map(),
    );
  });

  const defaultPortfolio = portfolios.find((portfolio) => portfolio.isDefault) ?? portfolios[0];
  const defaultResult =
    portfolioResults.find((result) => result.summary.portfolioId === defaultPortfolio?.id) ??
    portfolioResults[0];
  return {
    generatedAt: generatedAt.toISOString(),
    watchlistQuotes,
    portfolioQuotes: portfolioResults.flatMap((result) => result.quotes),
    portfolioSummary: defaultResult?.summary ?? createEmptySummary(defaultPortfolio),
    portfolioSummaries: portfolioResults.map((result) => result.summary),
  };
}

function createEmptySummary(portfolio?: { id: number; baseCurrency?: string | null }) {
  return {
    portfolioId: portfolio?.id ?? 0,
    baseCurrency: portfolio?.baseCurrency ?? "USD",
    status: "empty" as const,
    valuedSubtotal: 0,
    costSubtotals: [],
    includedLotIds: [],
    excludedLotIds: [],
    totalValue: 0,
    totalCost: 0,
    totalPnl: 0,
    totalPnlPercent: 0,
    excludedFromTotals: [] as Array<{ symbol: string; currency: string; reason: string }>,
  };
}

export type MarketStateQuoteSnapshot = Awaited<ReturnType<typeof buildMarketQuoteSnapshot>>;

function snapshotPortfolio(
  portfolioId: number,
  lots: NonNullable<MarketQuoteState["portfolio"]>,
  view: Awaited<ReturnType<typeof buildPortfolioView>>,
  quoteMap: Map<string, MarketQuoteResult>,
) {
  const { positions, totalsStatus, ...summary } = view;
  return {
    summary: { ...summary, portfolioId, status: totalsStatus },
    quotes: positions.map((position, index) => {
      const quote = quoteMap.get(position.symbol);
      return {
        ...position,
        portfolioId,
        instrumentId: lots[index].instrumentId,
        assetType: lots[index].assetType,
        status: position.quoteStatus,
        reason: position.exclusionReason,
        ...(quote?.status === "ok"
          ? {
              name: quote.name,
              fetchedAt: quote.fetchedAt,
              dataAsOf: quote.dataAsOf,
              stale: quote.stale,
              marketState: quote.marketState,
              nativeChangePercent: quote.changePercent,
              rawCurrency: quote.rawCurrency ?? quote.currency,
              changePercent: quote.currency === view.baseCurrency ? quote.changePercent : null,
              extendedPrice: quote.extendedPrice,
              extendedChange: quote.extendedChange,
              extendedChangePercent: quote.extendedChangePercent,
              extendedAsOf: quote.extendedAsOf,
            }
          : {}),
      };
    }),
  };
}
