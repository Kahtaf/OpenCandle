import { Skeleton } from "../../components/ui/skeleton.jsx";
import { degradedQuoteBadge } from "../market-state/format.js";
import { derivePortfolioDayMove } from "../market-state/portfolio-view-model.js";
import { Badge, money, Panel } from "../market-state/shared.jsx";
import { DeltaChip } from "../renderers/cards/_shared.jsx";

const HEADING_ID = "home-portfolio-heading";
const EMPTY_PORTFOLIOS = [];

export function PortfolioSummaryStrip({
  portfolios = EMPTY_PORTFOLIOS,
  quoteSnapshot,
  nowMs = Date.now(),
}) {
  const loading = portfolios.length > 0 && quoteSnapshot == null;
  const summaries = quoteSnapshot?.portfolioSummaries ?? [];
  const totals = sumPortfolioSummaries(summaries);
  const dayMove = derivePortfolioDayMove(quoteSnapshot?.portfolioQuotes ?? []);
  const freshness = quoteSnapshot
    ? degradedQuoteBadge(quoteSnapshot.portfolioQuotes ?? [], nowMs)
    : null;

  return (
    <section aria-labelledby={HEADING_ID} data-slot="home-portfolio-summary">
      <Panel
        title={<span id={HEADING_ID}>Portfolio</span>}
        meta={freshness ? <Badge tone="warn">{freshness}</Badge> : null}
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
        ) : (
          <div className="grid min-h-[152px] grid-cols-1 gap-3 p-4 sm:grid-cols-3">
            <div className="rounded-md bg-secondary px-3 py-3">
              <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                Total value
              </div>
              <div className="mt-1 truncate tabular-nums text-2xl font-semibold tracking-tight text-foreground">
                {money(totals.totalValue, totals.currency)}
              </div>
            </div>
            <div className="rounded-md bg-secondary px-3 py-3">
              <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                Today&apos;s move
              </div>
              <div className="mt-2">
                {dayMove == null ? (
                  <span className="text-sm font-medium text-muted-foreground">Unavailable</span>
                ) : (
                  <DeltaChip value={dayMove} prefix="$" size="lg" />
                )}
              </div>
            </div>
            <div className="rounded-md bg-secondary px-3 py-3">
              <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
                All-time P&amp;L
              </div>
              <div className="mt-2">
                <DeltaChip
                  value={totals.totalPnl}
                  percent={totals.totalPnlPercent}
                  prefix="$"
                  size="lg"
                />
              </div>
            </div>
          </div>
        )}
      </Panel>
    </section>
  );
}

function sumPortfolioSummaries(summaries) {
  let totalValue = 0;
  let totalCost = 0;
  let totalPnl = 0;
  let hasValue = false;
  let hasCost = false;
  let hasPnl = false;
  for (const summary of summaries) {
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
    currency: summaries.find((summary) => summary?.currency)?.currency ?? "USD",
  };
}
