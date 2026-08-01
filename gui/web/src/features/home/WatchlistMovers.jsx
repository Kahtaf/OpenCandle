import { useMemo } from "react";
import { MarketSparkline } from "../../components/market-sparkline.jsx";
import { Skeleton } from "../../components/ui/skeleton.jsx";
import { cn } from "../../lib/utils.js";
import { symbolPageHref } from "../../route-resolution.js";
import { degradedQuoteBadge, quoteFreshnessTitle } from "../market-state/format.js";
import {
  Badge,
  money,
  Panel,
  quoteFlashClass,
  useQuoteChangeFlash,
} from "../market-state/shared.jsx";
import { DeltaChip } from "../renderers/cards/_shared.jsx";
import { orderWatchlistMovers } from "./home-view-model.js";

const HEADING_ID = "home-movers-heading";
const EMPTY_ITEMS = [];
const EMPTY_QUOTES = [];
const SKELETON_KEYS = ["first", "second", "third", "fourth", "fifth"];

export function WatchlistMovers({
  watchlistItems = EMPTY_ITEMS,
  quoteSnapshot,
  nowMs = Date.now(),
  timeZone,
}) {
  const quotes = quoteSnapshot?.watchlistQuotes ?? EMPTY_QUOTES;
  const movers = useMemo(() => orderWatchlistMovers(quotes).slice(0, 5), [quotes]);
  const quotesBySymbol = useMemo(
    () => new Map(quotes.map((quote) => [quote.symbol, quote])),
    [quotes],
  );
  const quoteFlashes = useQuoteChangeFlash(quotesBySymbol);
  const loading = watchlistItems.length > 0 && quoteSnapshot == null;
  const freshness = quoteSnapshot ? degradedQuoteBadge(quotes, nowMs) : null;
  const freshnessTitle = quoteFreshnessTitle(quotes, timeZone);
  const actions =
    quotes.length > 5 ? (
      <a
        href="/watchlists"
        className="inline-flex min-h-10 items-center rounded-md px-2 text-xs font-medium text-muted-foreground transition-[color,transform,scale] duration-150 ease-out hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        View all
      </a>
    ) : null;

  return (
    <section aria-labelledby={HEADING_ID} data-slot="home-watchlist-movers">
      <Panel
        title={<span id={HEADING_ID}>Watchlist movers</span>}
        meta={
          freshness ? (
            <Badge tone="warn" title={freshnessTitle}>
              {freshness}
            </Badge>
          ) : null
        }
        actions={actions}
      >
        {loading ? (
          <MoverSkeleton />
        ) : movers.length > 0 ? (
          <div>
            {movers.map((quote) => (
              <a
                key={quote.symbol}
                href={symbolPageHref(quote.symbol)}
                className={cn(
                  "grid min-h-14 grid-cols-[minmax(4rem,1fr)_auto_auto_auto] items-center gap-3 border-b border-border/70 px-4 py-2 last:border-0 transition-[background-color,transform,scale] duration-150 ease-out hover:bg-muted/50 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  quoteFlashClass(quoteFlashes.get(quote.symbol)),
                )}
                aria-label={`View ${quote.symbol}`}
              >
                <span className="truncate text-[13px] font-semibold text-foreground">
                  {quote.symbol}
                </span>
                <MarketSparkline
                  symbol={quote.symbol}
                  assetType={quote.assetType}
                  className="hidden sm:block"
                />
                <span className="tabular-nums text-sm font-medium text-foreground">
                  {money(quote.price, quote.currency || "USD")}
                </span>
                <DeltaChip percent={quote.changePercent} prefix="" size="md" />
              </a>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[168px] items-center px-4 py-6 text-sm text-muted-foreground">
            No watchlist symbols yet.
          </div>
        )}
      </Panel>
    </section>
  );
}

function MoverSkeleton() {
  return (
    <div className="min-h-[280px]" data-slot="home-movers-skeleton">
      {SKELETON_KEYS.map((key) => (
        <div key={key} className="grid min-h-14 grid-cols-[1fr_6rem_4rem] items-center gap-3 px-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-5 w-14" />
        </div>
      ))}
    </div>
  );
}
