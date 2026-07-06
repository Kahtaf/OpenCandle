import { useMemo } from "react";
import {
  InstrumentSuggestionList,
  instrumentSuggestionOptionId,
  nextInstrumentActiveIndex,
  useInstrumentSearch,
} from "../instruments/instrument-search.jsx";

export function detectCashtagFragment(text, caretIndex) {
  const value = String(text ?? "");
  const index = Math.max(0, Math.min(Number(caretIndex) || 0, value.length));
  const prefix = value.slice(0, index);
  const match = prefix.match(/(^|[^A-Za-z0-9_])\$([A-Za-z]{1,6})$/);
  if (!match) return null;
  const fragment = match[2];
  const start = index - fragment.length - 1;
  return { fragment, start, end: index };
}

export function insertAcceptedCashtag(text, match, symbol) {
  const value = String(text ?? "");
  const replacement = `$${String(symbol ?? "")
    .trim()
    .toUpperCase()} `;
  const start = Math.max(0, match.start);
  const end = Math.max(start, match.end);
  return {
    text: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
    caretIndex: start + replacement.length,
  };
}

export function useCashtagAutocomplete({ text, caretIndex, disabled = false, onAccept }) {
  const match = useMemo(
    () => (disabled ? null : detectCashtagFragment(text, caretIndex)),
    [disabled, text, caretIndex],
  );
  const fragment = match?.fragment || "";
  const { candidates, setCandidates, activeIndex, setActiveIndex } = useInstrumentSearch({
    query: fragment,
    enabled: Boolean(fragment) && !disabled,
    minLength: 1,
    limit: 8,
    initialActiveIndex: 0,
  });
  const open = candidates.length > 0 && Boolean(match);

  const accept = (index = activeIndex) => {
    const candidate = candidates[index];
    if (!candidate || !match) return false;
    onAccept?.(candidate.symbol, match);
    setCandidates([]);
    return true;
  };

  const handleKeyDown = (event) => {
    if (!open) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) =>
        nextInstrumentActiveIndex(index, candidates.length, "next", { wrap: false }),
      );
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) =>
        nextInstrumentActiveIndex(index, candidates.length, "previous", { wrap: false }),
      );
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      accept();
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setCandidates([]);
      return true;
    }
    return false;
  };

  return {
    open,
    candidates,
    activeIndex,
    setActiveIndex,
    activeId: open ? instrumentSuggestionOptionId("cashtag", activeIndex) : undefined,
    accept,
    handleKeyDown,
  };
}

export function CashtagAutocomplete({ controller }) {
  if (!controller?.open) return null;
  return (
    <InstrumentSuggestionList
      id="cashtag-autocomplete-list"
      optionIdPrefix="cashtag"
      candidates={controller.candidates}
      activeIndex={controller.activeIndex}
      activeDescendant={controller.activeId}
      symbolPrefix="$"
      detailsAlign="left"
      className="absolute bottom-full left-3 right-3 z-30 mb-2 max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-subtle-md"
      rowClassName="rounded-md px-2 text-sm"
      onActiveIndexChange={controller.setActiveIndex}
      onSelect={(_candidate, index) => controller.accept(index)}
    />
  );
}
