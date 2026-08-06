import { lazy, Suspense, useMemo, useState } from "react";
import { Card } from "../../components/ui/card.jsx";
import { DetailRailLayout } from "../../components/ui/detail-rail-layout.jsx";
import { Skeleton } from "../../components/ui/skeleton.jsx";
import { DesktopSidebarRestore, MobileHeader } from "../layout/AppShellChrome.jsx";
import {
  Panel,
  quoteFlashClass,
  StatusBand,
  useQuoteChangeFlash,
} from "../market-state/shared.jsx";
import { descriptorHasSection } from "./asset-descriptor.js";
import { invokeSymbolMutation } from "./symbol-actions.js";
import {
  AboutCard,
  AlertsCard,
  AnalyzePanel,
  AvailabilityNote,
  KeyLevelsCard,
  KeyLevelsSkeleton,
  KeyStats,
  PositionCard,
  SymbolHero,
  TrendCard,
  TrendSkeleton,
  WatchlistMembership,
} from "./symbol-sections.jsx";
import { historyBasisNote } from "./symbol-view-model.js";
import { useSymbolData } from "./use-symbol-data.js";

const LazyMarketChart = lazy(() =>
  import("../../components/market-chart.jsx").then((m) => ({ default: m.MarketChart })),
);

const INVALID_SYMBOL_REASON =
  /(?:unknown|invalid) symbol|symbol (?:was )?not found|no company fundamentals returned/i;

export default function SymbolPage({
  ticker,
  fillComposer,
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
      fillComposer={fillComposer}
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
  fillComposer,
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

  const descriptor = data.descriptor;
  // Left unknown rather than assumed: the derived levels are computed from
  // history that survives a failed quote, and a foreign listing's levels must
  // not be printed as dollars just because the quote did not arrive.
  const currency = data.quote?.currency ?? null;
  // The chart reloads its series whenever this array's identity changes, which
  // also refits the time scale and throws away any pan or zoom the reader has
  // applied. The page itself re-renders on every quote poll, so the series has
  // to survive those renders.
  const chartSeries = useMemo(
    () => [{ symbol: data.symbol || ticker, bars: data.history?.bars ?? [] }],
    [data.symbol, ticker, data.history?.bars],
  );
  const has = (section) => descriptorHasSection(descriptor, section);
  const levelsLoading = data.viewModelLoading && (data.viewModel?.keyLevels ?? []).length === 0;
  // Every derived figure on the page comes from one daily series. When that
  // series is a retained copy, each card that prints its numbers says so
  // rather than letting them read as current market context.
  const basisNote = historyBasisNote(data.viewModel);

  // The rail is a desktop region; below its breakpoint the same cards join the
  // single column in reading order. `DetailRailLayout` hides its rail slot at
  // narrow widths, so the stacked copies are rendered here and hidden again
  // once the rail takes over. Only one copy is ever displayed, so assistive
  // technology sees each card once.
  const keyLevels = has("keyLevels") ? (
    levelsLoading ? (
      <KeyLevelsSkeleton key="key-levels" />
    ) : (
      <KeyLevelsCard
        key="key-levels"
        ticker={ticker}
        levels={data.viewModel?.keyLevels}
        currency={currency}
        role={role}
        basisNote={basisNote}
      />
    )
  ) : null;
  const trend = has("trend") ? (
    (data.viewModel?.trend?.rows ?? []).length === 0 && data.viewModelLoading ? (
      <TrendSkeleton key="trend" />
    ) : (
      <TrendCard key="trend" trend={data.viewModel?.trend} basisNote={basisNote} />
    )
  ) : null;
  const position = has("position") ? (
    <PositionCard key="position" ticker={ticker} positionRows={data.positionRows} />
  ) : null;
  const alerts = has("alerts") ? (
    <AlertsCard
      key="alerts"
      ticker={ticker}
      alertRows={data.alertRows}
      role={role}
      createAlertHref={createAlertHref}
    />
  ) : null;
  const membership = has("watchlist") ? (
    <WatchlistMembership
      key="watchlist"
      ticker={ticker}
      memberships={data.memberships}
      role={role}
      onAdd={onAddToWatchlist}
    />
  ) : null;
  const analyze = has("analyze") ? (
    <AnalyzePanel key="analyze" ticker={ticker} role={role} fillComposer={fillComposer} />
  ) : null;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <MobileHeader onOpenSidebar={onOpenSidebar} onOpenHome={onOpenHome} />
      {sidebarCollapsed ? <DesktopSidebarRestore onExpandSidebar={onExpandSidebar} /> : null}
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1240px] min-w-0 flex-col gap-3">
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
              {/* Above the layout: a failure the reader needs before they start
                  reading numbers, not after every card. */}
              {data.error ? <StatusBand tone="error">{data.error}</StatusBand> : null}
              <DetailRailLayout
                // React Doctor's `jsx-no-jsx-as-prop` fires on this slot. It is
                // accepted here for the same reason the watchlist accepts it:
                // the layout is a plain component, and every card in the rail
                // re-renders with the quote poll that re-renders this page.
                rail={
                  keyLevels || trend || position || alerts || membership || analyze ? (
                    <div className="flex min-w-0 flex-col gap-3">
                      {keyLevels}
                      {trend}
                      {position}
                      {alerts}
                      {membership}
                      {analyze}
                    </div>
                  ) : null
                }
              >
                <div className="flex min-w-0 flex-col gap-3">
                  <SymbolHero
                    ticker={ticker}
                    quote={data.quote}
                    overview={data.overview}
                    descriptor={descriptor}
                    viewModel={data.viewModel}
                    basisNote={basisNote}
                    flashClass={flashClass}
                    quoteLoading={data.quoteLoading}
                    statsLoading={data.viewModelLoading && !data.viewModel?.hasDailyHistory}
                  />

                  <fieldset aria-label="Price chart" className="m-0 min-w-0 border-0 p-0">
                    <Panel title="Price chart">
                      <div className="min-w-0">
                        {data.historyLoading && !data.history ? (
                          <ChartSkeleton />
                        ) : (
                          <Suspense fallback={<ChartSkeleton />}>
                            <ChartComponent
                              series={chartSeries}
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

                  <div
                    data-slot="symbol-stacked-rail"
                    className="xl:hidden flex min-w-0 flex-col gap-3 empty:hidden"
                  >
                    {position}
                    {keyLevels}
                  </div>

                  {has("keyStats") ? (
                    data.overviewLoading && !data.overview ? (
                      <StatsSkeleton />
                    ) : data.overview?.status === "ok" ? (
                      <KeyStats overview={data.overview} currency={currency} />
                    ) : (
                      // A section the descriptor declares but the data cannot
                      // fill says so, instead of leaving a gap between the
                      // chart and whatever comes next.
                      <AvailabilityNote
                        note={`Company fundamentals are not available for ${ticker} right now.`}
                      />
                    )
                  ) : (
                    <AvailabilityNote note={descriptor?.availabilityNote} />
                  )}

                  {has("about") ? <AboutCard overview={data.overview} /> : null}

                  <div
                    data-slot="symbol-stacked-rail"
                    className="xl:hidden flex min-w-0 flex-col gap-3 empty:hidden"
                  >
                    {trend}
                    {alerts}
                    {membership}
                    {analyze}
                  </div>
                </div>
              </DetailRailLayout>

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

function isInvalidSymbolReason(reason) {
  return INVALID_SYMBOL_REASON.test(String(reason ?? ""));
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
