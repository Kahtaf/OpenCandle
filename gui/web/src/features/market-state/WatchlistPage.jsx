import { ListPlus, Pencil, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { cn } from "../../lib/utils.js";
import { buildAlertSentenceRows } from "./alert-view-model.js";
import { quoteFreshness } from "./format.js";
import { buildHoldingRows } from "./portfolio-view-model.js";
import {
  Badge,
  ConfirmButton,
  EmptyState,
  filterItems,
  groupBy,
  groupByOne,
  money,
  moneyOrDash,
  Panel,
  PanelSearch,
  SignedMoney,
  SignedPercent,
  StatusDot,
  Sym,
} from "./shared.jsx";

export function WatchlistPage({ state, filter, setFilter, readOnly, openPanel, invokeTool }) {
  const watchlists = useMemo(
    () =>
      state.watchlists?.length
        ? state.watchlists
        : [{ id: 1, name: "Default", isDefault: true }],
    [state.watchlists],
  );
  const [activeWatchlistId, setActiveWatchlistId] = useState(watchlists[0]?.id ?? null);
  const activeWatchlist =
    watchlists.find((watchlist) => watchlist.id === activeWatchlistId) ?? watchlists[0] ?? null;

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
  const alertsByInstrument = useMemo(() => groupBy(state.alerts, "instrumentId"), [state.alerts]);
  const watchlistItems = useMemo(
    () => (state.watchlist ?? []).filter((item) => item.watchlistId === activeWatchlist?.id),
    [state.watchlist, activeWatchlist],
  );
  const rows = useMemo(
    () => filterItems(watchlistItems, filter, ["symbol", "name"]),
    [watchlistItems, filter],
  );
  const [selectedId, setSelectedId] = useState(null);
  const selected = rows.find((item) => item.id === selectedId) ?? rows[0] ?? null;

  useEffect(() => {
    setSelectedId(null);
    setFilter("");
  }, [activeWatchlist?.id, setFilter]);

  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-1 items-start gap-3",
        selected && "xl:grid-cols-[minmax(0,1fr)_350px]",
      )}
    >
      <Panel
        title="Watchlists"
        count={rows.length}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {watchlistItems.length > 0 ? (
              <PanelSearch label="Search symbols" filter={filter} setFilter={setFilter} />
            ) : null}
            <Button
              type="button"
              variant="brand"
              size="sm"
              rounded="full"
              prefixIcon={Plus}
              disabled={readOnly || !activeWatchlist}
              onClick={() => openPanel("watchlist-add", { watchlist: activeWatchlist })}
            >
              Add ticker
            </Button>
          </div>
        }
      >
        <WatchlistTabs
          watchlists={watchlists}
          activeWatchlist={activeWatchlist}
          counts={countItemsByWatchlist(state.watchlist ?? [])}
          readOnly={readOnly}
          onSelect={setActiveWatchlistId}
          onRename={(watchlist) => openPanel("watchlist-rename", { watchlist })}
        />
        {rows.length === 0 ? (
          <EmptyState
            icon={ListPlus}
            title={watchlistItems.length === 0 ? "No tickers yet" : "No symbols match this search"}
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
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm sm:min-w-[480px]">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Symbol</th>
                  <th className="px-4 py-2 text-right font-medium">Last</th>
                  <th className="px-4 py-2 text-right font-medium">Today</th>
                  <th className="hidden px-4 py-2 font-medium sm:table-cell">Signals</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => {
                  const quote = quotesByItem.get(item.id);
                  const isSelected = selected?.id === item.id;
                  return (
                    <tr
                      key={item.id}
                      aria-selected={isSelected}
                      className={cn(
                        "cursor-pointer border-b border-border/70 last:border-0",
                        isSelected ? "bg-secondary" : "hover:bg-secondary/60",
                      )}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <td className="px-4 py-2.5">
                        <Sym symbol={item.symbol} name={item.name} />
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {quote?.status === "ok" ? money(quote.price) : "-"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <SignedPercent
                          value={quote?.status === "ok" ? quote.changePercent : null}
                        />
                      </td>
                      <td className="hidden px-4 py-2.5 sm:table-cell">
                        <SignalBadge
                          alerts={alertsByInstrument.get(item.instrumentId)}
                          quote={quote}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {selected ? (
        <SymbolInspector
          key={selected.id}
          item={selected}
          watchlist={activeWatchlist}
          quote={quotesByItem.get(selected.id)}
          state={state}
          readOnly={readOnly}
          invokeTool={invokeTool}
        />
      ) : null}
    </div>
  );
}

function WatchlistTabs({ watchlists, activeWatchlist, counts, readOnly, onSelect, onRename }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist">
        {watchlists.map((watchlist) => {
          const active = watchlist.id === activeWatchlist?.id;
          return (
            <button
              key={watchlist.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground",
                active ? "bg-background text-foreground shadow-subtle-xs" : "hover:bg-secondary",
              )}
              onClick={() => onSelect(watchlist.id)}
            >
              <span>{watchlist.name}</span>
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                {counts.get(watchlist.id) ?? 0}
              </span>
            </button>
          );
        })}
      </div>
      {activeWatchlist ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          icon={Pencil}
          title={`Rename ${activeWatchlist.name}`}
          aria-label={`Rename ${activeWatchlist.name}`}
          disabled={readOnly}
          onClick={() => onRename(activeWatchlist)}
        />
      ) : null}
    </div>
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
  if (quote?.stale) return <Badge tone="warn">Stale quote</Badge>;
  const active = (alerts ?? []).filter((alert) => alert.enabled !== false);
  if (active.length === 0) return <Badge>No alerts</Badge>;
  return (
    <Badge tone="ok">
      {active.length} {active.length === 1 ? "alert" : "alerts"}
    </Badge>
  );
}

function SymbolInspector({ item, watchlist, quote, state, readOnly, invokeTool }) {
  const freshness = quoteFreshness(quote);
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
  return (
    <aside
      className="rounded-xl border border-border bg-card shadow-subtle-xs xl:sticky xl:top-4"
      aria-label={`${item.symbol} details`}
    >
      <div className="border-b border-border p-4">
        <Sym symbol={item.symbol} name={[item.name, item.exchange].filter(Boolean).join(" · ")} />
        <div className="mt-2 text-[28px] font-semibold leading-tight tabular-nums text-foreground">
          {quote?.status === "ok" ? money(quote.price) : "-"}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          {quote?.status === "ok" ? <SignedPercent value={quote.changePercent} /> : null}
          <span>
            {quote?.status === "ok" || !quote
              ? freshness.label
              : quote.reason || "Quote unavailable"}
          </span>
          {freshness.stale ? <Badge tone="warn">stale</Badge> : null}
        </div>
      </div>

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

      <div className="flex gap-2 p-4">
        <ConfirmButton
          label="Remove"
          confirmLabel={`Remove ${item.symbol}?`}
          size="sm"
          disabled={readOnly}
          onConfirm={() =>
            invokeTool("manage_watchlist", {
              action: "remove",
              symbol: item.symbol,
              watchlist_name: watchlist?.name,
            })
          }
        />
      </div>
    </aside>
  );
}

function InspectorSection({ title, children }) {
  return (
    <section className="border-b border-border p-4 last:border-0">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}
