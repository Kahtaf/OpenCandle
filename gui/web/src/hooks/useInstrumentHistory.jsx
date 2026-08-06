import { useEffect, useState } from "react";
import { useRuntimeTransport } from "../runtime/runtime-transport-context.js";

export function useInstrumentHistory(symbol, range) {
  const transport = useRuntimeTransport();
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
      setState({
        key: requestKey,
        snapshot: null,
        loading: true,
        error: null,
      });
      try {
        const data = await transport.getInstrumentHistory(symbol, range);
        if (!disposed) {
          setState({ key: requestKey, snapshot: data, loading: false, error: null });
        }
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
  }, [symbol, range, requestKey, transport]);

  if (state.key === requestKey) {
    return { snapshot: state.snapshot, loading: state.loading, error: state.error };
  }
  return { snapshot: null, loading: true, error: null };
}
