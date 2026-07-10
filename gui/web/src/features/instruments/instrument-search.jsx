import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
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
  portalAnchor,
  onActiveIndexChange,
  onSelect,
}) {
  const [position, setPosition] = useState(null);

  const candidateCount = candidates?.length ?? 0;

  // Re-measure whenever the list re-renders, not just on anchor mount: the
  // anchor can be measured mid sheet-enter animation, which would freeze the
  // portal at a stale position.
  useLayoutEffect(() => {
    if (!portalAnchor || candidateCount === 0) return undefined;
    let frame = 0;
    const update = () => {
      const rect = portalAnchor.getBoundingClientRect();
      setPosition((prev) => {
        const next = { left: rect.left, top: rect.bottom + 4, width: rect.width };
        return prev && prev.left === next.left && prev.top === next.top && prev.width === next.width
          ? prev
          : next;
      });
    };
    update();
    // One extra post-paint pass catches enter animations settling this frame.
    frame = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [portalAnchor, candidateCount]);

  if (!candidates?.length) return null;
  const prefix = optionIdPrefix || id || "instrument-suggestion";

  const list = (
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

  if (!portalAnchor || !position || typeof document === "undefined") return list;
  return createPortal(
    <div className="fixed z-50" style={position}>
      {list}
    </div>,
    document.body,
  );
}
