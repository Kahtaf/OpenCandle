import { useEffect, useMemo, useState } from "react";
import { useInstrumentHistory } from "../../hooks/useInstrumentHistory.jsx";
import { useMarketState } from "../../hooks/useMarketState.jsx";
import { buildAlertSentenceRows } from "../market-state/alert-view-model.js";
import { buildHoldingRows } from "../market-state/portfolio-view-model.js";

export function deriveSymbolContext(state = {}, ticker = "") {
  const symbol = ticker.trim().toUpperCase();
  const instrument = (state.instruments ?? []).find(
    (candidate) => candidate.symbol?.toUpperCase() === symbol,
  );
  const instrumentId = instrument?.id ?? null;
  const positionRows = buildHoldingRows(
    (state.portfolio ?? []).filter((lot) => lot.symbol?.toUpperCase() === symbol),
    state.quoteSnapshot?.portfolioQuotes ?? [],
  );
  const alertRows = buildAlertSentenceRows(
    (state.alerts ?? []).filter((rule) => rule.instrumentId === instrumentId),
    state.alertEvents ?? [],
    state.instruments ?? [],
  );
  const watchlistsById = new Map(
    (state.watchlists ?? []).map((watchlist) => [watchlist.id, watchlist.name]),
  );
  const memberships = (state.watchlist ?? [])
    .filter((item) => item.symbol?.toUpperCase() === symbol)
    .map((item) => ({
      ...item,
      watchlistName: watchlistsById.get(item.watchlistId) ?? "Watchlist",
    }));
  const stateQuote = (state.quoteSnapshot?.watchlistQuotes ?? []).find(
    (candidate) => candidate.symbol?.toUpperCase() === symbol,
  );

  return { symbol, instrumentId, positionRows, alertRows, memberships, stateQuote };
}

export function useSymbolData(ticker, range = "1M") {
  const symbol = ticker.trim().toUpperCase();
  const marketState = useMarketState();
  const quote = useSymbolEndpoint("quote", symbol);
  const overview = useSymbolEndpoint("overview", symbol);
  const history = useInstrumentHistory(symbol, range);
  const context = useMemo(
    () => deriveSymbolContext(marketState.state, symbol),
    [marketState.state, symbol],
  );

  return {
    ...context,
    state: marketState.state,
    quote: context.stateQuote ?? quote.snapshot,
    overview: overview.snapshot,
    history: history.snapshot,
    loading:
      marketState.loading ||
      (quote.loading && !context.stateQuote) ||
      overview.loading ||
      history.loading,
    quoteLoading: quote.loading && !context.stateQuote,
    overviewLoading: overview.loading,
    historyLoading: history.loading,
    error: marketState.error || quote.error || overview.error || history.error,
    refresh: marketState.refresh,
    refreshQuotes: marketState.refreshQuotes,
  };
}

function useSymbolEndpoint(endpoint, symbol) {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let disposed = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/instruments/${endpoint}?symbol=${encodeURIComponent(symbol)}`,
        );
        if (!response.ok) throw new Error(response.statusText || `Failed to load ${endpoint}`);
        const data = await response.json();
        if (!disposed) setSnapshot(data);
      } catch (err) {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void run();
    return () => {
      disposed = true;
    };
  }, [endpoint, symbol]);

  return { snapshot, loading, error };
}
