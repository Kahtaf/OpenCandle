import { BookOpen } from "lucide-react";
import { PromptSuggestions } from "../../components/chat/prompt-suggestions.jsx";
import { Card } from "../../components/ui/card.jsx";
import { Kbd } from "../../components/ui/kbd.jsx";
import { Skeleton } from "../../components/ui/skeleton.jsx";
import { useMarketIndices } from "../../hooks/useMarketIndices.jsx";
import { AlertsCard } from "./AlertsCard.jsx";
import { IndicesStrip } from "./IndicesStrip.jsx";
import { MarketStateAffordanceCard } from "./MarketStateAffordanceCard.jsx";
import { PortfolioSummaryStrip } from "./PortfolioSummaryStrip.jsx";
import { WatchlistMovers } from "./WatchlistMovers.jsx";

const SAVED_STATE_SKELETON_KEYS = ["watchlist", "portfolio", "alerts"];
const EMPTY_MARKET_STATE = {};

export function HomeDashboard({
  prompts,
  onPrompt,
  onOpenCatalog,
  disabled = false,
  children,
  marketState = EMPTY_MARKET_STATE,
  marketStateLoading = false,
  indicesState: indicesStateProp,
}) {
  const liveIndicesState = useMarketIndices();
  const indicesState = indicesStateProp ?? liveIndicesState;
  const watchlistItems = marketState.watchlist ?? [];
  const portfolioLots = marketState.portfolio ?? [];
  const hasWatchlist = watchlistItems.length > 0;
  const hasPortfolio = portfolioLots.length > 0;
  const showIndices =
    indicesState.loading || (!indicesState.unavailable && (indicesState.quotes?.length ?? 0) > 0);

  return (
    <div
      className="mx-auto flex w-full max-w-[1040px] flex-col gap-8 px-2 py-4 sm:py-6"
      data-slot="home-dashboard"
    >
      <div className="mx-auto grid w-full max-w-[760px] justify-items-center gap-5 text-center">
        <div className="grid gap-2">
          <h1 className="m-0 text-balance text-3xl font-semibold leading-tight tracking-tight text-foreground">
            What are we watching?
          </h1>
          <p className="m-0 max-w-[520px] text-sm leading-relaxed text-muted-foreground">
            Ask for quotes, filings, macro data, options chains, or a full research workflow.
          </p>
        </div>
        <PromptSuggestions prompts={prompts} onPrompt={onPrompt} disabled={disabled} />
        {onOpenCatalog ? (
          <button
            type="button"
            onClick={() => onOpenCatalog()}
            className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground transition-[color,transform,scale] duration-150 ease-out hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <BookOpen aria-hidden="true" className="size-3.5" />
            Browse workflows and tools
            <Kbd className="hidden sm:inline-flex">⌘K / Ctrl+K</Kbd>
          </button>
        ) : null}
        <div className="w-full text-left" data-slot="home-composer">
          {children}
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2" data-slot="home-widget-grid">
        {showIndices ? (
          <div className="min-w-0 lg:col-span-2">
            <IndicesStrip {...indicesState} />
          </div>
        ) : null}
        {marketStateLoading ? (
          <SavedStateSkeletons />
        ) : (
          <>
            {hasWatchlist ? (
              <WatchlistMovers
                watchlistItems={watchlistItems}
                quoteSnapshot={marketState.quoteSnapshot}
              />
            ) : (
              <MarketStateAffordanceCard kind="watchlist" />
            )}
            {hasPortfolio ? (
              <PortfolioSummaryStrip
                portfolios={marketState.portfolios ?? []}
                quoteSnapshot={marketState.quoteSnapshot}
              />
            ) : (
              <MarketStateAffordanceCard kind="portfolio" />
            )}
            <div className="min-w-0 lg:col-span-2" data-slot="home-alerts-grid-cell">
              <AlertsCard
                alerts={marketState.alerts}
                alertEvents={marketState.alertEvents}
                notifications={marketState.notifications}
                instruments={marketState.instruments}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SavedStateSkeletons() {
  return (
    <>
      {SAVED_STATE_SKELETON_KEYS.map((key, index) => (
        <Card
          key={key}
          className={`min-h-[224px] rounded-xl p-4 shadow-subtle-xs ${
            index === SAVED_STATE_SKELETON_KEYS.length - 1 ? "lg:col-span-2" : ""
          }`}
          data-slot="home-saved-state-skeleton"
        >
          <Skeleton className="h-full min-h-48 w-full" />
        </Card>
      ))}
    </>
  );
}
