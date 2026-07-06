import { Plus, Search } from "lucide-react";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.jsx";

export function EntityPopover({
  open,
  onOpenChange,
  symbol,
  marketState,
  resolvedCandidate,
  resolutionError = "",
  resolving = false,
  onAddToWatchlist,
  onAskAbout,
}) {
  const normalized = String(symbol || "").toUpperCase();
  if (!normalized) return null;

  const quote = findQuote(marketState, normalized);
  const name = findName(marketState, normalized) || resolvedCandidate?.name || normalized;
  const held = hasSymbol(marketState?.portfolio, normalized);
  const watched = hasSymbol(marketState?.watchlist, normalized);
  const canAdd = Boolean(resolvedCandidate?.symbol) && !resolving;
  const disabledHint = resolving
    ? "Resolving symbol..."
    : canAdd
      ? ""
      : resolutionError || "unresolved symbol";

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor className="fixed left-1/2 top-24 z-50 -translate-x-1/2">
        <PopoverTrigger asChild>
          <button type="button" className="sr-only">
            {normalized}
          </button>
        </PopoverTrigger>
        <PopoverContent align="center" side="bottom" className="w-[300px] p-3">
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-semibold text-foreground">${normalized}</div>
                <div className="truncate text-xs text-muted-foreground">{name}</div>
              </div>
              <div className="flex shrink-0 gap-1">
                {held ? <Badge size="sm">Held</Badge> : null}
                {watched ? (
                  <Badge size="sm" variant="outline">
                    Watchlist
                  </Badge>
                ) : null}
              </div>
            </div>
            {quote ? (
              <div className="rounded-md border border-border bg-secondary px-3 py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-lg font-semibold text-foreground">
                    {formatCurrency(quote.price ?? quote.currentPrice)}
                  </span>
                  {typeof quote.changePercent === "number" ? (
                    <span
                      className={
                        quote.changePercent >= 0
                          ? "text-sm font-medium text-emerald-600"
                          : "text-sm font-medium text-red-600"
                      }
                    >
                      {formatPercent(quote.changePercent)}
                    </span>
                  ) : null}
                </div>
                {freshnessLine(quote) ? (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {freshnessLine(quote)}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                No cached quote
              </div>
            )}
            <div className="grid gap-2">
              <Button
                type="button"
                size="sm"
                variant="bordered"
                disabled={!canAdd}
                onClick={() => onAddToWatchlist?.(resolvedCandidate?.symbol || normalized)}
              >
                <Plus className="button-icon" />
                Add to watchlist
              </Button>
              {!canAdd ? (
                <div className="text-[11px] text-muted-foreground">{disabledHint}</div>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onAskAbout?.(normalized)}
              >
                <Search className="button-icon" />
                Ask about ${normalized}
              </Button>
            </div>
          </div>
        </PopoverContent>
      </PopoverAnchor>
    </Popover>
  );
}

function findQuote(marketState, symbol) {
  const snapshot = marketState?.quoteSnapshot;
  const quotes = [...(snapshot?.watchlistQuotes ?? []), ...(snapshot?.portfolioQuotes ?? [])];
  return quotes.find((quote) => quote?.symbol === symbol && quote.status === "ok") || null;
}

function findName(marketState, symbol) {
  const rows = [
    ...(marketState?.watchlist ?? []),
    ...(marketState?.portfolio ?? []),
    ...(marketState?.instruments ?? []),
  ];
  return rows.find((row) => row?.symbol === symbol)?.name || "";
}

function hasSymbol(rows, symbol) {
  return (rows ?? []).some((row) => row?.symbol === symbol);
}

function formatCurrency(value) {
  return typeof value === "number" ? `$${value.toFixed(2)}` : "--";
}

function formatPercent(value) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function freshnessLine(quote) {
  const freshness = quote?.freshness;
  if (typeof freshness === "string") return freshness;
  if (freshness && typeof freshness === "object") {
    return freshness.line || freshness.asOfLine || freshness.label || "";
  }
  return quote?.fetchedAt ? `Fetched ${quote.fetchedAt}` : "";
}
