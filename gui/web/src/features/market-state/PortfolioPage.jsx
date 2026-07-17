import { BriefcaseBusiness, ChevronRight, Plus } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { MarketSparkline } from "../../components/market-sparkline.jsx";
import { Button } from "../../components/ui/button.jsx";
import { SERIES_COLORS } from "../../lib/series-colors.js";
import { cn } from "../../lib/utils.js";
import { symbolPageHref } from "../../route-resolution.js";
import { degradedQuoteBadge, shortDateLabel } from "./format.js";
import { buildHoldingRows } from "./portfolio-view-model.js";
import {
  Badge,
  ConfirmButton,
  EmptyState,
  ExtendedHoursQuote,
  filterItems,
  money,
  moneyOrDash,
  Panel,
  PanelSearch,
  quoteFlashClass,
  SignedMoney,
  SignedPercent,
  StateTabs,
  Sym,
  useQuoteChangeFlash,
} from "./shared.jsx";

function usePortfolioPageState(state, filter) {
  const portfolios = useMemo(() => {
    const saved = state.portfolios ?? [];
    return saved.length > 0 ? saved : [{ id: "default", name: "Default", isDefault: true }];
  }, [state.portfolios]);
  const [activePortfolioId, setActivePortfolioId] = useState(portfolios[0]?.id);
  useEffect(() => {
    if (!portfolios.some((portfolio) => portfolio.id === activePortfolioId)) {
      setActivePortfolioId(portfolios[0]?.id);
    }
  }, [activePortfolioId, portfolios]);
  const activePortfolio =
    portfolios.find((portfolio) => portfolio.id === activePortfolioId) ?? portfolios[0];
  const activeLots = useMemo(
    () =>
      (state.portfolio ?? []).filter((lot) =>
        activePortfolio?.id === "default"
          ? lot.portfolioId == null
          : lot.portfolioId === activePortfolio?.id,
      ),
    [activePortfolio?.id, state.portfolio],
  );
  const holdings = useMemo(
    () => buildHoldingRows(activeLots, state.quoteSnapshot?.portfolioQuotes ?? []),
    [activeLots, state.quoteSnapshot],
  );
  const rows = useMemo(
    () => filterItems(holdings, filter, ["symbol", "name", "currency"]),
    [holdings, filter],
  );
  const quotesBySymbol = useMemo(
    () =>
      new Map((state.quoteSnapshot?.portfolioQuotes ?? []).map((quote) => [quote.symbol, quote])),
    [state.quoteSnapshot],
  );
  const quoteFlashes = useQuoteChangeFlash(quotesBySymbol);
  const quoteBadge = useMemo(
    () =>
      degradedQuoteBadge(
        (state.quoteSnapshot?.portfolioQuotes ?? []).filter(
          (quote) => quote.portfolioId === activePortfolio?.id,
        ),
      ),
    [state.quoteSnapshot, activePortfolio?.id],
  );
  const summary =
    state.quoteSnapshot?.portfolioSummaries?.find(
      (candidate) => candidate.portfolioId === activePortfolio?.id,
    ) ?? (activePortfolio?.isDefault ? state.quoteSnapshot?.portfolioSummary : null);
  const [expanded, setExpanded] = useState(() => new Set());
  const toggleExpanded = (symbol) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };
  const portfolioCounts = useMemo(
    () => countLotsByPortfolio(state.portfolio ?? []),
    [state.portfolio],
  );

  return {
    portfolios,
    setActivePortfolioId,
    activePortfolio,
    activeLots,
    holdings,
    rows,
    quoteFlashes,
    quoteBadge,
    summary,
    expanded,
    toggleExpanded,
    portfolioCounts,
  };
}

export function PortfolioPage({
  state,
  loading = false,
  filter,
  setFilter,
  readOnly,
  openPanel,
  invokeTool,
  navigate,
  renderPageHeader,
}) {
  const {
    portfolios,
    setActivePortfolioId,
    activePortfolio,
    activeLots,
    holdings,
    rows,
    quoteFlashes,
    quoteBadge,
    summary,
    expanded,
    toggleExpanded,
    portfolioCounts,
  } = usePortfolioPageState(state, filter);
  const lotCount = activeLots.length;
  const addHolding = () => openPanel("holding-add", { portfolio: activePortfolio });

  return (
    <div className="flex flex-col gap-3">
      {renderPageHeader?.(
        <StateTabs
          items={portfolios}
          activeItem={activePortfolio}
          counts={portfolioCounts}
          readOnly={readOnly}
          renameLabel="Rename portfolio"
          onSelect={setActivePortfolioId}
          onRename={(portfolio) => openPanel("portfolio-rename", { portfolio })}
        />,
      )}
      <Panel
        actions={
          <Button
            type="button"
            variant="bordered"
            size="sm"
            prefixIcon={Plus}
            disabled={readOnly}
            onClick={addHolding}
          >
            Add holding
          </Button>
        }
      >
        {loading ? <PortfolioSkeleton /> : null}
        {!loading && lotCount === 0 ? (
          <EmptyState
            icon={BriefcaseBusiness}
            title="No holdings yet"
            action="Add a holding when you are ready, or keep using watchlists without a portfolio."
          />
        ) : null}
      </Panel>

      {!loading && lotCount > 0 ? (
        <ValueHeader summary={summary} holdings={holdings} quoteBadge={quoteBadge} />
      ) : null}
      {!loading && lotCount > 0 ? (
        <Panel
          title="Holdings"
          meta={`${holdings.length} ${holdings.length === 1 ? "symbol" : "symbols"} · ${lotCount} ${lotCount === 1 ? "lot" : "lots"}`}
          actions={<PanelSearch label="Search holdings" filter={filter} setFilter={setFilter} />}
        >
          {rows.length === 0 ? (
            <EmptyState
              icon={BriefcaseBusiness}
              title="No holdings match this search"
              action="Clear the search to see all holdings."
              cta={{ label: "Clear search", onClick: () => setFilter("") }}
            />
          ) : (
            <>
              <MobileHoldingRows
                rows={rows}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
                activePortfolio={activePortfolio}
                readOnly={readOnly}
                openPanel={openPanel}
                invokeTool={invokeTool}
                navigate={navigate}
              />
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th className="w-8 px-2 py-2" aria-label="Expand" />
                      <th className="px-2 py-2 font-medium">Symbol</th>
                      <th className="px-2 py-2 text-right font-medium">Price</th>
                      <th className="px-2 py-2 text-right font-medium">Value</th>
                      <th className="px-2 py-2 font-medium">24 hr sparkline</th>
                      <th className="px-2 py-2 text-right font-medium">Change</th>
                      <th className="px-2 py-2 text-right font-medium">Total Gain/Loss</th>
                      <th className="px-2 py-2 text-right font-medium">% of Portfolio</th>
                      <th className="px-2 py-2 text-right font-medium">Quantity</th>
                      <th className="px-2 py-2 pr-4 text-right font-medium">Avg. Cost Basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <Fragment key={row.symbol}>
                        <tr
                          className={cn(
                            "cursor-pointer border-b border-border/70 last:border-0 hover:bg-secondary/60",
                            quoteFlashClass(quoteFlashes.get(row.symbol)),
                          )}
                          onClick={() => toggleExpanded(row.symbol)}
                        >
                          <td className="px-2 py-2.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              className="size-10 md:size-8"
                              aria-expanded={expanded.has(row.symbol)}
                              aria-label={`${expanded.has(row.symbol) ? "Collapse" : "Expand"} ${row.symbol} lots`}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleExpanded(row.symbol);
                              }}
                            >
                              <ChevronRight
                                className={`size-3.5 transition-transform duration-150 ease-out ${
                                  expanded.has(row.symbol) ? "rotate-90" : "rotate-0"
                                }`}
                              />
                            </Button>
                          </td>
                          <td className="px-2 py-2.5">
                            <SymbolPageLink
                              symbol={row.symbol}
                              name={row.name}
                              navigate={navigate}
                            />
                          </td>
                          <td className="px-2 py-2.5 text-right tabular-nums">
                            <div className="flex flex-col items-end">
                              <span>{moneyOrDash(row.currentPrice, row.currency)}</span>
                              <ExtendedHoursQuote quote={row} currency={row.currency} />
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-right tabular-nums">
                            {moneyOrDash(row.marketValue, row.currency)}
                          </td>
                          <td className="px-2 py-1.5">
                            <MarketSparkline symbol={row.symbol} sparkline={row.sparkline} />
                          </td>
                          <td className="px-2 py-2.5 text-right">
                            <SignedPercent value={row.changePercent} />
                          </td>
                          <td className="px-2 py-2.5 text-right">
                            <SignedMoney
                              value={row.pnl}
                              percent={row.pnlPercent}
                              currency={row.currency}
                            />
                          </td>
                          <td className="px-2 py-2.5 text-right tabular-nums">
                            {typeof row.allocationPercent === "number"
                              ? `${row.allocationPercent.toFixed(1)}%`
                              : "—"}
                          </td>
                          <td className="px-2 py-2.5 text-right tabular-nums">
                            {row.totalQuantity.toLocaleString()}
                          </td>
                          <td
                            data-slot="avg-cost-basis"
                            className="px-2 py-2.5 pr-4 text-right tabular-nums"
                          >
                            {moneyOrDash(row.blendedCost, row.currency)}
                          </td>
                        </tr>
                        <tr inert={!expanded.has(row.symbol)}>
                          <td colSpan={10} className="p-0">
                            <div
                              data-slot="portfolio-lot-reveal"
                              className={`grid transition-[grid-template-rows] duration-150 ease-out ${
                                expanded.has(row.symbol) ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                              }`}
                            >
                              <div className="min-h-0 overflow-hidden">
                                {row.lots.map((lot) => (
                                  <div
                                    key={lot.id}
                                    className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-x-2 border-b border-border/70 bg-secondary/60 px-2 py-2 text-[13px] md:grid-cols-[2rem_minmax(0,1fr)_5rem_7rem_7rem_4rem_9rem_auto]"
                                  >
                                    <div />
                                    <div>
                                      <div className="font-mono text-xs text-muted-foreground">
                                        Lot · {shortDateLabel(lot.openedAt) || "—"}
                                        {lot.notes ? ` · ${lot.notes}` : ""}
                                      </div>
                                      <div className="mt-0.5 font-mono text-xs text-muted-foreground md:hidden">
                                        {lot.quantity.toLocaleString()} @{" "}
                                        {money(lot.avgCost, lot.currency)}
                                      </div>
                                      <div className="mt-1 flex gap-1 md:hidden">
                                        <LotActions
                                          lot={lot}
                                          portfolio={activePortfolio}
                                          readOnly={readOnly || !expanded.has(row.symbol)}
                                          openPanel={openPanel}
                                          invokeTool={invokeTool}
                                        />
                                      </div>
                                    </div>
                                    <div className="hidden text-right tabular-nums md:block">
                                      {lot.quantity.toLocaleString()}
                                    </div>
                                    <div className="hidden text-right font-mono text-xs text-muted-foreground md:block">
                                      cost {money(lot.avgCost, lot.currency)}
                                    </div>
                                    <div className="text-right tabular-nums">
                                      {moneyOrDash(lot.quote?.marketValue, lot.currency)}
                                    </div>
                                    <div className="hidden md:block" />
                                    <div className="hidden text-right sm:block">
                                      {lot.quote?.status === "ok" ? (
                                        <SignedMoney
                                          value={lot.quote.pnl}
                                          percent={lot.quote.pnlPercent}
                                          currency={lot.currency}
                                        />
                                      ) : (
                                        <span className="text-xs text-muted-foreground">
                                          {lot.quote?.reason ?? "Awaiting quote"}
                                        </span>
                                      )}
                                    </div>
                                    <div className="hidden justify-end gap-1 md:flex">
                                      <LotActions
                                        lot={lot}
                                        portfolio={activePortfolio}
                                        readOnly={readOnly || !expanded.has(row.symbol)}
                                        openPanel={openPanel}
                                        invokeTool={invokeTool}
                                      />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {summary?.excludedFromTotals?.length ? (
            <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
              Excluded from totals:{" "}
              {summary.excludedFromTotals.map((row) => `${row.symbol} (${row.reason})`).join(", ")}
            </p>
          ) : null}
        </Panel>
      ) : null}
    </div>
  );
}

function MobileHoldingRows({
  rows,
  expanded,
  toggleExpanded,
  activePortfolio,
  readOnly,
  openPanel,
  invokeTool,
  navigate,
}) {
  return (
    <div className="divide-y divide-border sm:hidden">
      {rows.map((row) => {
        const isExpanded = expanded.has(row.symbol);
        return (
          <div key={row.symbol} data-slot="mobile-portfolio-holding">
            <div className="grid min-h-[58px] w-full grid-cols-[1rem_minmax(0,1fr)_6rem_5.25rem] items-center gap-2 px-3 py-2 text-left transition-[background-color] duration-150 ease-out hover:bg-secondary/60">
              <button
                type="button"
                className="-m-3 flex size-10 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? "Collapse" : "Expand"} ${row.symbol} lots`}
                onClick={() => toggleExpanded(row.symbol)}
              >
                <ChevronRight
                  className={`size-3.5 text-muted-foreground transition-transform duration-150 ease-out ${
                    isExpanded ? "rotate-90" : "rotate-0"
                  }`}
                  aria-hidden="true"
                />
              </button>
              <SymbolPageLink symbol={row.symbol} name={row.name} navigate={navigate} />
              <MarketSparkline symbol={row.symbol} sparkline={row.sparkline} />
              <span className="flex flex-col items-end gap-0.5 tabular-nums">
                <span>{moneyOrDash(row.currentPrice, row.currency)}</span>
                <SignedPercent value={row.changePercent} />
              </span>
            </div>
            <div
              inert={!isExpanded}
              className={`grid transition-[grid-template-rows] duration-150 ease-out ${
                isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-border bg-secondary/40 px-4 py-3 text-xs">
                  <MobileMetric label="Value" value={moneyOrDash(row.marketValue, row.currency)} />
                  <MobileMetric
                    label="Total Gain/Loss"
                    value={
                      <SignedMoney
                        value={row.pnl}
                        percent={row.pnlPercent}
                        currency={row.currency}
                      />
                    }
                  />
                  <MobileMetric
                    label="% of Portfolio"
                    value={
                      typeof row.allocationPercent === "number"
                        ? `${row.allocationPercent.toFixed(1)}%`
                        : "—"
                    }
                  />
                  <MobileMetric label="Quantity" value={row.totalQuantity.toLocaleString()} />
                  <MobileMetric
                    label="Avg. Cost Basis"
                    value={moneyOrDash(row.blendedCost, row.currency)}
                  />
                </dl>
                <div className="divide-y divide-border/70 border-t border-border bg-secondary/60">
                  {row.lots.map((lot) => (
                    <div key={lot.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 text-xs text-muted-foreground">
                        <div className="font-mono">Lot · {shortDateLabel(lot.openedAt) || "—"}</div>
                        <div className="mt-1 tabular-nums">
                          {lot.quantity.toLocaleString()} @ {money(lot.avgCost, lot.currency)}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className="text-xs tabular-nums">
                          {moneyOrDash(lot.quote?.marketValue, lot.currency)}
                        </span>
                        <div className="flex gap-1">
                          <LotActions
                            lot={lot}
                            portfolio={activePortfolio}
                            readOnly={readOnly || !isExpanded}
                            openPanel={openPanel}
                            invokeTool={invokeTool}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SymbolPageLink({ symbol, name, navigate }) {
  const href = symbolPageHref(symbol);
  return (
    <a
      href={href}
      className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      onClick={(event) => {
        event.stopPropagation();
        if (!navigate) return;
        event.preventDefault();
        void navigate({ to: href });
      }}
    >
      <Sym symbol={symbol} name={name} />
    </a>
  );
}

function MobileMetric({ label, value }) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function PortfolioSkeleton() {
  return (
    <div
      data-slot="portfolio-skeleton"
      role="status"
      aria-label="Loading portfolio"
      className="p-4"
    >
      <div className="space-y-3">
        {["first", "second", "third", "fourth"].map((key) => (
          <div key={key} className="flex items-center justify-between gap-4">
            <div className="h-8 w-28 animate-pulse rounded bg-secondary" />
            <div className="h-4 w-20 animate-pulse rounded bg-secondary" />
            <div className="h-4 w-16 animate-pulse rounded bg-secondary" />
          </div>
        ))}
      </div>
    </div>
  );
}

function countLotsByPortfolio(lots) {
  const counts = new Map();
  for (const lot of lots ?? []) {
    counts.set(lot.portfolioId, (counts.get(lot.portfolioId) ?? 0) + 1);
  }
  return counts;
}

function LotActions({ lot, portfolio, readOnly, openPanel, invokeTool }) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={readOnly}
        onClick={() => openPanel("holding-edit", { lot, portfolio })}
      >
        Edit
      </Button>
      <ConfirmButton
        label="Remove"
        confirmLabel="Remove lot?"
        disabled={readOnly}
        onConfirm={() => invokeTool("track_portfolio", { action: "remove", lot_id: lot.id })}
      />
    </>
  );
}

function ValueHeader({ summary, holdings, quoteBadge }) {
  const todayPnl = useMemo(() => {
    let total = 0;
    let any = false;
    for (const row of holdings) {
      if (typeof row.changePercent === "number" && typeof row.marketValue === "number") {
        const previous = row.marketValue / (1 + row.changePercent / 100);
        total += row.marketValue - previous;
        any = true;
      }
    }
    return any ? total : null;
  }, [holdings]);

  const segments = holdings
    .filter((row) => typeof row.allocationPercent === "number" && row.allocationPercent > 0)
    .map((row, index) => ({
      symbol: row.symbol,
      percent: row.allocationPercent,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
    }));

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-subtle-xs sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-[32px] font-semibold leading-tight tabular-nums text-foreground">
          {summary ? money(summary.totalValue, summary.baseCurrency) : "—"}
        </div>
        {quoteBadge ? <Badge tone="warn">{quoteBadge}</Badge> : null}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[13px]">
        {todayPnl != null && summary ? (
          <>
            <SignedMoney
              value={todayPnl}
              percent={
                summary.totalValue - todayPnl > 0
                  ? (todayPnl / (summary.totalValue - todayPnl)) * 100
                  : null
              }
              currency={summary.baseCurrency}
            />
            <span className="text-muted-foreground">today ·</span>
          </>
        ) : null}
        {summary ? (
          <SignedMoney
            value={summary.totalPnl}
            percent={summary.totalPnlPercent}
            currency={summary.baseCurrency}
          />
        ) : (
          <span className="text-muted-foreground">Totals appear once quotes load.</span>
        )}
        {summary ? <span className="text-muted-foreground">all time</span> : null}
      </div>
      {segments.length > 0 ? (
        <>
          <div
            data-slot="portfolio-allocation"
            className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full"
            aria-hidden="true"
          >
            {segments.map((segment) => (
              <div
                key={segment.symbol}
                className="rounded-sm"
                style={{ width: `${segment.percent}%`, backgroundColor: segment.color }}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {segments.map((segment) => (
              <span key={segment.symbol} className="inline-flex items-center gap-1.5">
                <i
                  className="size-2 rounded-sm"
                  style={{ backgroundColor: segment.color }}
                  aria-hidden="true"
                />
                {segment.symbol} {segment.percent.toFixed(1)}%
              </span>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
