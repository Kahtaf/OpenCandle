import { Button } from "../../components/ui/button.jsx";
import { cn } from "../../lib/utils.js";
import {
  formatInstrumentCandidateLabel,
  formatInstrumentCandidateMeta,
  instrumentCandidateKey,
  instrumentSuggestionOptionId,
} from "./instrument-search-helpers.js";

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
