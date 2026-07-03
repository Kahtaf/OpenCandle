import { ListPlus } from "lucide-react";
import { useMemo, useState } from "react";
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
  const quotesByItem = useMemo(
    () => groupByOne(state.quoteSnapshot?.watchlistQuotes, "itemId"),
    [state.quoteSnapshot],
  );
  const alertsByInstrument = useMemo(() => groupBy(state.alerts, "instrumentId"), [state.alerts]);
  const rows = useMemo(
    () => filterItems(state.watchlist, filter, ["symbol", "name", "thesis", "notes", "tags"]),
    [state.watchlist, filter],
  );
  const [selectedId, setSelectedId] = useState(null);
  const selected = rows.find((item) => item.id === selectedId) ?? rows[0] ?? null;

  return (
    <div
      className={cn(
        "grid min-w-0 grid-cols-1 items-start gap-3",
        selected && "xl:grid-cols-[minmax(0,1fr)_350px]",
      )}
    >
      <Panel
        title="Watchlist"
        count={rows.length}
        actions={
          state.watchlist.length > 0 ? (
            <PanelSearch label="Search symbols" filter={filter} setFilter={setFilter} />
          ) : null
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            icon={ListPlus}
            title={state.watchlist.length === 0 ? "No tickers yet" : "No symbols match this search"}
            action="Add a ticker to start the watchlist, then keep thesis, targets, stops, and alerts on its row."
            cta={{
              label: "Add ticker",
              disabled: readOnly,
              onClick: () => openPanel("watchlist-add"),
            }}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm sm:min-w-[560px]">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Symbol</th>
                  <th className="px-4 py-2 text-right font-medium">Last</th>
                  <th className="px-4 py-2 text-right font-medium">Today</th>
                  <th className="hidden px-4 py-2 text-right font-medium sm:table-cell">
                    To target
                  </th>
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
                        {quote?.status === "ok" ? money(quote.price) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <SignedPercent
                          value={quote?.status === "ok" ? quote.changePercent : null}
                        />
                      </td>
                      <td className="hidden px-4 py-2.5 text-right tabular-nums text-muted-foreground sm:table-cell">
                        {toTargetLabel(item, quote)}
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
          quote={quotesByItem.get(selected.id)}
          state={state}
          readOnly={readOnly}
          openPanel={openPanel}
          invokeTool={invokeTool}
        />
      ) : null}
    </div>
  );
}

function toTargetLabel(item, quote) {
  if (typeof item.targetPrice !== "number") return "No target";
  if (quote?.status !== "ok" || typeof quote.price !== "number" || quote.price <= 0) {
    return money(item.targetPrice);
  }
  const percent = ((item.targetPrice - quote.price) / quote.price) * 100;
  const sign = percent > 0 ? "+" : percent < 0 ? "−" : "";
  return `${sign}${Math.abs(percent).toFixed(1)}% to ${money(item.targetPrice)}`;
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

function SymbolInspector({ item, quote, state, readOnly, openPanel, invokeTool }) {
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
          {quote?.status === "ok" ? money(quote.price) : "—"}
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
        <TargetRange item={item} quote={quote} />
      </div>

      {item.thesis || item.tags?.length ? (
        <InspectorSection title="Thesis">
          {item.thesis ? (
            <p className="text-[13px] leading-5 text-foreground">{item.thesis}</p>
          ) : null}
          {item.tags?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          ) : null}
        </InspectorSection>
      ) : null}

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
        <Button
          type="button"
          variant="bordered"
          size="sm"
          className="mt-3 w-full"
          disabled={readOnly || item.targetPrice == null}
          onClick={() =>
            invokeTool("manage_alerts", {
              action: "create_price_above",
              symbol: item.symbol,
              threshold: item.targetPrice,
            })
          }
        >
          {item.targetPrice == null
            ? "Set a target to enable alerts"
            : `Alert at target ${money(item.targetPrice)}`}
        </Button>
      </InspectorSection>

      <div className="flex gap-2 p-4">
        <Button
          type="button"
          variant="bordered"
          size="sm"
          className="flex-1"
          disabled={readOnly}
          onClick={() => openPanel("watchlist-edit", { item })}
        >
          Edit
        </Button>
        <ConfirmButton
          label="Remove"
          confirmLabel={`Remove ${item.symbol}?`}
          size="sm"
          disabled={readOnly}
          onConfirm={() =>
            invokeTool("manage_watchlist", { action: "remove", symbol: item.symbol })
          }
        />
      </div>
    </aside>
  );
}

function TargetRange({ item, quote }) {
  const target = item.targetPrice;
  const stop = item.stopPrice;
  if (typeof target !== "number" && typeof stop !== "number") return null;
  const price = quote?.status === "ok" ? quote.price : null;
  const low =
    typeof stop === "number" ? stop : Math.min(price ?? target, target ?? price ?? 0) * 0.8;
  const high =
    typeof target === "number" ? target : Math.max(price ?? stop, stop ?? price ?? 0) * 1.2;
  const span = high - low;
  const position =
    price != null && span > 0 ? Math.min(1, Math.max(0, (price - low) / span)) : null;

  return (
    <div className="mt-3">
      <div className="relative h-[5px] rounded-full bg-tertiary">
        {position != null ? (
          <>
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-hard"
              style={{ width: `${position * 100}%` }}
            />
            <div
              className="absolute top-[-3px] h-[11px] w-[2px] rounded-sm bg-foreground"
              style={{ left: `${position * 100}%` }}
            />
          </>
        ) : null}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{typeof stop === "number" ? `Stop ${money(stop)}` : ""}</span>
        <span>{typeof target === "number" ? `Target ${money(target)}` : ""}</span>
      </div>
    </div>
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

