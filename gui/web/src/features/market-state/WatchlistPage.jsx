import { ListPlus, MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.jsx";
import { cn } from "../../lib/utils.js";
import { buildAlertSentenceRows } from "./alert-view-model.js";
import { degradedQuoteBadge } from "./format.js";
import { buildHoldingRows } from "./portfolio-view-model.js";
import {
  Badge,
  EmptyState,
  filterItems,
  formatNumber,
  groupBy,
  groupByOne,
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

export function WatchlistPage({
  state,
  loading = false,
  filter,
  setFilter,
  readOnly,
  openPanel,
  invokeTool,
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
  const selected = rows.find((item) => item.id === selectedId) ?? rows[0] ?? null;

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
          readOnly={readOnly}
          renameLabel="Rename watchlist"
          onSelect={selectWatchlist}
          onRename={(watchlist) => openPanel("watchlist-rename", { watchlist })}
        />,
      )}
      <div
        className={cn(
          "grid min-w-0 grid-cols-1 items-start gap-3",
          selected && "xl:grid-cols-[minmax(0,1fr)_350px]",
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
            />
          )}
        </Panel>

        {selected ? (
          <SymbolInspector
            key={selected.id}
            item={selected}
            quote={quotesByItem.get(selected.id)}
            state={state}
            readOnly={readOnly}
            onRemove={() => setPendingRemoval(selected)}
            onCreateAlert={() => openPanel("alert-create", { symbol: selected.symbol })}
          />
        ) : null}
      </div>

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
}) {
  return (
    <Table className="sm:min-w-[620px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Symbol</TableHead>
          <TableHead className="text-right">Last</TableHead>
          <TableHead className="hidden text-right md:table-cell">Chg $</TableHead>
          <TableHead className="text-right">Chg %</TableHead>
          <TableHead className="hidden text-right lg:table-cell">Volume</TableHead>
          <TableHead className="hidden sm:table-cell">Signals</TableHead>
          <TableHead className="w-10" aria-label="Actions" />
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
                "cursor-pointer",
                quoteFlashClass(quoteFlashes.get(item.symbol)),
                isSelected && "bg-secondary",
              )}
              onClick={() => onSelect(item.id)}
            >
              <TableCell className="py-2.5">
                <Sym symbol={item.symbol} name={quote?.name ?? item.name} />
              </TableCell>
              <TableCell className="py-2.5 text-right tabular-nums">
                {quote?.status === "ok" ? money(quote.price, quote.currency ?? item.currency) : "—"}
              </TableCell>
              <TableCell className="hidden py-2.5 text-right md:table-cell">
                <SignedMoney
                  value={quote?.status === "ok" ? quote.change : null}
                  currency={quote?.currency ?? item.currency ?? "USD"}
                />
              </TableCell>
              <TableCell className="py-2.5 text-right">
                <SignedPercent value={quote?.status === "ok" ? quote.changePercent : null} />
              </TableCell>
              <TableCell className="hidden py-2.5 text-right tabular-nums lg:table-cell">
                {quote?.status === "ok" ? formatNumber(quote.volume) : "—"}
              </TableCell>
              <TableCell className="hidden py-2.5 sm:table-cell">
                <SignalBadge alerts={alertsByInstrument.get(item.instrumentId)} quote={quote} />
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
    <Table data-slot="watchlist-skeleton" className="sm:min-w-[620px]" aria-label="Loading quotes">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Symbol</TableHead>
          <TableHead className="text-right">Last</TableHead>
          <TableHead className="hidden text-right md:table-cell">Chg $</TableHead>
          <TableHead className="text-right">Chg %</TableHead>
          <TableHead className="hidden text-right lg:table-cell">Volume</TableHead>
          <TableHead className="hidden sm:table-cell">Signals</TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {["first", "second", "third", "fourth"].map((key) => (
          <TableRow key={key} className="hover:bg-transparent">
            <TableCell className="py-2.5">
              <Skeleton className="h-8 w-28" />
            </TableCell>
            <TableCell className="py-2.5">
              <Skeleton className="ml-auto h-4 w-14" />
            </TableCell>
            <TableCell className="hidden py-2.5 md:table-cell">
              <Skeleton className="ml-auto h-4 w-12" />
            </TableCell>
            <TableCell className="py-2.5">
              <Skeleton className="ml-auto h-4 w-12" />
            </TableCell>
            <TableCell className="hidden py-2.5 lg:table-cell">
              <Skeleton className="ml-auto h-4 w-16" />
            </TableCell>
            <TableCell className="hidden py-2.5 sm:table-cell">
              <Skeleton className="h-5 w-14" />
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

function SignalBadge({ alerts, quote }) {
  if (quote && quote.status !== "ok") return <Badge tone="warn">Quote unavailable</Badge>;
  const active = (alerts ?? []).filter((alert) => alert.enabled !== false);
  if (active.length === 0) return <Badge>No alerts</Badge>;
  return <Badge tone="ok">{active.length}</Badge>;
}

function SymbolInspector({ item, quote, state, readOnly, onRemove, onCreateAlert }) {
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
    <aside
      className="rounded-xl border border-border bg-card shadow-subtle-xs xl:sticky xl:top-4"
      aria-label={`${item.symbol} details`}
    >
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
      </div>

      {quote?.status === "ok" ? <QuoteRanges quote={quote} currency={currency} /> : null}

      {positionRow ? (
        <InspectorSection title="Position">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-muted-foreground">
              {positionRow.totalQuantity.toLocaleString()} shares @{" "}
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

      <div className="flex flex-wrap gap-2 p-4">
        <Button
          type="button"
          variant="bordered"
          size="sm"
          disabled={readOnly}
          onClick={onCreateAlert}
        >
          Create alert
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={readOnly} onClick={onRemove}>
          Remove
        </Button>
      </div>
    </aside>
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

function InspectorSection({ title, children }) {
  return (
    <section className="border-b border-border p-4 last:border-0">
      <h3 className="mb-2 text-balance text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}
