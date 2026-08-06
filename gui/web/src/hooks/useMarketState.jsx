import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRuntimeTransport } from "../runtime/runtime-transport-context.js";

export const MARKET_STATE_POLL_MS = 4000;
export const QUOTE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export function createLatestRequestGate() {
  let generation = 0;
  let activeController = null;
  return {
    start() {
      activeController?.abort();
      const controller = new AbortController();
      activeController = controller;
      const requestGeneration = ++generation;
      return {
        signal: controller.signal,
        isLatest: () => requestGeneration === generation && !controller.signal.aborted,
      };
    },
    cancel() {
      activeController?.abort();
      activeController = null;
      generation += 1;
    },
  };
}

export const EMPTY_MARKET_STATE = {
  instruments: [],
  watchlists: [],
  portfolios: [],
  watchlist: [],
  portfolio: [],
  alerts: [],
  alertEvents: [],
  alertCheckRuns: [],
  reportTemplates: [],
  reportRuns: [],
  runnerLease: null,
  notifications: [],
  notificationDeliveryAttempts: [],
  quoteSnapshot: null,
  // False until a market-state response has been merged. Quote refreshes can
  // resolve first, so an empty `portfolio` before that means "not loaded yet".
  loaded: false,
};

export function mergeMarketStateSnapshot(current, data) {
  const quoteSnapshot = Object.hasOwn(data, "quoteSnapshot")
    ? mergeQuoteRefreshSnapshot(current?.quoteSnapshot, data.quoteSnapshot)
    : mergePreservedQuoteSnapshot(current, data);
  return {
    ...EMPTY_MARKET_STATE,
    ...data,
    quoteSnapshot,
    loaded: true,
  };
}

export function mergeQuoteRefreshSnapshot(current, refreshed) {
  if (!current || !refreshed) return refreshed ?? current ?? null;
  const refreshFailedAt = refreshed.generatedAt;
  const watchlistQuotes = mergeQuoteRows(
    current.watchlistQuotes,
    refreshed.watchlistQuotes,
    "itemId",
    refreshFailedAt,
  );
  const portfolioQuotes = mergeQuoteRows(
    current.portfolioQuotes,
    refreshed.portfolioQuotes,
    "lotId",
    refreshFailedAt,
  );
  const stalePortfolioIds = new Set();
  for (const quote of portfolioQuotes) {
    if (quote?.refreshStatus === "unavailable") stalePortfolioIds.add(quote.portfolioId);
  }
  for (const quote of refreshed.portfolioQuotes ?? []) {
    if (quote?.status === "unavailable") stalePortfolioIds.add(quote.portfolioId);
  }
  const portfolioSummaries = mergePortfolioSummaries(
    current.portfolioSummaries,
    refreshed.portfolioSummaries,
    portfolioQuotes,
    stalePortfolioIds,
    refreshFailedAt,
  );
  const portfolioSummary = mergePortfolioSummary(
    current.portfolioSummary,
    refreshed.portfolioSummary,
    portfolioQuotes,
    stalePortfolioIds,
    refreshFailedAt,
  );
  const retainedUnavailable =
    watchlistQuotes.some((quote) => quote?.refreshStatus === "unavailable") ||
    portfolioQuotes.some((quote) => quote?.refreshStatus === "unavailable");
  return {
    ...refreshed,
    ...(Object.hasOwn(refreshed, "watchlistQuotes") ? { watchlistQuotes } : {}),
    ...(Object.hasOwn(refreshed, "portfolioQuotes") ? { portfolioQuotes } : {}),
    ...(Object.hasOwn(refreshed, "portfolioSummary") ? { portfolioSummary } : {}),
    ...(Object.hasOwn(refreshed, "portfolioSummaries") ? { portfolioSummaries } : {}),
    ...(retainedUnavailable
      ? {
          lastSuccessfulGeneratedAt:
            current.lastSuccessfulGeneratedAt ?? current.generatedAt ?? null,
        }
      : {}),
  };
}

function mergeQuoteRows(currentRows = [], refreshedRows = [], identityKey, refreshFailedAt) {
  const currentById = new Map(currentRows.map((quote) => [quote?.[identityKey], quote]));
  return refreshedRows.map((quote) => {
    const current = currentById.get(quote?.[identityKey]);
    if (
      quote?.status !== "unavailable" ||
      current?.status !== "ok" ||
      !isRetainableQuoteFailure(quote)
    ) {
      return quote;
    }
    return {
      ...current,
      stale: true,
      refreshStatus: "unavailable",
      refreshReason: quote.reason || "Quote refresh unavailable",
      refreshFailedAt,
    };
  });
}

function isRetainableQuoteFailure(quote) {
  return !/currency|fx conversion/i.test(String(quote?.reason ?? ""));
}

function mergePortfolioSummaries(
  currentSummaries = [],
  refreshedSummaries = [],
  portfolioQuotes,
  stalePortfolioIds,
  refreshFailedAt,
) {
  const currentById = new Map(currentSummaries.map((summary) => [summary.portfolioId, summary]));
  return refreshedSummaries.map((summary) =>
    stalePortfolioIds.has(summary.portfolioId)
      ? retainPortfolioSummary(
          currentById.get(summary.portfolioId),
          summary,
          portfolioQuotes,
          refreshFailedAt,
        )
      : summary,
  );
}

function mergePortfolioSummary(
  current,
  refreshed,
  portfolioQuotes,
  stalePortfolioIds,
  refreshFailedAt,
) {
  if (!refreshed || !stalePortfolioIds.has(refreshed.portfolioId)) return refreshed;
  return retainPortfolioSummary(current, refreshed, portfolioQuotes, refreshFailedAt);
}

function retainPortfolioSummary(current, refreshed, portfolioQuotes, refreshFailedAt) {
  if (!current || current.status === "unavailable") return refreshed;
  const rows = portfolioQuotes.filter((quote) => quote?.portfolioId === refreshed.portfolioId);
  const includedRows = rows.filter((quote) => quote?.includedInTotals !== false);
  const hasUnavailableBaseCurrencyRow = rows.some(
    (quote) =>
      quote?.status === "unavailable" &&
      (!quote.currency || quote.currency === refreshed.baseCurrency),
  );
  const canRecompute =
    !hasUnavailableBaseCurrencyRow &&
    includedRows.length > 0 &&
    includedRows.every(
      (quote) =>
        quote?.status === "ok" &&
        Number.isFinite(quote.marketValue) &&
        Number.isFinite(quote.totalCost) &&
        Number.isFinite(quote.pnl),
    );
  if (!canRecompute) {
    return {
      ...refreshed,
      stale: true,
      refreshStatus: "unavailable",
      refreshReason: refreshed?.reason || "Quote refresh unavailable",
      refreshFailedAt,
    };
  }
  const totalValue = includedRows.reduce((sum, quote) => sum + quote.marketValue, 0);
  const totalCost = includedRows.reduce((sum, quote) => sum + quote.totalCost, 0);
  const totalPnl = includedRows.reduce((sum, quote) => sum + quote.pnl, 0);
  return {
    ...current,
    status: "ok",
    totalValue,
    totalCost,
    totalPnl,
    totalPnlPercent: totalCost > 0 ? (totalPnl / totalCost) * 100 : 0,
    stale: true,
    refreshStatus: "unavailable",
    refreshReason: refreshed?.reason || "Quote refresh unavailable",
    refreshFailedAt,
  };
}

function mergePreservedQuoteSnapshot(current, data) {
  const quoteSnapshot = current?.quoteSnapshot ?? null;
  if (!quoteSnapshot) return null;
  if (!Object.hasOwn(data, "portfolio")) return quoteSnapshot;
  // Without a previously loaded portfolio there is nothing to diff against: the
  // saved lots arriving for the first time is not a portfolio edit, so dropping
  // freshly fetched quote rows here would blank the portfolio page until the
  // next five-minute quote refresh.
  if (!current?.loaded) return quoteSnapshot;
  if (portfolioSignature(current?.portfolio ?? []) === portfolioSignature(data.portfolio ?? [])) {
    return quoteSnapshot;
  }
  return {
    ...quoteSnapshot,
    portfolioQuotes: [],
    portfolioSummary: null,
    portfolioSummaries: [],
  };
}

function portfolioSignature(portfolio) {
  return portfolio
    .map((lot) =>
      [lot.id, lot.instrumentId, lot.symbol, lot.quantity, lot.avgCost, lot.currency].join(":"),
    )
    .sort()
    .join("|");
}

export function useMarketState({
  pollMs = MARKET_STATE_POLL_MS,
  quotePollMs = QUOTE_REFRESH_INTERVAL_MS,
} = {}) {
  const transport = useRuntimeTransport();
  const [state, setState] = useState(EMPTY_MARKET_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const quoteRefreshGate = useRef(null);
  quoteRefreshGate.current ??= createLatestRequestGate();

  const refresh = useCallback(async () => {
    try {
      const data = await transport.getMarketState();
      setState((current) => mergeMarketStateSnapshot(current, data));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [transport]);

  const refreshQuotes = useCallback(() => {
    const request = quoteRefreshGate.current.start();
    return transport.getMarketQuotes(request.signal).then(
      (quoteSnapshot) => {
        if (!request.isLatest()) return;
        setState((current) => ({
          ...current,
          quoteSnapshot: mergeQuoteRefreshSnapshot(current.quoteSnapshot, quoteSnapshot),
        }));
        setError("");
      },
      (err) => {
        if (!request.isLatest()) return;
        setError(err instanceof Error ? err.message : String(err));
      },
    );
  }, [transport]);

  useEffect(() => {
    let disposed = false;
    const run = async () => {
      if (!disposed) await refresh();
    };
    void run();
    const timer = window.setInterval(run, pollMs);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [pollMs, refresh]);

  // Fetch quotes as soon as a price-aware surface renders, then keep long-lived
  // pages fresh without surfacing age badges in the UI.
  useEffect(() => {
    let disposed = false;
    const gate = quoteRefreshGate.current;
    const run = async () => {
      if (!disposed) await refreshQuotes();
    };
    void run();
    const timer = window.setInterval(run, quotePollMs);
    return () => {
      disposed = true;
      gate.cancel();
      window.clearInterval(timer);
    };
  }, [quotePollMs, refreshQuotes]);

  return useMemo(
    () => ({ state, loading, error, refresh, refreshQuotes }),
    [state, loading, error, refresh, refreshQuotes],
  );
}
