import { useEffect, useMemo, useState } from "react";
import { useInstrumentHistory } from "../../hooks/useInstrumentHistory.jsx";
import { useMarketState } from "../../hooks/useMarketState.jsx";
import { useRuntimeTransport } from "../../runtime/runtime-transport-context.js";
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

export function useSymbolEndpoint(endpoint, symbol) {
  const transport = useRuntimeTransport();
  const requestKey = `${endpoint}:${symbol}`;
  const [state, setState] = useState({
    key: requestKey,
    snapshot: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let disposed = false;
    const run = async () => {
      setState({ key: requestKey, snapshot: null, loading: true, error: null });
      try {
        const data = await transport.getInstrumentEndpoint(endpoint, symbol);
        if (!disposed) setState({ key: requestKey, snapshot: data, loading: false, error: null });
      } catch (err) {
        if (!disposed) {
          setState({
            key: requestKey,
            snapshot: null,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };
    void run();
    return () => {
      disposed = true;
    };
  }, [endpoint, symbol, requestKey, transport]);

  return state.key === requestKey
    ? { snapshot: state.snapshot, loading: state.loading, error: state.error }
    : { snapshot: null, loading: true, error: null };
}
