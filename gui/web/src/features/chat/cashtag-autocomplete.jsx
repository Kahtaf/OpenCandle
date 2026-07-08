import { useMemo } from "react";
import { InstrumentSuggestionList } from "../instruments/instrument-search.jsx";
import {
  instrumentSuggestionOptionId,
  nextInstrumentActiveIndex,
} from "../instruments/instrument-search-helpers.js";
import { useInstrumentSearch } from "../instruments/use-instrument-search.js";
import { detectCashtagFragment } from "./cashtag-autocomplete-helpers.js";

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
