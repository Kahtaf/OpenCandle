import { lazy, Suspense, useMemo, useState } from "react";
import { Card } from "../../components/ui/card.jsx";
import { Skeleton } from "../../components/ui/skeleton.jsx";
import { DesktopSidebarRestore, MobileHeader } from "../layout/AppShellChrome.jsx";
import {
  Panel,
  quoteFlashClass,
  StatusBand,
  useQuoteChangeFlash,
} from "../market-state/shared.jsx";
import { invokeSymbolMutation } from "./symbol-actions.js";
import {
  AlertsCard,
  AnalyzePanel,
  KeyStats,
  LimitedStatsNotice,
  PositionCard,
  SymbolHeader,
  WatchlistMembership,
} from "./symbol-sections.jsx";
import { useSymbolData } from "./use-symbol-data.js";

const LazyMarketChart = lazy(() =>
  import("../../components/market-chart.jsx").then((m) => ({ default: m.MarketChart })),
);

export default function SymbolPage({
  ticker,
  startChatRun,
  invokeTool,
  role,
  setToast,
  onOpenSidebar,
  onOpenHome,
  sidebarCollapsed = false,
  onExpandSidebar,
}) {
  const [range, setRange] = useState("1M");
  const data = useSymbolData(ticker, range);
  const quoteMap = useMemo(
    () => new Map(data.quote ? [[data.symbol, data.quote]] : []),
    [data.quote, data.symbol],
  );
  const quoteFlashes = useQuoteChangeFlash(quoteMap);

  const mutate = (toolName, args) =>
    invokeSymbolMutation({
      role,
      toolName,
      args,
      invokeTool,
      setToast,
      refresh: data.refresh,
      refreshQuotes: data.refreshQuotes,
    });

  return (
    <SymbolPageView
      ticker={ticker}
      data={data}
      range={range}
      onRangeChange={setRange}
      role={role}
      startChatRun={startChatRun}
      onAddToWatchlist={() => mutate("manage_watchlist", { action: "add", symbol: data.symbol })}
      createAlertHref={
        data.quote?.status === "ok"
          ? `/alerts?alertSymbol=${encodeURIComponent(data.symbol)}`
          : null
      }
      flashClass={quoteFlashClass(quoteFlashes.get(data.symbol))}
      onOpenSidebar={onOpenSidebar}
      onOpenHome={onOpenHome}
      sidebarCollapsed={sidebarCollapsed}
      onExpandSidebar={onExpandSidebar}
    />
  );
}

export function SymbolPageView({
  ticker,
  data,
  range,
  onRangeChange,
  role = "writer",
  startChatRun,
  onAddToWatchlist,
  createAlertHref,
  flashClass,
  onOpenSidebar,
  onOpenHome,
  sidebarCollapsed = false,
  onExpandSidebar,
  ChartComponent = LazyMarketChart,
}) {
  const quoteUnavailable = data.quote?.status === "unavailable";
  const overviewUnavailable = data.overview?.status === "unavailable";
  const notFound =
    quoteUnavailable &&
    overviewUnavailable &&
    isInvalidSymbolReason(data.quote.reason) &&
    isInvalidSymbolReason(data.overview.reason);
  const showEquitySections = !isNonEquitySymbol(ticker) && data.overview?.status === "ok";

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <MobileHeader onOpenSidebar={onOpenSidebar} onOpenHome={onOpenHome} />
      {sidebarCollapsed ? <DesktopSidebarRestore onExpandSidebar={onExpandSidebar} /> : null}
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1120px] min-w-0 flex-col gap-3">
          {notFound ? (
            <Panel title={`${ticker} was not found`} headingLevel="h1" headingClassName="text-xl">
              <div className="p-6 text-center">
                <p className="mt-2 text-sm text-muted-foreground">
                  Check the ticker and try another symbol.
                </p>
              </div>
            </Panel>
          ) : (
            <>
              {data.quoteLoading && !data.quote ? (
                <HeaderSkeleton ticker={ticker} />
              ) : (
                <SymbolHeader
                  ticker={ticker}
                  quote={data.quote}
                  overview={data.overview}
                  flashClass={flashClass}
                />
              )}

              <fieldset aria-label="Price chart" className="m-0 min-w-0 border-0 p-0">
                <Panel title="Price chart">
                  <div className="min-w-0">
                    {data.historyLoading && !data.history ? (
                      <ChartSkeleton />
                    ) : (
                      <Suspense fallback={<ChartSkeleton />}>
                        <ChartComponent
                          series={[
                            { symbol: data.symbol || ticker, bars: data.history?.bars ?? [] },
                          ]}
                          mode="area"
                          prevClose={data.quote?.previousClose}
                          range={range}
                          onRangeChange={onRangeChange}
                          showVolume
                          height={420}
                        />
                      </Suspense>
                    )}
                  </div>
                </Panel>
              </fieldset>

              {isNonEquitySymbol(ticker) ? <LimitedStatsNotice ticker={ticker} /> : null}

              {showEquitySections ? (
                <>
                  {data.overviewLoading && !data.overview ? (
                    <StatsSkeleton />
                  ) : (
                    <KeyStats overview={data.overview} currency={data.quote?.currency ?? "USD"} />
                  )}
                  <PositionCard ticker={ticker} positionRows={data.positionRows} />
                  <AlertsCard
                    ticker={ticker}
                    alertRows={data.alertRows}
                    role={role}
                    createAlertHref={createAlertHref}
                  />
                  <WatchlistMembership
                    ticker={ticker}
                    memberships={data.memberships}
                    role={role}
                    onAdd={onAddToWatchlist}
                  />
                  <AnalyzePanel ticker={ticker} role={role} startChatRun={startChatRun} />
                </>
              ) : data.overviewLoading && !isNonEquitySymbol(ticker) ? (
                <StatsSkeleton />
              ) : null}

              {data.error ? <StatusBand tone="error">{data.error}</StatusBand> : null}
              {role !== "writer" ? (
                <StatusBand>
                  Viewing read-only. Actions are available in the writer window.
                </StatusBand>
              ) : null}
            </>
          )}
        </div>
      </main>
    </section>
  );
}

export function isNonEquitySymbol(ticker) {
  const symbol = ticker.trim().toUpperCase();
  return symbol.startsWith("^") || symbol.endsWith("-USD");
}

function isInvalidSymbolReason(reason) {
  return /(?:unknown|invalid) symbol|symbol (?:was )?not found|no company fundamentals returned/i.test(
    String(reason ?? ""),
  );
}

function HeaderSkeleton({ ticker }) {
  return (
    <Card
      data-slot="symbol-header-skeleton"
      role="status"
      aria-label="Loading symbol quote"
      className="rounded-xl p-5"
    >
      <h1 className="sr-only">Loading {ticker}</h1>
      <Skeleton className="h-7 w-64" />
      <Skeleton className="mt-5 h-12 w-80 max-w-full" />
    </Card>
  );
}

function ChartSkeleton() {
  return (
    <Skeleton
      data-slot="symbol-chart-skeleton"
      aria-label="Loading price chart"
      className="h-[420px] rounded-none"
    />
  );
}

function StatsSkeleton() {
  return (
    <Card
      data-slot="symbol-stats-skeleton"
      role="status"
      aria-label="Loading key stats"
      className="rounded-xl p-4"
    >
      <Skeleton className="h-5 w-24" />
      <Skeleton className="mt-4 h-36 w-full" />
    </Card>
  );
}
