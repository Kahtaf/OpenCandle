import { ExternalLink, Plus, Search } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.jsx";
import { Select } from "../../components/ui/select.jsx";
import { symbolPageHref } from "../../route-resolution.js";
import { normalizeWatchlistOptions } from "./watchlist-options.js";

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
  navigate,
  anchorRect = null,
  viewportSize = null,
  sessionMarketFacts = {},
}) {
  const watchlistSelectId = useId();
  const watchlistOptions = useMemo(
    () => normalizeWatchlistOptions(marketState?.watchlists),
    [marketState?.watchlists],
  );
  const [selectedWatchlistId, setSelectedWatchlistId] = useState(
    watchlistOptions[0]?.id ?? "default",
  );
  useEffect(() => {
    if (!watchlistOptions.some((watchlist) => watchlist.id === selectedWatchlistId)) {
      setSelectedWatchlistId(watchlistOptions[0]?.id ?? "default");
    }
  }, [selectedWatchlistId, watchlistOptions]);
  const selectedWatchlist = watchlistOptions.find(
    (watchlist) => watchlist.id === selectedWatchlistId,
  ) ??
    watchlistOptions[0] ?? { id: "default", name: "Default" };
  const normalized = String(symbol || "").toUpperCase();
  if (!normalized) return null;

  const quote =
    findSessionQuote(sessionMarketFacts, normalized) || findQuote(marketState, normalized);
  const name = quote?.name || findName(marketState, normalized) || resolvedCandidate?.name || "";
  const held = hasSymbol(marketState?.portfolio, normalized);
  const watched = hasSymbol(marketState?.watchlist, normalized);
  const canAdd = Boolean(resolvedCandidate?.symbol) && !resolving;
  const disabledHint = resolving
    ? "Resolving symbol..."
    : canAdd
      ? ""
      : resolutionError || "unresolved symbol";
  const placement = computeEntityPopoverPlacement(anchorRect, viewportSize);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor className="fixed z-50" style={placement.anchorStyle}>
        <PopoverTrigger asChild>
          <button type="button" className="sr-only">
            {normalized}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          side={placement.side}
          className="w-[300px] max-w-[calc(100vw-24px)] p-3"
          style={placement.contentStyle}
        >
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-semibold text-foreground">${normalized}</div>
                {name ? <div className="truncate text-xs text-muted-foreground">{name}</div> : null}
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
                          ? "text-sm font-medium tabular-nums text-success"
                          : "text-sm font-medium tabular-nums text-destructive"
                      }
                    >
                      {formatPercent(quote.changePercent)}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 divide-y divide-border text-[11px]">
                  <QuoteFact label="Open" value={formatCurrency(quote.open)} />
                  <QuoteFact label="High" value={formatCurrency(quote.high)} />
                  <QuoteFact label="Low" value={formatCurrency(quote.low)} />
                  <QuoteFact label="Volume" value={formatLargeNumber(quote.volume)} />
                  <QuoteFact label="P/E" value={formatRatio(quote.pe)} />
                  <QuoteFact label="Mkt cap" value={formatMarketCap(quote.marketCap)} />
                </div>
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                No recent quote in this session
              </div>
            )}
            <div className="grid gap-2">
              <label
                htmlFor={watchlistSelectId}
                className="grid gap-1 text-xs font-medium text-muted-foreground"
              >
                Watchlist
                <Select
                  id={watchlistSelectId}
                  size="sm"
                  value={selectedWatchlist.id}
                  disabled={!canAdd}
                  onChange={(event) => setSelectedWatchlistId(event.target.value)}
                >
                  {watchlistOptions.map((watchlist) => (
                    <option key={watchlist.id} value={watchlist.id}>
                      {watchlist.name}
                    </option>
                  ))}
                </Select>
              </label>
              <Button
                type="button"
                size="sm"
                variant="bordered"
                disabled={!canAdd}
                onClick={() =>
                  onAddToWatchlist?.(resolvedCandidate?.symbol || normalized, selectedWatchlist)
                }
              >
                <Plus className="button-icon" />
                Add to {selectedWatchlist.name}
              </Button>
              {!canAdd ? (
                <div className="text-[11px] text-muted-foreground">{disabledHint}</div>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                <Button asChild size="sm" variant="bordered" className="px-2 text-xs">
                  <a
                    href={symbolPageHref(normalized)}
                    onClick={(event) => {
                      if (!navigate) return;
                      event.preventDefault();
                      void navigate({ to: symbolPageHref(normalized) });
                    }}
                  >
                    <ExternalLink className="button-icon" />
                    Open ${normalized} page
                  </a>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="px-2 text-xs"
                  onClick={() => onAskAbout?.(normalized)}
                >
                  <Search className="button-icon" />
                  Ask about ${normalized}
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </PopoverAnchor>
    </Popover>
  );
}

export function computeEntityPopoverPlacement(anchorRect, viewportSize) {
  const viewport = viewportSize || defaultViewportSize();
  const contentWidth = viewport.width < 640 ? viewport.width - 24 : 300;
  const contentHeight = 220;
  const gutter = 12;
  const rect = normalizeRect(anchorRect, viewport);
  const minLeft = contentWidth / 2 + gutter;
  const maxLeft = Math.max(minLeft, viewport.width - contentWidth / 2 - gutter);
  const preferredLeft = rect.left + rect.width / 2;
  const left = clamp(preferredLeft, minLeft, maxLeft);
  const belowSpace = viewport.height - rect.bottom - gutter;
  const side = belowSpace >= contentHeight || rect.top < contentHeight + gutter ? "bottom" : "top";
  return {
    side,
    anchorStyle: {
      left,
      top: side === "bottom" ? rect.bottom : rect.top,
    },
    contentStyle: { width: contentWidth },
  };
}

function QuoteFact({ label, value }) {
  if (!value || value === "--" || value === "—") return null;
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 py-1.5">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="truncate text-right font-mono tabular-nums text-foreground">{value}</div>
    </div>
  );
}

function findSessionQuote(sessionMarketFacts, symbol) {
  const quote = sessionMarketFacts?.[symbol];
  if (!quote) return null;
  return Number.isFinite(quote.price ?? quote.currentPrice) ? quote : null;
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

function formatRatio(value) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "--";
}

function formatMarketCap(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? `$${formatLargeNumber(value)}`
    : "--";
}

function formatLargeNumber(value) {
  if (!Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return value.toLocaleString();
}

function formatPercent(value) {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function defaultViewportSize() {
  if (typeof window === "undefined") return { width: 1024, height: 768 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function normalizeRect(rect, viewport) {
  if (rect && Number.isFinite(rect.left) && Number.isFinite(rect.top)) {
    const width = Number.isFinite(rect.width) ? rect.width : Math.max(0, rect.right - rect.left);
    const height = Number.isFinite(rect.height) ? rect.height : Math.max(0, rect.bottom - rect.top);
    return {
      left: rect.left,
      right: Number.isFinite(rect.right) ? rect.right : rect.left + width,
      top: rect.top,
      bottom: Number.isFinite(rect.bottom) ? rect.bottom : rect.top + height,
      width,
      height,
    };
  }
  return {
    left: viewport.width / 2,
    right: viewport.width / 2,
    top: 96,
    bottom: 96,
    width: 0,
    height: 0,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
