import { useEffect, useState } from "react";

export function useInstrumentHistory(symbol, range) {
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
          `/api/instruments/history?symbol=${encodeURIComponent(symbol)}&range=${range}`,
        );
        if (!response.ok) {
          throw new Error(response.statusText || "Failed to load instrument history");
        }
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
  }, [symbol, range]);

  return { snapshot, loading, error };
}
