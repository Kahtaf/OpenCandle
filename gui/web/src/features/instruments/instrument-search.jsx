import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { cn } from "../../lib/utils.js";
import { searchInstruments } from "./instrument-api.js";

export const DEFAULT_INSTRUMENT_SEARCH_DEBOUNCE_MS = 200;

export function useInstrumentSearch({
  query,
  enabled = true,
  minLength = 1,
  limit = 8,
  debounceMs = DEFAULT_INSTRUMENT_SEARCH_DEBOUNCE_MS,
  initialActiveIndex = 0,
} = {}) {
  const [candidates, setCandidates] = useState([]);
  const [activeIndex, setActiveIndex] = useState(initialActiveIndex);
  const trimmedQuery = String(query ?? "").trim();

  useEffect(() => {
    if (!enabled || trimmedQuery.length < minLength) {
      setCandidates([]);
      setActiveIndex(initialActiveIndex);
      return undefined;
    }

    let disposed = false;
    const timer = window.setTimeout(() => {
      searchInstruments(trimmedQuery)
        .then((items) => {
          if (disposed) return;
          const next = Array.isArray(items) ? items.slice(0, limit) : [];
          setCandidates(next);
          setActiveIndex(next.length > 0 ? initialActiveIndex : -1);
        })
        .catch(() => {
          if (!disposed) {
            setCandidates([]);
            setActiveIndex(initialActiveIndex);
          }
        });
    }, debounceMs);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [debounceMs, enabled, initialActiveIndex, limit, minLength, trimmedQuery]);

  return { candidates, setCandidates, activeIndex, setActiveIndex };
}

export function InstrumentSuggestionList({
  id,
  optionIdPrefix,
  candidates,
  activeIndex,
  activeDescendant,
  className,
  rowClassName,
  detailsAlign = "right",
  symbolPrefix = "",
  ariaLabel = "Ticker suggestions",
  onActiveIndexChange,
  onSelect,
}) {
  if (!candidates?.length) return null;
  const prefix = optionIdPrefix || id || "instrument-suggestion";

  return (
    <div
      id={id}
      role="listbox"
      aria-label={ariaLabel}
      aria-activedescendant={activeDescendant}
      tabIndex={activeDescendant ? -1 : undefined}
      className={cn(
        "overflow-hidden rounded-md border border-border bg-card shadow-subtle-md",
        className,
      )}
    >
      {candidates.map((candidate, index) => (
        <Button
          key={instrumentCandidateKey(candidate, index)}
          id={instrumentSuggestionOptionId(prefix, index)}
          type="button"
          variant="ghost"
          role="option"
          aria-selected={index === activeIndex}
          className={cn(
            "flex h-auto w-full items-center justify-between gap-3 rounded-none px-3 py-2 text-left hover:bg-secondary",
            index === activeIndex && "bg-secondary",
            rowClassName,
          )}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onActiveIndexChange?.(index)}
          onClick={() => onSelect?.(candidate, index)}
        >
          <span className="shrink-0 font-mono font-medium text-foreground">
            {symbolPrefix}
            {String(candidate.symbol || "").toUpperCase()}
          </span>
          <span
            className={cn("min-w-0 flex-1", detailsAlign === "left" ? "text-left" : "text-right")}
          >
            <span className="block truncate text-muted-foreground">
              {formatInstrumentCandidateLabel(candidate)}
            </span>
            {formatInstrumentCandidateMeta(candidate) ? (
              <span className="block truncate text-xs text-muted-foreground">
                {formatInstrumentCandidateMeta(candidate)}
              </span>
            ) : null}
          </span>
        </Button>
      ))}
    </div>
  );
}

export function instrumentSuggestionOptionId(optionIdPrefix, index) {
  return `${optionIdPrefix || "instrument-suggestion"}-option-${index}`;
}

export function instrumentCandidateKey(candidate, index) {
  return [
    candidate?.provider || "provider",
    candidate?.symbol || "symbol",
    candidate?.exchange || "exchange",
    index,
  ].join(":");
}

export function formatInstrumentCandidateLabel(candidate) {
  return candidate?.name || candidate?.quoteType || candidate?.symbol || "";
}

export function formatInstrumentCandidateMeta(candidate) {
  return [candidate?.exchange, candidate?.quoteType].filter(Boolean).join(" · ");
}

export function clampInstrumentActiveIndex(activeIndex, candidateCount) {
  if (candidateCount <= 0) return -1;
  if (activeIndex < 0) return -1;
  return Math.min(activeIndex, candidateCount - 1);
}

export function nextInstrumentActiveIndex(
  activeIndex,
  candidateCount,
  direction,
  { wrap = true } = {},
) {
  if (candidateCount <= 0) return -1;
  const current = clampInstrumentActiveIndex(activeIndex, candidateCount);
  if (direction === "next") {
    if (wrap) return (current + 1) % candidateCount;
    return Math.min(current + 1, candidateCount - 1);
  }
  if (wrap) return current <= 0 ? candidateCount - 1 : current - 1;
  return Math.max(current - 1, 0);
}
