import { BriefcaseBusiness, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { AllocationDonut } from "../../components/allocation-donut.jsx";
import { MarketSparkline } from "../../components/market-sparkline.jsx";
import { Button } from "../../components/ui/button.jsx";
import { formatNumber, formatPercent } from "../../lib/financial-format.js";
import { cn } from "../../lib/utils.js";
import { symbolPageHref } from "../../route-resolution.js";
import { degradedQuoteBadge, shortDateLabel } from "./format.js";
import { buildHoldingRows, derivePortfolioDayMove } from "./portfolio-view-model.js";
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
      {!loading && lotCount > 0 ? (
        <ValueHeader summary={summary} holdings={holdings} quoteBadge={quoteBadge} />
      ) : null}
      <Panel
        title="Holdings"
        meta={
          lotCount > 0
            ? `${holdings.length} ${holdings.length === 1 ? "symbol" : "symbols"} · ${lotCount} ${lotCount === 1 ? "lot" : "lots"}`
            : undefined
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {lotCount > 0 ? (
              <PanelSearch label="Search holdings" filter={filter} setFilter={setFilter} />
            ) : null}
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
          </div>
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
        {!loading && lotCount > 0 ? (
          rows.length === 0 ? (
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
                <table className="w-full min-w-[920px] table-fixed border-collapse text-left text-sm">
                  <colgroup>
                    <col className="w-12" />
                    <col className="w-32" />
                    <col className="w-28" />
                    <col className="w-24" />
                    <col className="w-32" />
                    <col className="w-20" />
                    <col className="w-36" />
                    <col className="w-24" />
                    <col className="hidden w-20 2xl:table-column" />
                    <col className="hidden w-28 2xl:table-column" />
                    <col className="w-24" />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-border text-xs text-muted-foreground">
                      <th scope="col" className="px-2 py-2">
                        <span className="sr-only">Expand</span>
                      </th>
                      <th scope="col" className="px-2 py-2 font-medium">
                        Symbol
                      </th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">
                        Price
                      </th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">
                        Value
                      </th>
                      <th scope="col" className="px-2 py-2 font-medium">
                        24 hr sparkline
                      </th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">
                        Change
                      </th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">
                        Total Gain/Loss
                      </th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">
                        % of Portfolio
                      </th>
                      <th
                        scope="col"
                        className="hidden px-2 py-2 text-right font-medium 2xl:table-cell"
                      >
                        Quantity
                      </th>
                      <th
                        scope="col"
                        className="hidden px-2 py-2 text-right font-medium 2xl:table-cell"
                      >
                        Avg. Cost Basis
                      </th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <Fragment key={row.symbol}>
                        <tr
                          className={cn(
                            "border-b border-border/70 last:border-0 hover:bg-secondary/60",
                            quoteFlashClass(quoteFlashes.get(row.symbol)),
                          )}
                        >
                          <td className="px-2 py-2.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              className="size-10"
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
                              ? formatPercent(row.allocationPercent, { decimals: 1 })
                              : "—"}
                          </td>
                          <td className="hidden px-2 py-2.5 text-right tabular-nums 2xl:table-cell">
                            {formatNumber(row.totalQuantity)}
                          </td>
                          <td
                            data-slot="avg-cost-basis"
                            className="hidden px-2 py-2.5 text-right tabular-nums 2xl:table-cell"
                          >
                            {moneyOrDash(row.blendedCost, row.currency)}
                          </td>
                          <td aria-label={`${row.symbol} lot actions`} />
                        </tr>
                        {row.lots.map((lot) => (
                          <tr
                            key={lot.id}
                            data-slot="portfolio-lot-row"
                            className={cn(
                              "border-b border-border/70 bg-secondary/60 text-[13px]",
                              !expanded.has(row.symbol) && "hidden",
                            )}
                          >
                            <td />
                            <td className="px-2 py-2.5 text-xs text-muted-foreground">
                              <div>
                                Lot · {shortDateLabel(lot.openedAt) || "—"}
                                {lot.notes ? ` · ${lot.notes}` : ""}
                              </div>
                              <div className="mt-1 tabular-nums 2xl:hidden">
                                {formatNumber(lot.quantity)} @ {money(lot.avgCost, lot.currency)}
                              </div>
                            </td>
                            <td />
                            <td className="px-2 py-2.5 text-right tabular-nums">
                              {moneyOrDash(lot.quote?.marketValue, lot.currency)}
                            </td>
                            <td />
                            <td />
                            <td className="px-2 py-2.5 text-right">
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
                            </td>
                            <td />
                            <td className="hidden px-2 py-2.5 text-right tabular-nums 2xl:table-cell">
                              {formatNumber(lot.quantity)}
                            </td>
                            <td className="hidden px-2 py-2.5 text-right tabular-nums 2xl:table-cell">
                              {money(lot.avgCost, lot.currency)}
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="flex justify-end gap-1">
                                <LotActions
                                  lot={lot}
                                  portfolio={activePortfolio}
                                  readOnly={readOnly || !expanded.has(row.symbol)}
                                  openPanel={openPanel}
                                  invokeTool={invokeTool}
                                />
                              </div>
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        ) : null}
        {!loading && summary?.excludedFromTotals?.length ? (
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Excluded from totals:{" "}
            {summary.excludedFromTotals.map((row) => `${row.symbol} (${row.reason})`).join(", ")}
          </p>
        ) : null}
      </Panel>
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
                className="-m-3 flex size-10 items-center justify-center rounded-md transition-transform duration-150 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
                        ? formatPercent(row.allocationPercent, { decimals: 1 })
                        : "—"
                    }
                  />
                  <MobileMetric label="Quantity" value={formatNumber(row.totalQuantity)} />
                  <MobileMetric
                    label="Avg. Cost Basis"
                    value={moneyOrDash(row.blendedCost, row.currency)}
                  />
                </dl>
                <div className="divide-y divide-border/70 border-t border-border bg-secondary/60">
                  {row.lots.map((lot) => (
                    <div key={lot.id} className="flex items-start justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 text-xs text-muted-foreground">
                        <div>Lot · {shortDateLabel(lot.openedAt) || "—"}</div>
                        <div className="mt-1 tabular-nums">
                          {formatNumber(lot.quantity)} @ {money(lot.avgCost, lot.currency)}
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
      className="flex min-h-10 items-center rounded-sm transition-transform duration-150 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
        size="sm"
        icon={Pencil}
        aria-label={`Edit ${lot.symbol} lot`}
        className="min-h-10 min-w-10 px-2"
        disabled={readOnly}
        onClick={() => openPanel("holding-edit", { lot, portfolio })}
      />
      <ConfirmButton
        label="Remove lot"
        confirmLabel="Remove lot?"
        icon={Trash2}
        ariaLabel={`Remove ${lot.symbol} lot`}
        size="sm"
        className="min-h-10 min-w-10 px-2"
        disabled={readOnly}
        onConfirm={() => invokeTool("track_portfolio", { action: "remove", lot_id: lot.id })}
      />
    </>
  );
}

function ValueHeader({ summary, holdings, quoteBadge }) {
  const todayPnl = useMemo(() => derivePortfolioDayMove(holdings), [holdings]);

  const segments = holdings
    .filter((row) => typeof row.allocationPercent === "number" && row.allocationPercent > 0)
    .map((row) => ({
      symbol: row.symbol,
      percent: row.allocationPercent,
      value: row.marketValue,
    }));

  return (
    <Panel
      title="Portfolio value"
      meta={quoteBadge ? <Badge tone="warn">{quoteBadge}</Badge> : null}
    >
      <div className="p-4 sm:p-5">
        <div className="text-[32px] font-semibold leading-tight tabular-nums text-foreground">
          {summary ? money(summary.totalValue, summary.baseCurrency) : "—"}
        </div>
        <dl
          data-slot="portfolio-summary-deltas"
          className="mt-2 grid gap-2 text-[13px] sm:grid-cols-2"
        >
          {todayPnl != null && summary ? (
            <div className="flex min-w-0 items-baseline justify-between gap-3 rounded-lg bg-secondary px-3 py-2">
              <dt className="shrink-0 text-muted-foreground">Today</dt>
              <dd className="min-w-0 text-right">
                <SignedMoney
                  value={todayPnl}
                  percent={
                    summary.totalValue - todayPnl > 0
                      ? (todayPnl / (summary.totalValue - todayPnl)) * 100
                      : null
                  }
                  currency={summary.baseCurrency}
                />
              </dd>
            </div>
          ) : null}
          {summary ? (
            <div className="flex min-w-0 items-baseline justify-between gap-3 rounded-lg bg-secondary px-3 py-2">
              <dt className="shrink-0 text-muted-foreground">All time</dt>
              <dd className="min-w-0 text-right">
                <SignedMoney
                  value={summary.totalPnl}
                  percent={summary.totalPnlPercent}
                  currency={summary.baseCurrency}
                />
              </dd>
            </div>
          ) : (
            <div className="text-muted-foreground">Totals appear once quotes load.</div>
          )}
        </dl>
        {segments.length > 0 ? (
          <AllocationDonut
            className="mt-4 max-w-md"
            segments={segments}
            totalValue={summary?.totalValue}
            currency={summary?.baseCurrency}
          />
        ) : null}
      </div>
    </Panel>
  );
}
