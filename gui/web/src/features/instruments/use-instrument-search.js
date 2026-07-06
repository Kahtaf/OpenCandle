import { useCallback, useEffect, useState } from "react";
import { searchInstruments } from "./instrument-api.js";
import { resolveInstrumentSearchState } from "./instrument-search-helpers.js";

export const DEFAULT_INSTRUMENT_SEARCH_DEBOUNCE_MS = 200;

export function useInstrumentSearch({
  query,
  enabled = true,
  minLength = 1,
  limit = 8,
  debounceMs = DEFAULT_INSTRUMENT_SEARCH_DEBOUNCE_MS,
  initialActiveIndex = 0,
} = {}) {
  const [searchState, setSearchState] = useState({
    query: "",
    candidates: [],
    activeIndex: initialActiveIndex,
  });
  const trimmedQuery = String(query ?? "").trim();
  const resolved = resolveInstrumentSearchState({
    state: searchState,
    query: trimmedQuery,
    enabled,
    minLength,
    initialActiveIndex,
  });

  useEffect(() => {
    if (!enabled || trimmedQuery.length < minLength) {
      return undefined;
    }

    let disposed = false;
    const timer = window.setTimeout(() => {
      searchInstruments(trimmedQuery)
        .then((items) => {
          if (disposed) return;
          const next = Array.isArray(items) ? items.slice(0, limit) : [];
          setSearchState({
            query: trimmedQuery,
            candidates: next,
            activeIndex: next.length > 0 ? initialActiveIndex : -1,
          });
        })
        .catch(() => {
          if (!disposed) {
            setSearchState({
              query: trimmedQuery,
              candidates: [],
              activeIndex: initialActiveIndex,
            });
          }
        });
    }, debounceMs);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [debounceMs, enabled, initialActiveIndex, limit, minLength, trimmedQuery]);

  const setCandidates = useCallback(
    (nextCandidates) => {
      setSearchState((current) => ({
        ...current,
        query: trimmedQuery,
        candidates:
          typeof nextCandidates === "function"
            ? nextCandidates(current.candidates)
            : nextCandidates,
      }));
    },
    [trimmedQuery],
  );
  const setActiveIndex = useCallback((nextActiveIndex) => {
    setSearchState((current) => ({
      ...current,
      activeIndex:
        typeof nextActiveIndex === "function"
          ? nextActiveIndex(current.activeIndex)
          : nextActiveIndex,
    }));
  }, []);

  return {
    candidates: resolved.candidates,
    setCandidates,
    activeIndex: resolved.activeIndex,
    setActiveIndex,
  };
}
