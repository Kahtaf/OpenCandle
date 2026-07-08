import { BriefcaseBusiness, ChevronDown, ChevronRight, Pencil, Plus } from "lucide-react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { cn } from "../../lib/utils.js";
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
}) {
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
  const summary =
    state.quoteSnapshot?.portfolioSummaries?.find(
      (candidate) => candidate.portfolioId === activePortfolio?.id,
    ) ??
    (activePortfolio?.isDefault ? state.quoteSnapshot?.portfolioSummary : null);
  const [expanded, setExpanded] = useState(() => new Set());

  const toggleExpanded = (symbol) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const lotCount = activeLots.length;
  const portfolioCounts = useMemo(
    () => countLotsByPortfolio(state.portfolio ?? []),
    [state.portfolio],
  );
  const addHolding = () => openPanel("holding-add", { portfolio: activePortfolio });

  return (
    <div className="flex flex-col gap-3">
      <Panel
        title="Portfolios"
        meta={`${lotCount} ${lotCount === 1 ? "lot" : "lots"}`}
        actions={
          <Button
            type="button"
            variant="brand"
            size="sm"
            rounded="full"
            prefixIcon={Plus}
            disabled={readOnly}
            onClick={addHolding}
          >
            Add holding
          </Button>
        }
      >
        <PortfolioTabs
          portfolios={portfolios}
          activePortfolio={activePortfolio}
          counts={portfolioCounts}
          readOnly={readOnly}
          onSelect={setActivePortfolioId}
          onRename={(portfolio) => openPanel("portfolio-rename", { portfolio })}
        />
        {lotCount === 0 ? (
          <EmptyState
            icon={BriefcaseBusiness}
            title="No holdings yet"
            action="Add a holding when you are ready, or keep using watchlists without a portfolio."
          />
        ) : null}
      </Panel>

      {lotCount > 0 ? <ValueHeader summary={summary} holdings={holdings} /> : null}
      {lotCount > 0 ? (
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
                                  portfolio={activePortfolio}
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
                                  portfolio={activePortfolio}
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
      ) : null}
    </div>
  );
}

function PortfolioTabs({ portfolios, activePortfolio, counts, readOnly, onSelect, onRename }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto" role="tablist">
        {portfolios.map((portfolio) => {
          const active = portfolio.id === activePortfolio?.id;
          return (
            <button
              key={portfolio.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={cn(
                "inline-flex h-8 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground",
                active ? "bg-background text-foreground shadow-subtle-xs" : "hover:bg-secondary",
              )}
              onClick={() => onSelect(portfolio.id)}
            >
              <span>{portfolio.name}</span>
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
                {counts.get(portfolio.id) ?? 0}
              </span>
            </button>
          );
        })}
      </div>
      {activePortfolio ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          icon={Pencil}
          title={`Rename ${activePortfolio.name}`}
          aria-label={`Rename ${activePortfolio.name}`}
          disabled={readOnly}
          onClick={() => onRename(activePortfolio)}
        />
      ) : null}
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
