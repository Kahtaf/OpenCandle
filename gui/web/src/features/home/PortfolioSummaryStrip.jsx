import { Skeleton } from "../../components/ui/skeleton.jsx";
import { formatMoney } from "../../lib/financial-format.js";
import { degradedQuoteBadge, quoteFreshnessTitle } from "../market-state/format.js";
import { derivePortfolioDayMove } from "../market-state/portfolio-view-model.js";
import { Badge, Panel, SignedMoney } from "../market-state/shared.jsx";

const HEADING_ID = "home-portfolio-heading";
const EMPTY_PORTFOLIOS = [];

export function PortfolioSummaryStrip({
  portfolios = EMPTY_PORTFOLIOS,
  quoteSnapshot,
  nowMs = Date.now(),
  timeZone,
}) {
  const loading = portfolios.length > 0 && quoteSnapshot == null;
  const summaries = quoteSnapshot?.portfolioSummaries ?? [];
  const totals = sumPortfolioSummaries(summaries, quoteSnapshot?.portfolioSummary?.baseCurrency);
  const portfolioIds = new Set(totals.portfolioIds);
  const selectedPortfolioQuotes = (quoteSnapshot?.portfolioQuotes ?? []).filter(
    (quote) =>
      (totals.portfolioIds.length <= 1 && quote.portfolioId == null) ||
      portfolioIds.has(quote.portfolioId),
  );
  const selectedQuotes = selectedPortfolioQuotes.filter(
    (quote) => quote.includedInTotals !== false,
  );
  const valuationAvailable =
    selectedPortfolioQuotes.length === 0 ||
    selectedPortfolioQuotes.every(
      (quote) =>
        quote.includedInTotals !== false &&
        quote.status !== "unavailable" &&
        Number.isFinite(quote.marketValue),
    );
  const dayMove = derivePortfolioDayMove(selectedQuotes);
  const selectedMarketValue = selectedQuotes.reduce(
    (total, quote) => total + (Number.isFinite(quote.marketValue) ? quote.marketValue : 0),
    0,
  );
  const priorDayValue = dayMove == null ? null : selectedMarketValue - dayMove;
  const dayMovePercent =
    dayMove != null && priorDayValue > 0 ? (dayMove / priorDayValue) * 100 : null;
  const freshness = quoteSnapshot
    ? degradedQuoteBadge(quoteSnapshot.portfolioQuotes ?? [], nowMs)
    : null;
  const freshnessTitle = quoteFreshnessTitle(quoteSnapshot?.portfolioQuotes ?? [], timeZone);

  return (
    <section aria-labelledby={HEADING_ID} data-slot="home-portfolio-summary">
      <Panel
        title={<span id={HEADING_ID}>Portfolio</span>}
        meta={
          freshness || totals.excludedCurrencies.length > 0 ? (
            <span className="flex flex-wrap gap-2">
              {freshness ? (
                <Badge tone="warn" title={freshnessTitle}>
                  {freshness}
                </Badge>
              ) : null}
              {totals.excludedCurrencies.length > 0 ? (
                <Badge tone="warn">
                  {totals.excludedCurrencies.join(", ")} portfolios excluded
                </Badge>
              ) : null}
            </span>
          ) : null
        }
      >
        {loading ? (
          <div
            className="grid min-h-[152px] grid-cols-1 gap-3 p-4 sm:grid-cols-3"
            data-slot="home-portfolio-skeleton"
          >
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : portfolios.length === 0 ? (
          <div className="flex min-h-[152px] items-center px-4 py-6 text-sm text-muted-foreground">
            No portfolios tracked yet.
          </div>
        ) : !valuationAvailable ? (
          <div className="flex min-h-[152px] items-center px-4 py-6 text-sm text-muted-foreground">
            Portfolio valuation unavailable
          </div>
        ) : (
          <div className="grid min-h-[152px] grid-cols-1 gap-3 p-4 sm:grid-cols-3">
            <div className="rounded-lg bg-secondary px-3 py-3">
              <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                Total value
              </div>
              <div className="mt-1 truncate tabular-nums text-2xl font-semibold tracking-tight text-foreground">
                {formatMoney(totals.totalValue, totals.currency)}
              </div>
            </div>
            <div className="rounded-lg bg-secondary px-3 py-3">
              <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                Today&apos;s move
              </div>
              <div className="mt-2">
                {dayMove == null || !Number.isFinite(dayMovePercent) ? (
                  <span className="text-sm font-medium text-muted-foreground">Unavailable</span>
                ) : (
                  <SignedMoney
                    value={dayMove}
                    percent={dayMovePercent}
                    currency={totals.currency}
                  />
                )}
              </div>
            </div>
            <div className="rounded-lg bg-secondary px-3 py-3">
              <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                All-time P&amp;L
              </div>
              <div className="mt-2">
                {Number.isFinite(totals.totalPnl) && Number.isFinite(totals.totalPnlPercent) ? (
                  <SignedMoney
                    value={totals.totalPnl}
                    percent={totals.totalPnlPercent}
                    currency={totals.currency}
                  />
                ) : (
                  <span className="text-sm font-medium text-muted-foreground">Unavailable</span>
                )}
              </div>
            </div>
          </div>
        )}
      </Panel>
    </section>
  );
}

function sumPortfolioSummaries(summaries, primaryCurrency) {
  const groups = new Map();
  for (const summary of summaries) {
    const currency = summary?.baseCurrency ?? "USD";
    const group = groups.get(currency) ?? [];
    group.push(summary);
    groups.set(currency, group);
  }
  const fallbackCurrency = groups.keys().next().value ?? "USD";
  const currency = groups.has(primaryCurrency) ? primaryCurrency : fallbackCurrency;
  const selected = groups.get(currency) ?? [];
  let totalValue = 0;
  let totalCost = 0;
  let totalPnl = 0;
  let hasValue = false;
  let hasCost = false;
  let hasPnl = false;
  for (const summary of selected) {
    if (Number.isFinite(summary?.totalValue)) {
      totalValue += summary.totalValue;
      hasValue = true;
    }
    if (Number.isFinite(summary?.totalCost)) {
      totalCost += summary.totalCost;
      hasCost = true;
    }
    if (Number.isFinite(summary?.totalPnl)) {
      totalPnl += summary.totalPnl;
      hasPnl = true;
    }
  }
  const basis = hasCost ? totalCost : hasValue && hasPnl ? totalValue - totalPnl : null;
  return {
    totalValue: hasValue ? totalValue : null,
    totalPnl: hasPnl ? totalPnl : null,
    totalPnlPercent: basis > 0 && hasPnl ? (totalPnl / basis) * 100 : null,
    currency,
    portfolioIds: selected.flatMap((summary) =>
      summary?.portfolioId == null ? [] : [summary.portfolioId],
    ),
    excludedCurrencies: [...groups.keys()].filter((candidate) => candidate !== currency),
  };
}
