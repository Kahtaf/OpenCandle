import { useEffect, useMemo, useSyncExternalStore } from "react";
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

// One market-state poller per runtime transport, shared by every surface that
// reads market state, so route changes reuse the loaded snapshot instead of
// refetching (#222). It polls only while someone is subscribed and the page is
// visible, never overlaps two reads, and refreshes once when the tab returns.
export class MarketStateStore {
  constructor({
    transport,
    pollMs = MARKET_STATE_POLL_MS,
    quotePollMs = QUOTE_REFRESH_INTERVAL_MS,
    document: doc = globalThis.document,
    now = () => Date.now(),
  }) {
    this.transport = transport;
    this.pollMs = pollMs;
    this.quotePollMs = quotePollMs;
    this.document = doc;
    this.now = now;
    this.snapshot = { state: EMPTY_MARKET_STATE, loading: true, error: "" };
    this.listeners = new Set();
    this.pollTimer = null;
    this.quoteTimer = null;
    this.inFlight = null;
    this.followUp = null;
    this.lastStartedAt = null;
    this.quoteGate = createLatestRequestGate();
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) this.start();
    return () => {
      if (!this.listeners.delete(listener)) return;
      if (this.listeners.size === 0) this.stop();
    };
  };

  // Explicit refreshes follow a mutation and must observe its write, so one
  // requested during a read runs once more after that read instead of reusing it.
  refresh = () => {
    if (!this.inFlight) return this.fetchMarketState();
    this.followUp ??= this.inFlight.then(() => {
      this.followUp = null;
      return this.fetchMarketState();
    });
    return this.followUp;
  };

  refreshQuotes = () => {
    const request = this.quoteGate.start();
    return this.transport.getMarketQuotes(request.signal).then(
      (quoteSnapshot) => {
        if (!request.isLatest()) return;
        this.update((current) => ({
          state: {
            ...current.state,
            quoteSnapshot: mergeQuoteRefreshSnapshot(current.state.quoteSnapshot, quoteSnapshot),
          },
          error: "",
        }));
      },
      (err) => {
        if (!request.isLatest()) return;
        this.update({ error: err instanceof Error ? err.message : String(err) });
      },
    );
  };

  fetchMarketState() {
    this.lastStartedAt = this.now();
    let settled = false;
    let request = null;
    request = (async () => {
      try {
        const data = await this.transport.getMarketState();
        this.update((current) => ({
          state: mergeMarketStateSnapshot(current.state, data),
          error: "",
        }));
      } catch (err) {
        this.update({ error: err instanceof Error ? err.message : String(err) });
      } finally {
        settled = true;
        if (this.inFlight === request) this.inFlight = null;
        this.update({ loading: false });
      }
    })();
    // A transport that throws synchronously has already settled here.
    if (!settled) this.inFlight = request;
    return request;
  }

  hidden() {
    return Boolean(this.document?.hidden);
  }

  poll = () => {
    if (this.inFlight || this.followUp || this.hidden()) return;
    void this.fetchMarketState();
  };

  isStale() {
    return this.lastStartedAt == null || this.now() - this.lastStartedAt >= this.pollMs;
  }

  onVisibilityChange = () => {
    if (this.hidden()) {
      this.clearPollTimer();
      return;
    }
    this.startPollTimer();
    this.poll();
  };

  start() {
    this.document?.addEventListener?.("visibilitychange", this.onVisibilityChange);
    this.quoteTimer = globalThis.setInterval(() => void this.refreshQuotes(), this.quotePollMs);
    if (this.hidden()) return;
    this.startPollTimer();
    if (this.isStale()) this.poll();
  }

  stop() {
    this.document?.removeEventListener?.("visibilitychange", this.onVisibilityChange);
    this.clearPollTimer();
    globalThis.clearInterval(this.quoteTimer);
    this.quoteTimer = null;
    this.quoteGate.cancel();
  }

  startPollTimer() {
    this.clearPollTimer();
    this.pollTimer = globalThis.setInterval(this.poll, this.pollMs);
  }

  clearPollTimer() {
    if (this.pollTimer == null) return;
    globalThis.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  update(change) {
    const patch = typeof change === "function" ? change(this.snapshot) : change;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}

const marketStateStores = new WeakMap();

export function getMarketStateStore(transport) {
  let store = marketStateStores.get(transport);
  if (!store) {
    store = new MarketStateStore({ transport });
    marketStateStores.set(transport, store);
  }
  return store;
}

export function useMarketState({ store } = {}) {
  const transport = useRuntimeTransport();
  const resolvedStore = store ?? getMarketStateStore(transport);
  const { state, loading, error } = useSyncExternalStore(
    resolvedStore.subscribe,
    resolvedStore.getSnapshot,
    resolvedStore.getSnapshot,
  );
  const { refresh, refreshQuotes } = resolvedStore;

  // Fetch quotes as soon as a price-aware surface renders; the store keeps
  // long-lived pages fresh on its shared five-minute cadence without surfacing
  // age badges in the UI.
  useEffect(() => {
    void refreshQuotes();
  }, [refreshQuotes]);

  return useMemo(
    () => ({ state, loading, error, refresh, refreshQuotes }),
    [state, loading, error, refresh, refreshQuotes],
  );
}
