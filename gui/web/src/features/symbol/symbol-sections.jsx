import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "../../components/ui/button.jsx";
import { cn } from "../../lib/utils.js";
import { degradedQuoteBadge } from "../market-state/format.js";
import { formatLargeNumber } from "../renderers/cards/card-format.js";
import {
  Badge,
  ExtendedHoursQuote,
  formatNumber,
  money,
  Panel,
  SignedMoney,
  SignedPercent,
  StatusDot,
} from "../market-state/shared.jsx";

export function SymbolHeader({ ticker, quote, overview, flashClass }) {
  const currency = quote?.currency ?? "USD";
  const change = quote?.change;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "unchanged";
  const DirectionIcon = direction === "down" ? ArrowDown : ArrowUp;
  const staleBadge = quote?.status === "ok" ? degradedQuoteBadge([quote]) : null;
  const marketStateLabel = marketStateText(quote?.marketState);

  return (
    <fieldset
      aria-label="Symbol quote"
      aria-labelledby="symbol-heading"
      className="m-0 min-w-0 border-0 p-0"
    >
      <Panel>
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1
              id="symbol-heading"
              className="text-balance text-xl font-semibold text-foreground sm:text-2xl"
            >
              {overview?.name || quote?.name || ticker}{" "}
              <span className="text-muted-foreground">({ticker})</span>
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              {marketStateLabel ? <Badge>{marketStateLabel}</Badge> : null}
              {staleBadge ? <Badge tone="warn">{staleBadge}</Badge> : null}
            </div>
          </div>
          <div className={cn("mt-5 rounded-md px-1 py-1", flashClass)} data-slot="symbol-price-row">
            <div className="flex flex-wrap items-end gap-3">
              <span className="text-4xl font-semibold leading-none tabular-nums text-foreground sm:text-5xl">
                {money(quote?.price, currency)}
              </span>
              <span className="pb-0.5 text-xs font-medium text-muted-foreground">{currency}</span>
              {quote?.status === "ok" && Number.isFinite(change) ? (
                <span
                  className={cn(
                    "inline-flex min-h-7 items-center gap-1 rounded-md border px-2 text-sm tabular-nums",
                    change > 0
                      ? "border-success/30 bg-success/10 text-success"
                      : change < 0
                        ? "border-destructive/30 bg-destructive/10 text-destructive"
                        : "border-border bg-secondary text-muted-foreground",
                  )}
                >
                  <span className="sr-only">Price moved {direction}: </span>
                  <DirectionIcon className="size-3.5" aria-hidden="true" />
                  <SignedMoney value={change} currency={currency} />
                  <SignedPercent value={quote.changePercent} />
                </span>
              ) : null}
            </div>
            <ExtendedHoursQuote quote={quote} currency={currency} className="justify-start" />
          </div>
        </div>
      </Panel>
    </fieldset>
  );
}

export function KeyStats({ overview, currency = "USD" }) {
  if (overview?.status !== "ok") return null;
  const stats = [
    ["Market cap", overview.marketCap, (value) => `$${formatLargeNumber(value)}`],
    ["Trailing P/E", overview.pe, formatDecimal],
    ["Forward P/E", overview.forwardPe, formatDecimal],
    ["EPS", overview.eps, (value) => money(value, currency)],
    ["Dividend yield", overview.dividendYield, formatRatioPercent],
    ["Beta", overview.beta, formatDecimal],
    ["Average volume", overview.avgVolume, formatNumber],
    ["Profit margin", overview.profitMargin, formatRatioPercent],
    ["Revenue growth", overview.revenueGrowth, formatRatioPercent],
    ["52-week high", overview.week52High, (value) => money(value, currency)],
    ["52-week low", overview.week52Low, (value) => money(value, currency)],
  ].filter(([, value]) => Number.isFinite(value) && value !== 0);
  if (stats.length === 0) return null;

  return (
    <fieldset aria-label="Key stats" className="m-0 min-w-0 border-0 p-0">
      <Panel title="Key stats">
        <dl className="divide-y divide-border/70 px-4">
          {stats.map(([label, value, formatter]) => (
            <div key={label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-3">
              <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
              <dd className="text-right tabular-nums text-sm text-foreground">
                {formatter(value)}
              </dd>
            </div>
          ))}
        </dl>
      </Panel>
    </fieldset>
  );
}

function formatDecimal(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function formatRatioPercent(value) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(value);
}

export function PositionCard({ ticker, positionRows = [] }) {
  const row = positionRows[0];
  return (
    <fieldset aria-label="Position" className="m-0 min-w-0 border-0 p-0">
      <Panel title="Position">
        {row ? (
          <dl className="divide-y divide-border/70 px-4 text-sm">
            <ContextMetric
              label={`${row.totalQuantity.toLocaleString()} shares @ ${money(row.blendedCost, row.currency)}`}
              value={money(row.marketValue, row.currency)}
            />
            <ContextMetric
              label="Unrealized gain/loss"
              value={
                <SignedMoney value={row.pnl} percent={row.pnlPercent} currency={row.currency} />
              }
            />
          </dl>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No saved position in {ticker}.</p>
        )}
      </Panel>
    </fieldset>
  );
}

export function AlertsCard({ ticker, alertRows = [], onCreateAlert, role = "writer" }) {
  const readOnly = role !== "writer";
  return (
    <fieldset aria-label="Alerts" className="m-0 min-w-0 border-0 p-0">
      <Panel
        title="Alerts"
        count={alertRows.length}
        actions={
          <Button
            type="button"
            variant="bordered"
            size="sm"
            disabled={readOnly}
            className="min-h-10 active:scale-[0.96] transition-[background-color,color,box-shadow,scale]"
            onClick={onCreateAlert}
          >
            Create alert
          </Button>
        }
      >
        {alertRows.length ? (
          <ul className="divide-y divide-border/70 px-4">
            {alertRows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-3">
                <StatusDot tone={row.tone} label={row.sentence} />
                <span className="text-xs text-muted-foreground">
                  {row.enabled ? "Armed" : "Paused"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">No alerts for {ticker} yet.</p>
        )}
        {readOnly ? (
          <p className="px-4 pb-4 text-xs text-muted-foreground">Available in the writer window.</p>
        ) : null}
      </Panel>
    </fieldset>
  );
}

export function WatchlistMembership({ ticker, memberships = [], role = "writer", onAdd }) {
  const readOnly = role !== "writer";
  return (
    <fieldset aria-label="Watchlist membership" className="m-0 min-w-0 border-0 p-0">
      <Panel
        title="Watchlist membership"
        actions={
          <Button
            type="button"
            variant="bordered"
            size="sm"
            disabled={readOnly || memberships.length > 0}
            className="min-h-10 active:scale-[0.96] transition-[background-color,color,box-shadow,scale]"
            onClick={onAdd}
          >
            Add to watchlist
          </Button>
        }
      >
        {memberships.length ? (
          <ul className="divide-y divide-border/70 px-4">
            {memberships.map((membership) => (
              <li key={membership.id} className="py-3 text-sm text-foreground">
                {membership.watchlistName}
              </li>
            ))}
          </ul>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{ticker} is not in a watchlist yet.</p>
        )}
        {readOnly ? (
          <p className="px-4 pb-4 text-xs text-muted-foreground">Available in the writer window.</p>
        ) : null}
      </Panel>
    </fieldset>
  );
}

export function analyzePromptsForSymbol(ticker) {
  const symbol = ticker.trim().toUpperCase();
  return [
    [`What is ${symbol} trading at?`, `What is ${symbol} trading at?`],
    [`Options chain for ${symbol}`, `Show options chain for ${symbol}`],
    [`Deep research: ${symbol} (multi-analyst, takes a few minutes)`, `/analyze ${symbol}`],
  ];
}

export function AnalyzePanel({ ticker, role = "writer", startChatRun }) {
  const readOnly = role !== "writer";
  return (
    <fieldset aria-label="Analyze" className="m-0 min-w-0 border-0 p-0">
      <Panel title="Analyze">
        <div className="flex flex-wrap gap-2 p-4">
          {analyzePromptsForSymbol(ticker).map(([label, prompt]) => (
            <Button
              key={prompt}
              type="button"
              variant="bordered"
              size="sm"
              disabled={readOnly}
              className="min-h-10 active:scale-[0.96] transition-[background-color,color,box-shadow,scale] duration-150 ease-out"
              onClick={() => startChatRun?.(prompt)}
            >
              {label}
            </Button>
          ))}
        </div>
        {readOnly ? (
          <p className="px-4 pb-4 text-xs text-muted-foreground">
            Analysis is available in the writer window.
          </p>
        ) : null}
      </Panel>
    </fieldset>
  );
}

function ContextMetric({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function marketStateText(marketState) {
  if (marketState === "REGULAR") return "Regular market";
  if (marketState === "PRE") return "Pre-market session";
  if (marketState === "POST") return "After-hours session";
  if (marketState === "CLOSED") return "Market closed";
  return null;
}
