import { useMemo } from "react";
import { MarketSparkline } from "../../components/market-sparkline.jsx";
import { Skeleton } from "../../components/ui/skeleton.jsx";
import { formatPercent, formatPrice } from "../../lib/financial-format.js";
import { instrumentDisplayName } from "../../lib/instrument-display.js";
import { cn } from "../../lib/utils.js";
import { symbolPageHref } from "../../route-resolution.js";
import { degradedQuoteBadge, quoteFreshnessTitle } from "../market-state/format.js";
import { Badge, Panel, quoteFlashClass, useQuoteChangeFlash } from "../market-state/shared.jsx";

const HEADING_ID = "home-indices-heading";
const EMPTY_QUOTES = [];
const SKELETON_KEYS = ["sp500", "nasdaq", "dow", "bitcoin"];

export function IndicesStrip({
  quotes = EMPTY_QUOTES,
  loading = false,
  unavailable = false,
  nowMs = Date.now(),
  timeZone,
}) {
  const availableQuotes = useMemo(() => quotes.filter((quote) => quote?.status === "ok"), [quotes]);
  const quotesBySymbol = useMemo(
    () => new Map(availableQuotes.map((quote) => [quote.symbol, quote])),
    [availableQuotes],
  );
  const quoteFlashes = useQuoteChangeFlash(quotesBySymbol);
  const freshness = loading ? null : degradedQuoteBadge(availableQuotes, nowMs);
  const freshnessTitle = quoteFreshnessTitle(availableQuotes, timeZone);

  if (unavailable || (!loading && availableQuotes.length === 0)) return null;

  return (
    <section aria-labelledby={HEADING_ID} data-slot="home-indices-strip">
      <Panel
        title={<span id={HEADING_ID}>Markets</span>}
        meta={
          freshness ? (
            <Badge tone="warn" title={freshnessTitle}>
              {freshness}
            </Badge>
          ) : null
        }
      >
        {loading ? (
          <div className="grid min-h-[112px] grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
            {SKELETON_KEYS.map((key) => (
              <div key={key} className="bg-card p-4">
                <Skeleton className="h-16 w-full" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
            {availableQuotes.map((quote) => {
              const displayName = instrumentDisplayName(quote.symbol, quote.name);
              return (
                <a
                  key={quote.symbol}
                  href={symbolPageHref(quote.symbol)}
                  className={cn(
                    "flex min-h-24 items-center gap-3 bg-card px-4 py-3 transition-[background-color,transform,scale] duration-150 ease-out hover:bg-muted/50 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    quoteFlashClass(quoteFlashes.get(quote.symbol)),
                  )}
                  aria-label={`View ${displayName}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-foreground">
                      {displayName}
                    </div>
                    <div
                      className="truncate text-[10px] font-medium text-muted-foreground"
                      title={quote.symbol}
                    >
                      {quote.symbol}
                    </div>
                    <div className="mt-1 tabular-nums text-base font-semibold text-foreground">
                      {formatPrice(quote.price, quote.currency)}
                    </div>
                    <SignedPercent value={quote.changePercent} />
                  </div>
                  <MarketSparkline
                    symbol={quote.symbol}
                    assetType={quote.assetType}
                    className="shrink-0"
                  />
                </a>
              );
            })}
          </div>
        )}
      </Panel>
    </section>
  );
}

function SignedPercent({ value }) {
  if (!Number.isFinite(value)) return <span className="text-xs text-muted-foreground">—</span>;
  return (
    <div
      className={cn(
        "mt-0.5 tabular-nums text-xs font-medium",
        value > 0 ? "text-success" : value < 0 ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {formatPercent(value, { decimals: 2, signed: true })}
    </div>
  );
}
