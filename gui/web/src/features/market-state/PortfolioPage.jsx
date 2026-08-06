import { BriefcaseBusiness, ChevronRight, MoreHorizontal, Plus } from "lucide-react";
import { Fragment, lazy, Suspense, useEffect, useMemo, useState } from "react";
import { MarketSparkline } from "../../components/market-sparkline.jsx";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.jsx";
import { Skeleton } from "../../components/ui/skeleton.jsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.jsx";
import { formatPercent, formatQuantity } from "../../lib/financial-format.js";
import { cn } from "../../lib/utils.js";
import { symbolPageHref } from "../../route-resolution.js";
import { degradedQuoteBadge, shortDateLabel } from "./format.js";
import {
  buildHoldingRows,
  derivePortfolioDayMove,
  topAllocationSegments,
} from "./portfolio-view-model.js";
import {
  Badge,
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

const AllocationDonut = lazy(() => import("../../components/allocation-donut.jsx"));

// The sparkline is the first column to give way: it is decoration next to the
// position numbers, so it leaves before any figure does.
const TREND_COLUMN_CLASS = "hidden lg:table-cell";
// Cost-basis detail is the reference pair, useful but not the answer. It
// returns only where the ticker column can still hold a company name.
const BASIS_COLUMN_CLASS = "hidden min-[1400px]:table-cell";

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
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const lotCount = activeLots.length;
  const addHolding = () => openPanel("holding-add", { portfolio: activePortfolio });
  const removeLot = async () => {
    if (!pendingRemoval) return;
    await invokeTool("track_portfolio", { action: "remove", lot_id: pendingRemoval.id });
    setPendingRemoval(null);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3 xl:min-h-0 xl:flex-1">
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
      {loading || lotCount > 0 ? (
        <PortfolioSummary
          loading={loading}
          summary={summary}
          holdings={holdings}
          quoteBadge={quoteBadge}
        />
      ) : null}
      <Panel
        fill
        title="Holdings"
        meta={
          lotCount > 0
            ? `${holdings.length} ${holdings.length === 1 ? "symbol" : "symbols"} · ${lotCount} ${lotCount === 1 ? "lot" : "lots"}`
            : undefined
        }
        actions={
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {lotCount > 0 ? (
              <PanelSearch
                className="min-w-0 flex-1 sm:w-44 sm:flex-none"
                label="Search holdings"
                filter={filter}
                setFilter={setFilter}
              />
            ) : null}
            <Button
              type="button"
              variant="bordered"
              size="sm"
              className="shrink-0"
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
            cta={{ label: "Add holding", disabled: readOnly, onClick: addHolding }}
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
                onRemoveLot={setPendingRemoval}
                navigate={navigate}
              />
              <HoldingsTable
                rows={rows}
                expanded={expanded}
                toggleExpanded={toggleExpanded}
                quoteFlashes={quoteFlashes}
                activePortfolio={activePortfolio}
                readOnly={readOnly}
                openPanel={openPanel}
                onRemoveLot={setPendingRemoval}
                navigate={navigate}
              />
            </>
          )
        ) : null}
      </Panel>

      <AlertDialog
        open={Boolean(pendingRemoval)}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this {pendingRemoval?.symbol} lot?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes one lot from {activePortfolio?.name ?? "this portfolio"}. Other lots for
              the same symbol, watchlists, and alerts are unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={removeLot}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function HoldingsTable({
  rows,
  expanded,
  toggleExpanded,
  quoteFlashes,
  activePortfolio,
  readOnly,
  openPanel,
  onRemoveLot,
  navigate,
}) {
  return (
    <div className="hidden min-w-0 sm:flex sm:flex-col xl:min-h-0 xl:flex-1">
      <Table className="min-w-[900px] table-fixed" containerClassName="xl:min-h-0 xl:flex-1">
        <TableHeader className="sticky top-0 z-10 bg-card">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-11 px-1">
              <span className="sr-only">Expand lots</span>
            </TableHead>
            <TableHead>Symbol</TableHead>
            <TableHead className={cn("w-[112px] px-2", TREND_COLUMN_CLASS)}>
              <span className="sr-only">Trend</span>
            </TableHead>
            <TableHead className="w-[148px] text-right">Price</TableHead>
            <TableHead className="w-[148px] text-right">Today</TableHead>
            <TableHead className="w-[128px] text-right">Value</TableHead>
            <TableHead className="w-[164px] text-right">Total gain</TableHead>
            <TableHead className={cn("w-[76px] text-right", BASIS_COLUMN_CLASS)}>
              Quantity
            </TableHead>
            <TableHead className={cn("w-[96px] text-right", BASIS_COLUMN_CLASS)}>
              Avg cost
            </TableHead>
            <TableHead className="w-11 px-1">
              <span className="sr-only">Lot actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isExpanded = expanded.has(row.symbol);
            return (
              <Fragment key={row.symbol}>
                <TableRow className={cn(quoteFlashClass(quoteFlashes.get(row.symbol)))}>
                  <TableCell className="px-1 py-2.5">
                    <ExpandLotsButton
                      symbol={row.symbol}
                      expanded={isExpanded}
                      onToggle={() => toggleExpanded(row.symbol)}
                    />
                  </TableCell>
                  <TableCell className="px-3 py-2.5">
                    <SymbolPageLink symbol={row.symbol} name={row.name} navigate={navigate} />
                  </TableCell>
                  <TableCell className={cn("px-2 py-1.5", TREND_COLUMN_CLASS)}>
                    <MarketSparkline
                      className="ml-auto"
                      symbol={row.symbol}
                      assetType={row.assetType}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2.5 text-right align-top tabular-nums">
                    <div className="flex flex-col items-end">
                      <span>{moneyOrDash(row.currentPrice, row.currency)}</span>
                      <ExtendedHoursQuote
                        chip
                        showChange={false}
                        quote={row}
                        currency={row.currency}
                      />
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2.5 text-right align-top">
                    <SignedMoney
                      value={row.dayMove}
                      percent={row.changePercent}
                      percentDecimals={2}
                      currency={row.currency}
                    />
                  </TableCell>
                  <TableCell className="py-2.5 text-right align-top tabular-nums">
                    <span className="block">{moneyOrDash(row.marketValue, row.currency)}</span>
                    {/* Allocation rides with the value it is derived from
                        instead of claiming a column of its own. */}
                    {typeof row.allocationPercent === "number" ? (
                      <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                        {formatPercent(row.allocationPercent, { decimals: 1 })} of portfolio
                      </span>
                    ) : row.excludedFromTotals ? (
                      <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">
                        Kept out of the total
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2.5 text-right align-top">
                    <SignedMoney value={row.pnl} percent={row.pnlPercent} currency={row.currency} />
                  </TableCell>
                  <TableCell
                    className={cn("py-2.5 text-right align-top tabular-nums", BASIS_COLUMN_CLASS)}
                  >
                    {formatQuantity(row.totalQuantity)}
                  </TableCell>
                  <TableCell
                    data-slot="avg-cost-basis"
                    className={cn("py-2.5 text-right align-top tabular-nums", BASIS_COLUMN_CLASS)}
                  >
                    {moneyOrDash(row.blendedCost, row.currency)}
                  </TableCell>
                  <TableCell className="px-1 py-2.5" />
                </TableRow>
                {row.lots.map((lot) => (
                  <TableRow
                    key={lot.id}
                    data-slot="portfolio-lot-row"
                    className={cn(
                      "bg-secondary/60 text-[13px] hover:bg-secondary/60",
                      !isExpanded && "hidden",
                    )}
                  >
                    <TableCell className="px-1" />
                    <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
                      <div>
                        Lot · {shortDateLabel(lot.openedAt) || "—"}
                        {lot.notes ? ` · ${lot.notes}` : ""}
                      </div>
                      <div className="mt-1 tabular-nums min-[1400px]:hidden">
                        {formatQuantity(lot.quantity)} @ {money(lot.avgCost, lot.currency)}
                      </div>
                    </TableCell>
                    <TableCell className={TREND_COLUMN_CLASS} />
                    <TableCell />
                    <TableCell />
                    <TableCell className="py-2.5 text-right tabular-nums">
                      {moneyOrDash(lot.quote?.marketValue, lot.currency)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2.5 text-right">
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
                    </TableCell>
                    <TableCell className={cn("py-2.5 text-right tabular-nums", BASIS_COLUMN_CLASS)}>
                      {formatQuantity(lot.quantity)}
                    </TableCell>
                    <TableCell className={cn("py-2.5 text-right tabular-nums", BASIS_COLUMN_CLASS)}>
                      {money(lot.avgCost, lot.currency)}
                    </TableCell>
                    <TableCell className="px-1 py-2.5 text-right">
                      <LotActions
                        lot={lot}
                        portfolio={activePortfolio}
                        readOnly={readOnly || !isExpanded}
                        openPanel={openPanel}
                        onRemoveLot={onRemoveLot}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ExpandLotsButton({ symbol, expanded, onToggle }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="size-10"
      aria-expanded={expanded}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${symbol} lots`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <ChevronRight
        className={`size-3.5 transition-transform duration-150 ease-out ${
          expanded ? "rotate-90" : "rotate-0"
        }`}
      />
    </Button>
  );
}

function MobileHoldingRows({
  rows,
  expanded,
  toggleExpanded,
  activePortfolio,
  readOnly,
  openPanel,
  onRemoveLot,
  navigate,
}) {
  return (
    <div className="divide-y divide-border sm:hidden">
      {rows.map((row) => {
        const isExpanded = expanded.has(row.symbol);
        return (
          <div key={row.symbol} data-slot="mobile-portfolio-holding">
            <div className="grid min-h-[58px] w-full grid-cols-[1rem_minmax(0,1fr)_4.5rem_6rem] items-center gap-2 px-3 py-2 text-left transition-[background-color] duration-150 ease-out hover:bg-secondary/60">
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
              <MarketSparkline symbol={row.symbol} assetType={row.assetType} />
              <span className="flex flex-col items-end gap-0.5 tabular-nums">
                <span>{moneyOrDash(row.marketValue, row.currency)}</span>
                <SignedPercent value={row.changePercent} />
              </span>
              <ExtendedHoursQuote
                chip
                quote={row}
                currency={row.currency}
                className="col-span-4 mt-0"
              />
            </div>
            <div
              inert={!isExpanded}
              className={`grid transition-[grid-template-rows] duration-150 ease-out ${
                isExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-border bg-secondary/40 px-4 py-3 text-xs">
                  <MobileMetric label="Price" value={moneyOrDash(row.currentPrice, row.currency)} />
                  <MobileMetric
                    label="Today"
                    value={
                      <SignedMoney
                        value={row.dayMove}
                        percent={row.changePercent}
                        percentDecimals={2}
                        currency={row.currency}
                      />
                    }
                  />
                  <MobileMetric
                    label="Total gain"
                    value={
                      <SignedMoney
                        value={row.pnl}
                        percent={row.pnlPercent}
                        currency={row.currency}
                      />
                    }
                  />
                  <MobileMetric
                    label="Allocation"
                    value={
                      typeof row.allocationPercent === "number"
                        ? formatPercent(row.allocationPercent, { decimals: 1 })
                        : row.excludedFromTotals
                          ? "Kept out of the total"
                          : "—"
                    }
                  />
                  <MobileMetric label="Quantity" value={formatQuantity(row.totalQuantity)} />
                  <MobileMetric
                    label="Avg cost"
                    value={moneyOrDash(row.blendedCost, row.currency)}
                  />
                </dl>
                <div className="divide-y divide-border/70 border-t border-border bg-secondary/60">
                  {row.lots.map((lot) => (
                    <div key={lot.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0 text-xs text-muted-foreground">
                        <div>Lot · {shortDateLabel(lot.openedAt) || "—"}</div>
                        <div className="mt-1 tabular-nums">
                          {formatQuantity(lot.quantity)} @ {money(lot.avgCost, lot.currency)}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <span className="text-xs tabular-nums">
                          {moneyOrDash(lot.quote?.marketValue, lot.currency)}
                        </span>
                        <LotActions
                          lot={lot}
                          portfolio={activePortfolio}
                          readOnly={readOnly || !isExpanded}
                          openPanel={openPanel}
                          onRemoveLot={onRemoveLot}
                        />
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
      className="flex min-h-10 min-w-0 items-center rounded-sm transition-transform duration-150 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
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
      <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

// Loading rows are shaped like the rows they stand in for, so the table never
// renders a full schema of em dashes while quotes are still in flight. Each
// viewport gets the shape of its own layout, not the other one's.
function PortfolioSkeleton() {
  return (
    <div data-slot="portfolio-skeleton" role="status" aria-label="Loading holdings">
      <div className="divide-y divide-border sm:hidden">
        {["first", "second", "third", "fourth"].map((key) => (
          <div
            key={key}
            className="grid min-h-[58px] grid-cols-[1rem_minmax(0,1fr)_4.5rem_6rem] items-center gap-2 px-3 py-2"
          >
            <span />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-[29px] w-full" />
            <Skeleton className="ml-auto h-8 w-20" />
          </div>
        ))}
      </div>
      <DesktopHoldingsSkeleton />
    </div>
  );
}

function DesktopHoldingsSkeleton() {
  return (
    <Table
      className="hidden table-fixed sm:table sm:min-w-[900px]"
      containerClassName="hidden sm:block"
    >
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-11 px-1" />
          <TableHead>Symbol</TableHead>
          <TableHead className={cn("w-[112px] px-2", TREND_COLUMN_CLASS)} />
          <TableHead className="w-[148px] text-right">Price</TableHead>
          <TableHead className="w-[148px] text-right">Today</TableHead>
          <TableHead className="w-[128px] text-right">Value</TableHead>
          <TableHead className="w-[164px] text-right">Total gain</TableHead>
          <TableHead className={cn("w-[76px] text-right", BASIS_COLUMN_CLASS)}>Quantity</TableHead>
          <TableHead className={cn("w-[96px] text-right", BASIS_COLUMN_CLASS)}>Avg cost</TableHead>
          <TableHead className="w-11 px-1" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {["first", "second", "third", "fourth"].map((key) => (
          <TableRow key={key} className="hover:bg-transparent">
            <TableCell className="px-1 py-2.5" />
            <TableCell className="px-3 py-2.5">
              <Skeleton className="h-8 w-28" />
            </TableCell>
            <TableCell className={cn("px-2 py-2.5", TREND_COLUMN_CLASS)}>
              <Skeleton className="ml-auto h-[29px] w-[96px]" />
            </TableCell>
            <TableCell className="py-2.5">
              <Skeleton className="ml-auto h-4 w-16" />
            </TableCell>
            <TableCell className="py-2.5">
              <Skeleton className="ml-auto h-4 w-24" />
            </TableCell>
            <TableCell className="py-2.5">
              <Skeleton className="ml-auto h-4 w-20" />
            </TableCell>
            <TableCell className="py-2.5">
              <Skeleton className="ml-auto h-4 w-28" />
            </TableCell>
            <TableCell className={cn("py-2.5", BASIS_COLUMN_CLASS)}>
              <Skeleton className="ml-auto h-4 w-10" />
            </TableCell>
            <TableCell className={cn("py-2.5", BASIS_COLUMN_CLASS)}>
              <Skeleton className="ml-auto h-4 w-14" />
            </TableCell>
            <TableCell className="px-1 py-2.5" />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function countLotsByPortfolio(lots) {
  const counts = new Map();
  for (const lot of lots ?? []) {
    counts.set(lot.portfolioId, (counts.get(lot.portfolioId) ?? 0) + 1);
  }
  return counts;
}

function LotActions({ lot, portfolio, readOnly, openPanel, onRemoveLot }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-10"
          aria-label={`Actions for the ${lot.symbol} lot`}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={readOnly}
          onSelect={() => openPanel("holding-edit", { lot, portfolio })}
        >
          Edit lot
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={readOnly}
          onSelect={() => onRemoveLot(lot)}
        >
          Remove lot
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Quicken-style opening band: the three numbers a holder checks first, then the
// allocation that explains them. Every figure keeps its own currency and stays
// unknown rather than guessed when the totals are partial.
function PortfolioSummary({ loading, summary, holdings, quoteBadge }) {
  // Only holdings the totals are built from can move the base-currency day
  // figure. A holding priced in another currency states its own move on its row.
  const dayMove = useMemo(
    () => derivePortfolioDayMove(holdings.filter((row) => !row.excludedFromTotals)),
    [holdings],
  );
  const segments = useMemo(() => topAllocationSegments(holdings), [holdings]);
  const pending = loading || !summary;
  const currency = summary?.baseCurrency ?? "USD";
  const dayPercent =
    dayMove != null && summary && summary.totalValue - dayMove > 0
      ? (dayMove / (summary.totalValue - dayMove)) * 100
      : null;
  const excluded = summary?.excludedFromTotals ?? [];

  return (
    <Panel className="shrink-0">
      <div data-slot="portfolio-summary" className="flex flex-col xl:flex-row">
        <dl
          data-slot={pending ? "portfolio-summary-loading" : "portfolio-summary-stats"}
          role={pending ? "status" : undefined}
          aria-label={pending ? "Loading portfolio totals" : undefined}
          className="grid min-w-0 flex-1 grid-cols-2 sm:grid-cols-3"
        >
          <Stat
            label="Market value"
            className="col-span-2 border-b border-border sm:col-span-1 sm:border-b-0 sm:border-r"
          >
            {pending ? (
              <Skeleton className="h-7 w-40" />
            ) : (
              <span className="block text-[28px] font-semibold leading-none tabular-nums text-foreground">
                {money(summary.totalValue, currency)}
              </span>
            )}
            {quoteBadge ? (
              <Badge tone="warn" className="mt-2.5">
                {quoteBadge}
              </Badge>
            ) : null}
          </Stat>
          <Stat label="Today's change" className="border-r border-border">
            {pending ? (
              <Skeleton className="h-6 w-28" />
            ) : (
              <StatDelta value={dayMove} percent={dayPercent} currency={currency} />
            )}
          </Stat>
          <Stat label="Total gain">
            {pending ? (
              <Skeleton className="h-6 w-28" />
            ) : (
              <StatDelta
                value={summary.totalPnl}
                percent={summary.totalPnlPercent}
                currency={currency}
              />
            )}
          </Stat>
        </dl>
        <div className="border-t border-border p-4 sm:p-5 xl:w-[352px] xl:shrink-0 xl:border-l xl:border-t-0 min-[1400px]:w-[400px]">
          {pending || segments.length === 0 ? (
            <AllocationPlaceholder pending={pending} />
          ) : (
            <Suspense fallback={<AllocationPlaceholder pending />}>
              <AllocationDonut
                segments={segments}
                totalValue={summary?.totalValue}
                currency={currency}
              />
            </Suspense>
          )}
        </div>
      </div>
      {excluded.length > 0 ? (
        <p
          data-slot="portfolio-excluded-note"
          className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground sm:px-5"
        >
          Kept out of the {currency} total:{" "}
          {excluded.map((row) => `${row.symbol} (${row.reason ?? row.currency})`).join(", ")}
        </p>
      ) : null}
    </Panel>
  );
}

function Stat({ label, className, children }) {
  return (
    <div
      className={cn("flex min-w-0 flex-col justify-center px-4 py-3.5 sm:px-5 sm:py-4", className)}
    >
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-2">{children}</dd>
    </div>
  );
}

function StatDelta({ value, percent, currency }) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return (
      <span className="block text-[22px] font-semibold leading-none text-muted-foreground">—</span>
    );
  }
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <SignedMoney
        value={value}
        currency={currency}
        className="text-[22px] font-semibold leading-none"
      />
      {typeof percent === "number" && Number.isFinite(percent) ? (
        <SignedPercent value={percent} decimals={1} className="text-[13px]" />
      ) : null}
    </span>
  );
}

function AllocationPlaceholder({ pending }) {
  if (!pending) {
    return (
      <p className="text-xs text-muted-foreground">
        Allocation appears once a holding has a priced position.
      </p>
    );
  }
  return (
    <div
      data-slot="allocation-donut-loading"
      role="status"
      aria-label="Loading portfolio allocation"
      // Same grid and same chart footprint as the donut it stands in for, so
      // the header band does not resize when the allocation arrives.
      className="grid grid-cols-[7rem_minmax(0,1fr)] items-center gap-3"
    >
      <Skeleton className="mx-auto size-28 rounded-full" />
      <div className="grid gap-1.5">
        {["first", "second", "third", "fourth"].map((key) => (
          <Skeleton key={key} className="h-3.5 w-full" />
        ))}
      </div>
    </div>
  );
}
