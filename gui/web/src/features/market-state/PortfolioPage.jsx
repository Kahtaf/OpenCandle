import { BriefcaseBusiness, ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { shortDateLabel } from "./format.js";
import { buildHoldingRows } from "./portfolio-view-model.js";
import {
  ConfirmButton,
  EmptyState,
  filterItems,
  money,
  moneyOrDash,
  Panel,
  PanelSearch,
  SignedMoney,
  SignedPercent,
  Sym,
} from "./shared.jsx";

const ALLOCATION_RAMP = ["#18181b", "#52525b", "#71717a", "#a1a1aa", "#d4d4d8", "#e4e4e7"];

export function PortfolioPage({
  state,
  filter,
  setFilter,
  readOnly,
  openPanel,
  invokeTool,
  navigate,
}) {
  const holdings = useMemo(
    () => buildHoldingRows(state.portfolio ?? [], state.quoteSnapshot?.portfolioQuotes ?? []),
    [state.portfolio, state.quoteSnapshot],
  );
  const rows = useMemo(
    () => filterItems(holdings, filter, ["symbol", "name", "currency"]),
    [holdings, filter],
  );
  const summary = state.quoteSnapshot?.portfolioSummary;
  const [expanded, setExpanded] = useState(() => new Set());

  const toggleExpanded = (symbol) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const lotCount = (state.portfolio ?? []).length;

  if (lotCount === 0) {
    return (
      <Panel title="Holdings">
        <EmptyState
          icon={BriefcaseBusiness}
          title="No holdings yet"
          action="Add a holding when you are ready, or keep using watchlists without a portfolio."
          cta={{ label: "Skip For Now", onClick: () => navigate?.({ to: "/watchlists" }) }}
        />
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <ValueHeader summary={summary} holdings={holdings} />
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
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm md:min-w-[700px]">
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  <th className="w-8 px-2 py-2" aria-label="Expand" />
                  <th className="px-2 py-2 font-medium">Symbol</th>
                  <th className="hidden px-2 py-2 text-right font-medium md:table-cell">Qty</th>
                  <th className="hidden px-2 py-2 text-right font-medium md:table-cell">Last</th>
                  <th className="px-2 py-2 text-right font-medium">Value</th>
                  <th className="px-2 py-2 text-right font-medium">Today</th>
                  <th className="hidden px-2 py-2 text-right font-medium sm:table-cell">
                    Total return
                  </th>
                  <th className="hidden px-2 py-2 pr-4 text-right font-medium md:table-cell">
                    Weight
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <Fragment key={row.symbol}>
                    <tr
                      className="cursor-pointer border-b border-border/70 last:border-0 hover:bg-secondary/60"
                      onClick={() => toggleExpanded(row.symbol)}
                    >
                      <td className="px-2 py-2.5">
                        <button
                          type="button"
                          className="inline-flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-secondary"
                          aria-expanded={expanded.has(row.symbol)}
                          aria-label={`${expanded.has(row.symbol) ? "Collapse" : "Expand"} ${row.symbol} lots`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleExpanded(row.symbol);
                          }}
                        >
                          {expanded.has(row.symbol) ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5" />
                          )}
                        </button>
                      </td>
                      <td className="px-2 py-2.5">
                        <Sym symbol={row.symbol} name={row.name} />
                      </td>
                      <td className="hidden px-2 py-2.5 text-right tabular-nums md:table-cell">
                        {row.totalQuantity.toLocaleString()}
                      </td>
                      <td className="hidden px-2 py-2.5 text-right tabular-nums md:table-cell">
                        {moneyOrDash(row.currentPrice, row.currency)}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums">
                        {moneyOrDash(row.marketValue, row.currency)}
                      </td>
                      <td className="px-2 py-2.5 text-right">
                        <SignedPercent value={row.changePercent} />
                      </td>
                      <td className="hidden px-2 py-2.5 text-right sm:table-cell">
                        <SignedMoney
                          value={row.pnl}
                          percent={row.pnlPercent}
                          currency={row.currency}
                        />
                      </td>
                      <td className="hidden px-2 py-2.5 pr-4 text-right tabular-nums md:table-cell">
                        {typeof row.allocationPercent === "number"
                          ? `${row.allocationPercent.toFixed(1)}%`
                          : "—"}
                      </td>
                    </tr>
                    {expanded.has(row.symbol)
                      ? row.lots.map((lot) => (
                          <tr
                            key={lot.id}
                            className="border-b border-border/70 bg-secondary/60 text-[13px] last:border-0"
                          >
                            <td className="px-2 py-2" />
                            <td className="px-2 py-2">
                              <div className="font-mono text-xs text-muted-foreground">
                                Lot · {shortDateLabel(lot.openedAt) || "—"}
                                {lot.notes ? ` · ${lot.notes}` : ""}
                              </div>
                              <div className="mt-0.5 font-mono text-xs text-muted-foreground md:hidden">
                                {lot.quantity.toLocaleString()} @ {money(lot.avgCost, lot.currency)}
                              </div>
                              <div className="mt-1 flex gap-1 md:hidden">
                                <LotActions
                                  lot={lot}
                                  readOnly={readOnly}
                                  openPanel={openPanel}
                                  invokeTool={invokeTool}
                                />
                              </div>
                            </td>
                            <td className="hidden px-2 py-2 text-right tabular-nums md:table-cell">
                              {lot.quantity.toLocaleString()}
                            </td>
                            <td className="hidden px-2 py-2 text-right font-mono text-xs text-muted-foreground md:table-cell">
                              cost {money(lot.avgCost, lot.currency)}
                            </td>
                            <td className="px-2 py-2 text-right tabular-nums">
                              {moneyOrDash(lot.quote?.marketValue, lot.currency)}
                            </td>
                            <td className="px-2 py-2" />
                            <td className="hidden px-2 py-2 text-right sm:table-cell">
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
                            <td className="hidden px-2 py-2 pr-4 text-right md:table-cell">
                              <div className="flex justify-end gap-1">
                                <LotActions
                                  lot={lot}
                                  readOnly={readOnly}
                                  openPanel={openPanel}
                                  invokeTool={invokeTool}
                                />
                              </div>
                            </td>
                          </tr>
                        ))
                      : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {summary?.excludedFromTotals?.length ? (
          <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
            Excluded from totals:{" "}
            {summary.excludedFromTotals.map((row) => `${row.symbol} (${row.reason})`).join(", ")}
          </p>
        ) : null}
      </Panel>
    </div>
  );
}

function LotActions({ lot, readOnly, openPanel, invokeTool }) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={readOnly}
        onClick={() => openPanel("holding-edit", { lot })}
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

function ValueHeader({ summary, holdings }) {
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
      color: ALLOCATION_RAMP[Math.min(index, ALLOCATION_RAMP.length - 1)],
    }));

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-subtle-xs sm:p-5">
      <div className="text-[32px] font-semibold leading-tight tabular-nums text-foreground">
        {summary ? money(summary.totalValue, summary.baseCurrency) : "—"}
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
          <div className="mt-4 flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden="true">
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
