import { Bell, ExternalLink, ListPlus, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { Card } from "../../components/ui/card.jsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu.jsx";
import { Sheet, SheetContent } from "../../components/ui/sheet.jsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.jsx";
import { formatCompactNumber, formatNumber, formatQuantity } from "../../lib/financial-format.js";
import { cn } from "../../lib/utils.js";
import { symbolPageHref } from "../../route-resolution.js";
import { buildAlertSentenceRows } from "./alert-view-model.js";
import { degradedQuoteBadge } from "./format.js";
import { buildHoldingRows } from "./portfolio-view-model.js";
import {
  Badge,
  EmptyState,
  ExtendedHoursQuote,
  filterItems,
  groupBy,
  groupByOne,
  InspectorSection,
  money,
  moneyOrDash,
  Panel,
  PanelSearch,
  quoteFlashClass,
  SignedMoney,
  SignedPercent,
  StateTabs,
  StatusDot,
  Sym,
  useQuoteChangeFlash,
} from "./shared.jsx";

const WIDE_INSPECTOR_QUERY = "(min-width: 1280px)";

function useWideInspector() {
  const [wide, setWide] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(WIDE_INSPECTOR_QUERY).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const media = window.matchMedia(WIDE_INSPECTOR_QUERY);
    const onChange = (event) => setWide(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return wide;
}

export function WatchlistPage({
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
  const watchlists = useMemo(
    () =>
      state.watchlists?.length ? state.watchlists : [{ id: 1, name: "Default", isDefault: true }],
    [state.watchlists],
  );
  const [activeWatchlistId, setActiveWatchlistId] = useState(watchlists[0]?.id ?? null);
  const activeWatchlist =
    watchlists.find((watchlist) => watchlist.id === activeWatchlistId) ?? watchlists[0] ?? null;
  const [selectedId, setSelectedId] = useState(null);
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const wideInspector = useWideInspector();

  useEffect(() => {
    if (!activeWatchlist) return;
    if (!watchlists.some((watchlist) => watchlist.id === activeWatchlistId)) {
      setActiveWatchlistId(activeWatchlist.id);
    }
  }, [activeWatchlist, activeWatchlistId, watchlists]);

  const quotesByItem = useMemo(
    () => groupByOne(state.quoteSnapshot?.watchlistQuotes, "itemId"),
    [state.quoteSnapshot],
  );
  const quotesBySymbol = useMemo(
    () =>
      new Map((state.quoteSnapshot?.watchlistQuotes ?? []).map((quote) => [quote.symbol, quote])),
    [state.quoteSnapshot],
  );
  const quoteFlashes = useQuoteChangeFlash(quotesBySymbol);
  const alertsByInstrument = useMemo(() => groupBy(state.alerts, "instrumentId"), [state.alerts]);
  const watchlistItems = useMemo(
    () => (state.watchlist ?? []).filter((item) => item.watchlistId === activeWatchlist?.id),
    [state.watchlist, activeWatchlist],
  );
  const quoteBadge = useMemo(() => {
    const itemIds = new Set(watchlistItems.map((item) => item.id));
    return degradedQuoteBadge(
      (state.quoteSnapshot?.watchlistQuotes ?? []).filter((quote) => itemIds.has(quote.itemId)),
    );
  }, [state.quoteSnapshot, watchlistItems]);
  const rows = useMemo(
    () => filterItems(watchlistItems, filter, ["symbol", "name"]),
    [watchlistItems, filter],
  );
  const selected = rows.find((item) => item.id === selectedId) ?? null;
  const desktopSelected = selected ?? rows[0] ?? null;

  const selectWatchlist = (watchlistId) => {
    if (watchlistId === activeWatchlistId) return;
    setActiveWatchlistId(watchlistId);
    setSelectedId(null);
    setFilter("");
  };
  const removeItem = async () => {
    if (!pendingRemoval) return;
    const removed = await invokeTool("manage_watchlist", {
      action: "remove",
      symbol: pendingRemoval.symbol,
      watchlist_name: activeWatchlist?.name,
    });
    if (removed) setSelectedId(null);
    setPendingRemoval(null);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {renderPageHeader?.(
        <StateTabs
          items={watchlists}
          activeItem={activeWatchlist}
          counts={countItemsByWatchlist(state.watchlist ?? [])}
          compactSingle
          readOnly={readOnly}
          renameLabel="Rename watchlist"
          onSelect={selectWatchlist}
          onRename={(watchlist) => openPanel("watchlist-rename", { watchlist })}
        />,
      )}
      <div
        className={cn(
          "grid min-w-0 grid-cols-1 items-start gap-3",
          desktopSelected && "xl:grid-cols-[minmax(0,1fr)_350px]",
        )}
      >
        <Panel
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {quoteBadge ? <Badge tone="warn">{quoteBadge}</Badge> : null}
              <PanelSearch label="Search symbols" filter={filter} setFilter={setFilter} />
              <Button
                type="button"
                variant="bordered"
                size="sm"
                prefixIcon={Plus}
                disabled={readOnly || !activeWatchlist}
                onClick={() => openPanel("watchlist-add", { watchlist: activeWatchlist })}
              >
                Add ticker
              </Button>
            </div>
          }
        >
          {loading ? (
            <QuoteBoardSkeleton />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={ListPlus}
              title={
                watchlistItems.length === 0 ? "No tickers yet" : "No symbols match this search"
              }
              action={
                watchlistItems.length === 0
                  ? "Add a ticker to this watchlist."
                  : "Try a different symbol search."
              }
              cta={{
                label: "Add ticker",
                disabled: readOnly || !activeWatchlist,
                onClick: () => openPanel("watchlist-add", { watchlist: activeWatchlist }),
              }}
            />
          ) : (
            <QuoteBoard
              rows={rows}
              selected={selected}
              quotesByItem={quotesByItem}
              alertsByInstrument={alertsByInstrument}
              quoteFlashes={quoteFlashes}
              readOnly={readOnly}
              onSelect={setSelectedId}
              onRemove={setPendingRemoval}
              onCreateAlert={(item) => openPanel("alert-create", { symbol: item.symbol })}
              navigate={navigate}
            />
          )}
        </Panel>

        {desktopSelected ? (
          <SymbolInspector
            key={desktopSelected.id}
            className="hidden xl:sticky xl:top-4 xl:block"
            item={desktopSelected}
            quote={quotesByItem.get(desktopSelected.id)}
            state={state}
            readOnly={readOnly}
            onRemove={() => setPendingRemoval(desktopSelected)}
            onCreateAlert={() => openPanel("alert-create", { symbol: desktopSelected.symbol })}
            navigate={navigate}
          />
        ) : null}
      </div>

      <Sheet
        open={Boolean(selected) && !wideInspector}
        onOpenChange={(open) => !open && setSelectedId(null)}
      >
        <SheetContent width="sm" handleLabel="Symbol details" className="bg-card p-0">
          <div data-slot="watchlist-inspector-sheet" className="min-h-0 overflow-y-auto">
            {selected ? (
              <SymbolInspector
                item={selected}
                quote={quotesByItem.get(selected.id)}
                state={state}
                readOnly={readOnly}
                onRemove={() => setPendingRemoval(selected)}
                onCreateAlert={() => openPanel("alert-create", { symbol: selected.symbol })}
                navigate={navigate}
                className="border-0 shadow-none"
              />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={Boolean(pendingRemoval)}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {pendingRemoval?.symbol} from this watchlist?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the ticker from {activeWatchlist?.name ?? "this watchlist"}. Alerts and
              portfolio holdings are unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={removeItem}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function QuoteBoard({
  rows,
  selected,
  quotesByItem,
  alertsByInstrument,
  quoteFlashes,
  readOnly,
  onSelect,
  onRemove,
  onCreateAlert,
  navigate,
}) {
  const props = {
    rows,
    selected,
    quotesByItem,
    alertsByInstrument,
    quoteFlashes,
    readOnly,
    onSelect,
    onRemove,
    onCreateAlert,
    navigate,
  };
  return (
    <>
      <MobileQuoteList {...props} />
      <div className="hidden sm:block">
        <DesktopQuoteTable {...props} />
      </div>
    </>
  );
}

function MobileQuoteList({
  rows,
  selected,
  quotesByItem,
  alertsByInstrument,
  quoteFlashes,
  onSelect,
}) {
  return (
    <ul className="divide-y divide-border sm:hidden" aria-label="Watchlist quotes">
      {rows.map((item) => {
        const quote = quotesByItem.get(item.id);
        const currency = quote?.currency ?? item.currency;
        return (
          <li key={item.id}>
            <button
              type="button"
              data-slot="mobile-watchlist-row"
              aria-haspopup="dialog"
              aria-label={`View ${item.symbol} details`}
              aria-pressed={selected?.id === item.id}
              className={cn(
                "grid min-h-16 w-full grid-cols-[minmax(0,1fr)_5rem_8rem] items-center gap-2 px-3 py-2 text-left transition-[background-color,transform,scale] duration-150 ease-out hover:bg-secondary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                quoteFlashClass(quoteFlashes.get(item.symbol)),
                selected?.id === item.id && "bg-secondary",
              )}
              onClick={() => onSelect(item.id)}
            >
              <span className="flex min-w-0 items-start gap-1.5">
                <Sym symbol={item.symbol} name={quote?.name ?? item.name} />
                <AlertChip
                  alerts={alertsByInstrument.get(item.instrumentId)}
                  symbol={item.symbol}
                />
              </span>
              <span className="min-w-0 overflow-hidden">
                <MarketSparkline
                  symbol={item.symbol}
                  sparkline={quote?.sparkline}
                  className="max-w-full"
                />
              </span>
              <span className="flex min-w-0 flex-col items-end tabular-nums">
                <span>{quote?.status === "ok" ? money(quote.price, currency) : "—"}</span>
                <span className="mt-0.5">
                  <SignedPercent value={quote?.status === "ok" ? quote.changePercent : null} />
                </span>
                {quote?.status === "ok" ? (
                  <ExtendedHoursQuote
                    quote={quote}
                    currency={currency}
                    className="overflow-hidden"
                  />
                ) : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function DesktopQuoteTable({
  rows,
  selected,
  quotesByItem,
  alertsByInstrument,
  quoteFlashes,
  readOnly,
  onSelect,
  onRemove,
  onCreateAlert,
  navigate,
}) {
  return (
    <Table className="min-w-[680px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Symbol</TableHead>
          <TableHead className="px-1 sm:px-3">
            <span className="sr-only sm:not-sr-only">24 hr sparkline</span>
          </TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Change</TableHead>
          <TableHead className="hidden text-right lg:table-cell">Volume</TableHead>
          <TableHead className="w-10">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((item) => {
          const quote = quotesByItem.get(item.id);
          const isSelected = selected?.id === item.id;
          return (
            <TableRow
              key={item.id}
              aria-selected={isSelected}
              className={cn(
                "cursor-pointer transition-[background-color,transform,scale] duration-150 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                quoteFlashClass(quoteFlashes.get(item.symbol)),
                isSelected && "bg-secondary",
              )}
              tabIndex={0}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelect(item.id);
              }}
            >
              <TableCell className="w-[88px] max-w-[88px] px-2 py-2.5 sm:w-auto sm:max-w-none sm:px-3">
                <div className="flex min-w-0 items-start gap-1.5">
                  <a
                    href={symbolPageHref(item.symbol)}
                    className="flex min-h-10 min-w-0 items-center rounded-sm transition-transform duration-150 ease-out active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!navigate) return;
                      event.preventDefault();
                      void navigate({ to: symbolPageHref(item.symbol) });
                    }}
                  >
                    <Sym symbol={item.symbol} name={quote?.name ?? item.name} />
                  </a>
                  <AlertChip
                    alerts={alertsByInstrument.get(item.instrumentId)}
                    symbol={item.symbol}
                  />
                </div>
              </TableCell>
              <TableCell className="px-1 py-1.5 sm:px-3">
                <MarketSparkline symbol={item.symbol} sparkline={quote?.sparkline} />
              </TableCell>
              <TableCell className="w-[82px] px-2 py-2.5 text-right tabular-nums sm:w-auto sm:px-3">
                {quote?.status === "ok" ? (
                  <div className="flex flex-col items-end">
                    <span>{money(quote.price, quote.currency ?? item.currency)}</span>
                    <ExtendedHoursQuote quote={quote} currency={quote.currency ?? item.currency} />
                  </div>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell className="hidden py-2.5 text-right sm:table-cell">
                <div className="flex flex-col items-end gap-0.5">
                  <SignedMoney
                    value={quote?.status === "ok" ? quote.change : null}
                    currency={quote?.currency ?? item.currency ?? "USD"}
                  />
                  <SignedPercent value={quote?.status === "ok" ? quote.changePercent : null} />
                </div>
              </TableCell>
              <TableCell className="hidden py-2.5 text-right tabular-nums lg:table-cell">
                {quote?.status === "ok" ? formatCompactNumber(quote.volume) : "—"}
              </TableCell>
              <TableCell className="py-2.5 text-right" onClick={(event) => event.stopPropagation()}>
                <RowActions
                  item={item}
                  disabled={readOnly}
                  onRemove={onRemove}
                  onCreateAlert={onCreateAlert}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function QuoteBoardSkeleton() {
  return (
    <Table data-slot="watchlist-skeleton" className="sm:min-w-[760px]" aria-label="Loading quotes">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Symbol</TableHead>
          <TableHead className="px-1 sm:px-3">
            <span className="sr-only sm:not-sr-only">24 hr sparkline</span>
          </TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Change</TableHead>
          <TableHead className="hidden text-right lg:table-cell">Volume</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {["first", "second", "third", "fourth"].map((key) => (
          <TableRow key={key} className="hover:bg-transparent">
            <TableCell className="w-[88px] max-w-[88px] px-2 py-2.5 sm:w-auto sm:max-w-none sm:px-3">
              <Skeleton className="h-8 w-28" />
            </TableCell>
            <TableCell className="px-1 py-2.5 sm:px-3">
              <Skeleton className="h-[29px] w-24 sm:h-9 sm:w-[120px]" />
            </TableCell>
            <TableCell className="w-[82px] px-2 py-2.5 sm:w-auto sm:px-3">
              <Skeleton className="ml-auto h-4 w-14" />
            </TableCell>
            <TableCell className="hidden py-2.5 sm:table-cell">
              <Skeleton className="ml-auto h-4 w-12" />
            </TableCell>
            <TableCell className="hidden py-2.5 lg:table-cell">
              <Skeleton className="ml-auto h-4 w-16" />
            </TableCell>
            <TableCell className="py-2.5">
              <Skeleton className="ml-auto size-7" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Skeleton({ className }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded bg-secondary", className)} />;
}

function RowActions({ item, disabled, onRemove, onCreateAlert }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-10"
          aria-label={`Actions for ${item.symbol}`}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={disabled} onSelect={() => onCreateAlert(item)}>
          Create alert
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" disabled={disabled} onSelect={() => onRemove(item)}>
          Remove from watchlist
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function countItemsByWatchlist(items) {
  const counts = new Map();
  for (const item of items) {
    counts.set(item.watchlistId, (counts.get(item.watchlistId) ?? 0) + 1);
  }
  return counts;
}

function AlertChip({ alerts, symbol }) {
  const active = (alerts ?? []).filter((alert) => alert.enabled !== false);
  if (active.length === 0) return null;
  const label = `${formatNumber(active.length)} active ${active.length === 1 ? "alert" : "alerts"} for ${symbol}`;
  return (
    <Badge
      tone="ok"
      className="h-5 shrink-0 gap-1 px-1.5"
      data-slot="watchlist-alert-chip"
      aria-label={label}
    >
      <Bell className="size-3" aria-hidden="true" />
      <span className="tabular-nums">{formatNumber(active.length)}</span>
    </Badge>
  );
}

function SymbolInspector({
  item,
  quote,
  state,
  readOnly,
  onRemove,
  onCreateAlert,
  navigate,
  className,
}) {
  const positionRow = useMemo(() => {
    const rows = buildHoldingRows(
      (state.portfolio ?? []).filter((lot) => lot.symbol === item.symbol),
      state.quoteSnapshot?.portfolioQuotes ?? [],
    );
    return rows[0] ?? null;
  }, [state.portfolio, state.quoteSnapshot, item.symbol]);
  const alertRows = useMemo(
    () =>
      buildAlertSentenceRows(
        (state.alerts ?? []).filter((rule) => rule.instrumentId === item.instrumentId),
        state.alertEvents ?? [],
        state.instruments ?? [],
      ),
    [state.alerts, state.alertEvents, state.instruments, item.instrumentId],
  );
  const currency = quote?.currency ?? item.currency;
  return (
    <Card
      role="complementary"
      className={cn("overflow-hidden shadow-subtle-xs", className)}
      aria-label={`${item.symbol} details`}
    >
      <h2 className="sr-only">{item.symbol} details</h2>
      <div className="border-b border-border p-4">
        <Sym symbol={item.symbol} name={quote?.name ?? item.name} />
        <div className="mt-2 text-[28px] font-semibold leading-tight tabular-nums text-foreground">
          {quote?.status === "ok" ? money(quote.price, currency) : "—"}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          {quote?.status === "ok" ? <SignedMoney value={quote.change} currency={currency} /> : null}
          {quote?.status === "ok" ? <SignedPercent value={quote.changePercent} /> : null}
          {quote && quote.status !== "ok" ? (
            <span>{quote.reason || "Quote unavailable"}</span>
          ) : null}
        </div>
        <ExtendedHoursQuote quote={quote} currency={currency} className="mt-1.5 text-xs" />
      </div>

      {quote?.status === "ok" ? <QuoteRanges quote={quote} currency={currency} /> : null}

      {positionRow ? (
        <InspectorSection title="Position">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-muted-foreground">
              {formatQuantity(positionRow.totalQuantity)} shares @{" "}
              {moneyOrDash(positionRow.blendedCost, positionRow.currency)}
            </span>
            <span className="tabular-nums">
              {moneyOrDash(positionRow.marketValue, positionRow.currency)}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between text-[13px]">
            <span className="text-muted-foreground">Unrealized</span>
            <SignedMoney
              value={positionRow.pnl}
              percent={positionRow.pnlPercent}
              currency={positionRow.currency}
            />
          </div>
        </InspectorSection>
      ) : null}

      <InspectorSection title="Alerts">
        {alertRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No alerts for {item.symbol} yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {alertRows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 text-[13px]">
                <StatusDot tone={row.tone} label={row.sentence} />
                <span className="text-[11px] text-muted-foreground">
                  {row.enabled ? "armed" : "paused"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </InspectorSection>

      <div className="grid grid-cols-2 gap-2 p-4">
        <Button asChild variant="brand" size="sm" className="col-span-2 min-h-10 w-full">
          <a
            href={symbolPageHref(item.symbol)}
            onClick={(event) => {
              if (!navigate) return;
              event.preventDefault();
              void navigate({ to: symbolPageHref(item.symbol) });
            }}
          >
            <ExternalLink className="button-icon" />
            Open full page
          </a>
        </Button>
        <Button
          type="button"
          variant="bordered"
          size="sm"
          className="min-h-10 w-full"
          disabled={readOnly}
          onClick={onCreateAlert}
        >
          Create alert
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          prefixIcon={Trash2}
          className="min-h-10 w-full border border-destructive/40 bg-destructive/10 text-foreground hover:bg-destructive/15"
          disabled={readOnly}
          onClick={onRemove}
        >
          Remove
        </Button>
      </div>
    </Card>
  );
}

function QuoteRanges({ quote, currency }) {
  const ranges = [
    ["Day range", quote.dayLow, quote.dayHigh],
    ["52-week range", quote.week52Low, quote.week52High],
  ].filter(
    ([, low, high]) =>
      Number.isFinite(low) && Number.isFinite(high) && low > 0 && high > 0 && high >= low,
  );
  if (ranges.length === 0) return null;
  return (
    <InspectorSection title="Range">
      <dl className="space-y-2 text-[13px]">
        {ranges.map(([label, low, high]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="tabular-nums">
              {money(low, currency)} – {money(high, currency)}
            </dd>
          </div>
        ))}
      </dl>
    </InspectorSection>
  );
}
