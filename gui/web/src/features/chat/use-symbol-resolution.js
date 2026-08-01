import { useEffect, useState } from "react";
import { useRuntimeTransport } from "../../runtime/runtime-transport-context.js";
import { searchInstruments } from "../instruments/instrument-api.js";

const EMPTY_SYMBOL_RESOLUTION = {
  candidate: null,
  error: "",
  resolving: false,
};

export function useSymbolResolution(selectedSymbol) {
  const transport = useRuntimeTransport();
  const [resolution, setResolution] = useState(EMPTY_SYMBOL_RESOLUTION);

  useEffect(() => {
    if (!selectedSymbol) {
      setResolution(EMPTY_SYMBOL_RESOLUTION);
      return undefined;
    }
    let disposed = false;
    setResolution({ candidate: null, error: "", resolving: true });
    searchInstruments(selectedSymbol, transport)
      .then((candidates) => {
        if (disposed) return;
        const normalizedSelected = selectedSymbol.trim().toUpperCase();
        const match =
          candidates.find(
            (candidate) => candidate.symbol?.trim().toUpperCase() === normalizedSelected,
          ) ?? null;
        setResolution({
          candidate: match,
          error: match ? "" : "unresolved symbol",
          resolving: false,
        });
      })
      .catch((error) => {
        if (disposed) return;
        setResolution({
          candidate: null,
          error: error instanceof Error ? error.message : String(error),
          resolving: false,
        });
      });
    return () => {
      disposed = true;
    };
  }, [selectedSymbol, transport]);

  return resolution;
}
