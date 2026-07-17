import { useEffect, useState } from "react";

export function useInstrumentHistory(symbol, range) {
  const requestKey = `${symbol}:${range}`;
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
        const response = await fetch(
          `/api/instruments/history?symbol=${encodeURIComponent(symbol)}&range=${range}`,
        );
        if (!response.ok) {
          throw new Error(response.statusText || "Failed to load instrument history");
        }
        const data = await response.json();
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
  }, [symbol, range, requestKey]);

  return state.key === requestKey
    ? { snapshot: state.snapshot, loading: state.loading, error: state.error }
    : { snapshot: null, loading: true, error: null };
}
