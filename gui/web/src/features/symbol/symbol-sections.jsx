import { ArrowDown, ArrowUp, BellPlus } from "lucide-react";
import { Button } from "../../components/ui/button.jsx";
import { buttonVariants } from "../../components/ui/button-variants.js";
import { Skeleton } from "../../components/ui/skeleton.jsx";
import {
  formatCompactMoney,
  formatCompactNumber,
  formatMoney,
  formatNumber,
  formatPercent,
  formatPrice,
  formatQuantity,
} from "../../lib/financial-format.js";
import { cn } from "../../lib/utils.js";
import { degradedQuoteBadge } from "../market-state/format.js";
import {
  Badge,
  ExtendedHoursQuote,
  Panel,
  SignedMoney,
  SignedPercent,
  StatusDot,
} from "../market-state/shared.jsx";
import { levelAlertHref } from "./symbol-actions.js";
import { analyzePromptsForSymbol } from "./symbol-prompts.js";

const ACTION_CLASS =
  "min-h-10 transition-[background-color,color,box-shadow,transform,scale] duration-150 ease-out active:scale-[0.96]";

// Row-level controls stay out of the way on pointer devices and keep a full
// touch target where hovering is not possible. Same rule as the alert rows.
const ROW_ACTION_CLASS =
  "transition-opacity duration-150 ease-out motion-reduce:transition-none md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 md:focus-visible:opacity-100";

const READ_ONLY_NOTE = "Available in the writer window.";

// Trailing space for a row's hover-revealed action, so the number columns in
// the key-levels and trend cards line up with each other in the rail.
const LEVEL_ROW_GUTTER = "pr-12 md:pr-10";

// Shared empty defaults: a fresh array literal per render would make every
// memo comparison downstream miss.
const NO_LEVELS = [];

/**
 * Freshness of the price history a card's figures are calculated from, stated
 * on the card itself so a retained series is never read as today's market.
 */
function HistoryBasisNote({ note, className }) {
  if (!note) return null;
  return (
    <div data-slot="symbol-history-basis-note" className={cn("px-4 pb-3", className)}>
      <Badge tone="warn">{note}</Badge>
    </div>
  );
}

export function SymbolHero({
  ticker,
  quote,
  overview,
  descriptor,
  viewModel,
  basisNote,
  flashClass,
  quoteLoading = false,
  statsLoading = false,
}) {
  if (quoteLoading && !quote) return <HeroSkeleton ticker={ticker} descriptor={descriptor} />;

  // A quote that never arrived says nothing about the listing's currency, so
  // the price and the derived stats stay unlabelled rather than reading as
  // dollars.
  const currency = quote?.currency ?? null;
  const change = quote?.change;
  const direction = change > 0 ? "up" : change < 0 ? "down" : "unchanged";
  const DirectionIcon = direction === "down" ? ArrowDown : ArrowUp;
  const staleBadge = quote?.status === "ok" ? degradedQuoteBadge([quote]) : null;
  // An instrument that never closes says so instead of reporting a session it
  // does not have.
  const sessionLabel = descriptor?.continuousTrading
    ? descriptor.sessionLabel
    : marketStateText(quote?.marketState);
  const hasExtendedQuote =
    !descriptor?.continuousTrading &&
    (quote?.marketState === "PRE" || quote?.marketState === "POST") &&
    Number.isFinite(quote?.extendedPrice);
  const metaLine = [ticker, descriptor?.typeLabel, overview?.exchange].filter(Boolean).join(" · ");

  return (
    <fieldset
      aria-label="Symbol quote"
      aria-labelledby="symbol-heading"
      className="m-0 min-w-0 border-0 p-0"
    >
      <Panel
        headingLevel="h1"
        headingId="symbol-heading"
        headingClassName="grid gap-1 text-xl sm:text-2xl"
        title={
          <>
            <span>{overview?.name || quote?.name || ticker}</span>
            <span className="text-xs font-medium text-muted-foreground">{metaLine}</span>
          </>
        }
      >
        <div className="p-4 sm:p-5">
          <div className={cn("rounded-lg px-1 py-1", flashClass)} data-slot="symbol-price-row">
            <div className="flex flex-wrap items-end gap-3">
              <span className="text-4xl font-semibold leading-none tabular-nums text-foreground sm:text-5xl">
                {formatPrice(quote?.price, currency)}
              </span>
              {currency ? (
                <span className="pb-0.5 text-xs font-medium text-muted-foreground">{currency}</span>
              ) : null}
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
          </div>
          <div
            data-slot="symbol-session-line"
            className="mt-2 flex min-h-7 flex-wrap items-center gap-2 px-1"
          >
            {hasExtendedQuote ? (
              <ExtendedHoursQuote
                quote={quote}
                currency={currency}
                className="mt-0 justify-start"
              />
            ) : sessionLabel ? (
              <Badge>{sessionLabel}</Badge>
            ) : null}
            {staleBadge ? <Badge tone="warn">{staleBadge}</Badge> : null}
          </div>
        </div>
        <HeroStatStrip
          descriptor={descriptor}
          viewModel={viewModel}
          currency={currency}
          basisNote={basisNote}
          loading={statsLoading}
        />
      </Panel>
    </fieldset>
  );
}

/**
 * One horizon-and-context strip under the price. Every entry is read from the
 * view model; a stat the fetched data cannot support is left out of the strip
 * rather than printed as a zero or a dash.
 */
function HeroStatStrip({ descriptor, viewModel, currency, basisNote, loading }) {
  const keys = descriptor?.stats ?? [];
  if (keys.length === 0) return null;
  if (loading) return <StatStripSkeleton count={keys.length} />;

  const returns = new Map((viewModel?.horizonReturns ?? []).map((entry) => [entry.key, entry]));
  const stats = [];
  for (const key of keys) {
    const label = descriptor.statLabels?.[key] ?? key;
    if (key === "dayRange") {
      const range = viewModel?.dayRange;
      if (!range) continue;
      stats.push({
        key,
        label,
        value: `${formatPrice(range.low, currency)} – ${formatPrice(range.high, currency)}`,
      });
      continue;
    }
    if (key === "volume") {
      if (!viewModel?.volumeLabel) continue;
      stats.push({ key, label, value: viewModel.volumeLabel });
      continue;
    }
    const entry = returns.get(key);
    if (!entry) continue;
    stats.push({
      key,
      label,
      value: <SignedPercent value={entry.percent} decimals={1} />,
    });
  }
  if (stats.length === 0) return null;

  return (
    <>
      <dl data-slot="symbol-hero-stats" className={STAT_STRIP_CLASS}>
        {stats.map((stat) => (
          <div data-slot="symbol-stat" className="min-w-0" key={stat.key}>
            <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {stat.label}
            </dt>
            <dd className="mt-1 text-sm font-medium tabular-nums text-foreground">{stat.value}</dd>
          </div>
        ))}
      </dl>
      {/* The horizon returns and the volume multiple above are history, not
          quote, so their freshness is stated with them. */}
      <HistoryBasisNote note={basisNote} className="-mt-1 pb-4 sm:px-5" />
    </>
  );
}

// One grid so the stats line up in columns instead of drifting with each
// value's width. Column counts are chosen so the widest stat, a price range,
// still fits on one line at every width.
const STAT_STRIP_CLASS =
  "grid grid-cols-2 gap-x-6 gap-y-4 border-t border-border px-4 py-4 sm:grid-cols-4 sm:px-5 xl:grid-cols-5";

function StatStripSkeleton({ count }) {
  return (
    <div
      data-slot="symbol-stats-strip-skeleton"
      role="status"
      aria-label="Loading price context"
      className={STAT_STRIP_CLASS}
    >
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder row
        <div className="min-w-0" key={index}>
          <Skeleton className="h-3 w-12" />
          <Skeleton className="mt-2 h-4 w-16" />
        </div>
      ))}
    </div>
  );
}

function HeroSkeleton({ ticker, descriptor }) {
  return (
    <fieldset aria-label="Symbol quote" className="m-0 min-w-0 border-0 p-0">
      {/* The name sits in the panel header on the real hero, so the placeholder
          keeps that header rather than letting the page shift when it arrives. */}
      <Panel
        headingLevel="h1"
        headingClassName="grid gap-1 text-xl sm:text-2xl"
        title={
          <>
            <span className="sr-only">Loading {ticker}</span>
            <Skeleton aria-hidden="true" className="h-6 w-56 max-w-full" />
            <Skeleton aria-hidden="true" className="h-3 w-32" />
          </>
        }
      >
        <div data-slot="symbol-hero-skeleton" role="status" aria-label="Loading symbol quote">
          <div className="p-4 sm:p-5">
            <Skeleton className="h-12 w-72 max-w-full" />
            <Skeleton className="mt-3 h-[22px] w-32" />
          </div>
          <StatStripSkeleton count={Math.max(descriptor?.stats?.length ?? 0, 5)} />
        </div>
      </Panel>
    </fieldset>
  );
}

/**
 * The 52-week range and the moving averages the history can support, each with
 * the distance from the current price and a way to watch it. The alert sheet
 * stays authoritative: the row only hands it the symbol and the level.
 */
export function KeyLevelsCard({
  ticker,
  levels = NO_LEVELS,
  currency,
  role = "writer",
  basisNote,
}) {
  if (levels.length === 0) return null;
  const readOnly = role !== "writer";

  return (
    <fieldset aria-label="Key levels" className="m-0 min-w-0 border-0 p-0">
      <Panel title="Key levels" meta="Calculated from recent price action.">
        {/* The percent says where the level sits relative to the current price,
            which is the opposite reading to the trend card's. Naming the column
            keeps the two cards from looking like they disagree. */}
        {/* Not hidden from assistive technology: read once before the rows, it
            gives them the same column context a sighted reader gets. */}
        <div
          className={cn(
            "flex items-center gap-2 px-4 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
            LEVEL_ROW_GUTTER,
          )}
        >
          <span className="min-w-0 flex-1">Level</span>
          <span className="w-[86px] shrink-0 text-right">Price</span>
          <span className="w-[74px] shrink-0 text-right">From price</span>
        </div>
        <ul className="divide-y divide-border/70 px-4">
          {levels.map((level) => {
            const href = levelAlertHref(ticker, level.value);
            const alertLabel = `Create alert at the ${lowerFirst(level.label)}`;
            return (
              <li className="group flex items-center gap-2 py-2" key={level.key}>
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                  {level.label}
                </span>
                <span className="w-[86px] shrink-0 text-right text-[13px] tabular-nums text-foreground">
                  {/* A level whose currency is unknown is a number, not a
                      dollar amount. */}
                  {formatPrice(level.value, currency)}
                </span>
                <SignedPercent
                  value={level.distancePercent}
                  decimals={1}
                  className="w-[74px] shrink-0 text-right text-[13px]"
                />
                {!readOnly && href ? (
                  <a
                    href={href}
                    aria-label={alertLabel}
                    title={alertLabel}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "icon-xs" }),
                      ROW_ACTION_CLASS,
                      "md:h-8 md:min-h-8 md:w-8 md:min-w-8",
                    )}
                  >
                    <BellPlus aria-hidden="true" />
                  </a>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    disabled
                    aria-label={alertLabel}
                    className="md:h-8 md:min-h-8 md:w-8 md:min-w-8"
                  >
                    <BellPlus aria-hidden="true" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
        <HistoryBasisNote note={basisNote} className="pt-3" />
        {readOnly ? (
          <p className="px-4 pb-4 text-xs text-muted-foreground">{READ_ONLY_NOTE}</p>
        ) : null}
      </Panel>
    </fieldset>
  );
}

/** Placeholder shaped like a rail card of `rows` label-and-value lines. */
function RailCardSkeleton({ title, slot, label, rows }) {
  return (
    <fieldset aria-label={title} className="m-0 min-w-0 border-0 p-0">
      <Panel title={title}>
        <div data-slot={slot} role="status" aria-label={label} className="space-y-4 p-4">
          {Array.from({ length: rows }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length placeholder row
            <div className="flex items-center justify-between gap-3" key={index}>
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3.5 w-16" />
            </div>
          ))}
        </div>
      </Panel>
    </fieldset>
  );
}

export function KeyLevelsSkeleton() {
  return (
    <RailCardSkeleton
      title="Key levels"
      slot="symbol-levels-skeleton"
      label="Loading key levels"
      rows={4}
    />
  );
}

export function TrendSkeleton() {
  return (
    <RailCardSkeleton
      title="Trend summary"
      slot="symbol-trend-skeleton"
      label="Loading trend summary"
      rows={3}
    />
  );
}

/** Price against its moving averages, in plain English, with one sentence. */
export function TrendCard({ trend, basisNote }) {
  const rows = trend?.rows ?? [];
  if (rows.length === 0) return null;

  return (
    <fieldset aria-label="Trend summary" className="m-0 min-w-0 border-0 p-0">
      <Panel title="Trend summary">
        <ul className="divide-y divide-border/70 px-4">
          {rows.map((row) => (
            <li
              className={cn("flex items-center justify-between gap-3 py-2", LEVEL_ROW_GUTTER)}
              key={row.key}
            >
              <span className="min-w-0 truncate text-[13px] text-muted-foreground">
                {row.label}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Badge tone={row.state === "above" ? "ok" : "warn"}>{row.stateLabel}</Badge>
                <SignedPercent
                  value={row.distancePercent}
                  decimals={1}
                  className="w-[74px] text-right text-[13px]"
                />
              </span>
            </li>
          ))}
        </ul>
        {trend?.sentence ? (
          <p className="border-t border-border px-4 py-3 text-[13px] text-muted-foreground">
            {trend.sentence}
          </p>
        ) : null}
        <HistoryBasisNote note={basisNote} className={trend?.sentence ? undefined : "pt-3"} />
      </Panel>
    </fieldset>
  );
}

export function KeyStats({ overview, currency = "USD" }) {
  if (overview?.status !== "ok") return null;
  const stats = [
    ["Market cap", overview.marketCap, (value) => formatCompactMoney(value, currency)],
    ["Trailing P/E", overview.pe, formatDecimal],
    ["Forward P/E", overview.forwardPe, formatDecimal],
    ["EPS", overview.eps, (value) => formatMoney(value, currency)],
    ["Dividend yield", overview.dividendYield, formatRatioPercent],
    ["Beta", overview.beta, formatDecimal],
    ["Average volume", overview.avgVolume, formatCompactNumber],
    ["Profit margin", overview.profitMargin, formatRatioPercent],
    ["Revenue growth", overview.revenueGrowth, formatRatioPercent],
    // The 52-week range belongs to the key levels card, which derives it from
    // the same daily bars every other level on the page comes from. Printing a
    // second figure under the same label here would contradict it.
  ].filter(([, value]) => Number.isFinite(value) && value !== 0);
  if (stats.length === 0) return null;

  return (
    <fieldset aria-label="Key stats" className="m-0 min-w-0 border-0 p-0">
      <Panel title="Key stats">
        {/* Labels line up with the panel title, and the bottom row's hairline
            sits under the card's own border instead of doubling it. */}
        <dl className="-mb-px grid grid-cols-1 gap-x-8 px-4 sm:grid-cols-2 xl:grid-cols-3">
          {stats.map(([label, value, formatter]) => (
            <div
              key={label}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-border/70 py-3"
            >
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
  return formatNumber(value, { maximumFractionDigits: 2 });
}

function formatRatioPercent(value) {
  return formatPercent(value, { decimals: 2, ratio: true });
}

/** The company profile in prose, with the facts that classify the listing. */
export function AboutCard({ overview }) {
  if (overview?.status !== "ok") return null;
  const description = String(overview.description ?? "").trim();
  if (!description) return null;
  const facts = [
    ["Sector", overview.sector],
    ["Industry", overview.industry],
    ["Exchange", overview.exchange],
  ].filter(([, value]) => String(value ?? "").trim());

  return (
    <fieldset aria-label="About" className="m-0 min-w-0 border-0 p-0">
      <Panel title="About">
        <div className="p-4">
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">{description}</p>
          {facts.length ? (
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="mt-1 text-[13px] text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </Panel>
    </fieldset>
  );
}

/** What this page cannot show, stated once instead of left blank. */
export function AvailabilityNote({ note }) {
  if (!note) return null;
  return (
    // Aligned to the card edge rather than inset, so it reads as a note about
    // the column and not as a card with nothing in it.
    <p data-slot="symbol-availability-note" className="text-xs text-muted-foreground">
      {note}
    </p>
  );
}

export function PositionCard({ ticker, positionRows = [] }) {
  const row = positionRows[0];
  // A share of a portfolio only means something inside one portfolio. The same
  // symbol held in two portfolios has two shares that cannot be added, so the
  // line is left out rather than printing their sum.
  const portfolioIds = new Set((row?.lots ?? []).map((lot) => lot?.portfolioId));
  const showAllocation =
    portfolioIds.size === 1 &&
    !row?.excludedFromTotals &&
    Number.isFinite(row?.allocationPercent) &&
    row.allocationPercent > 0;

  return (
    <fieldset aria-label="Position" className="m-0 min-w-0 border-0 p-0">
      <Panel title="Position">
        {row ? (
          <>
            <dl className="divide-y divide-border/70 px-4 text-sm">
              <ContextMetric
                label="Market value"
                detail={`${formatQuantity(row.totalQuantity)} shares @ ${formatMoney(row.blendedCost, row.currency)}`}
                value={moneyOrUnknown(row.marketValue, row.currency)}
              />
              <ContextMetric
                label="Unrealized gain/loss"
                value={
                  Number.isFinite(row.pnl) ? (
                    <SignedMoney value={row.pnl} percent={row.pnlPercent} currency={row.currency} />
                  ) : (
                    <span className="text-muted-foreground">Unknown</span>
                  )
                }
              />
              {showAllocation ? (
                <ContextMetric
                  label="Share of portfolio"
                  value={formatPercent(row.allocationPercent, { decimals: 1 })}
                />
              ) : null}
            </dl>
            {row.excludedFromTotals && row.exclusionReason ? (
              <p className="px-4 pb-4 text-xs text-muted-foreground">{row.exclusionReason}</p>
            ) : null}
          </>
        ) : (
          <p className="p-4 text-sm text-muted-foreground">{ticker} is not held.</p>
        )}
      </Panel>
    </fieldset>
  );
}

function moneyOrUnknown(value, currency) {
  return Number.isFinite(value) ? (
    formatMoney(value, currency)
  ) : (
    <span className="text-muted-foreground">Unknown</span>
  );
}

export function AlertsCard({ ticker, alertRows = [], createAlertHref, role = "writer" }) {
  const readOnly = role !== "writer";
  return (
    <fieldset aria-label="Alerts" className="m-0 min-w-0 border-0 p-0">
      <Panel
        title="Alerts"
        count={alertRows.length}
        actions={
          !readOnly && createAlertHref ? (
            <a
              href={createAlertHref}
              className={cn(buttonVariants({ variant: "bordered", size: "sm" }), ACTION_CLASS)}
            >
              Create alert
            </a>
          ) : (
            <Button type="button" variant="bordered" size="sm" disabled className={ACTION_CLASS}>
              Create alert
            </Button>
          )
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
          <p className="px-4 pb-4 text-xs text-muted-foreground">{READ_ONLY_NOTE}</p>
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
            className={ACTION_CLASS}
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
          <p className="px-4 pb-4 text-xs text-muted-foreground">{READ_ONLY_NOTE}</p>
        ) : null}
      </Panel>
    </fieldset>
  );
}

/**
 * Prompts that open the chat box already written. Nothing is sent: the reader
 * edits and submits, so a chip can hand over an unfinished prompt.
 */
export function AnalyzePanel({ ticker, role = "writer", fillComposer }) {
  const readOnly = role !== "writer";
  return (
    <fieldset aria-label="Analyze" className="m-0 min-w-0 border-0 p-0">
      <Panel title="Analyze" meta="Opens chat with the prompt ready.">
        <div className="flex flex-col gap-2 p-4">
          {analyzePromptsForSymbol(ticker).map(([label, prompt]) => (
            <Button
              key={prompt}
              type="button"
              variant="bordered"
              size="sm"
              disabled={readOnly}
              className={cn(ACTION_CLASS, "justify-start text-left")}
              onClick={() => fillComposer?.(prompt)}
            >
              {label}
            </Button>
          ))}
        </div>
        {readOnly ? (
          <p className="px-4 pb-4 text-xs text-muted-foreground">{READ_ONLY_NOTE}</p>
        ) : null}
      </Panel>
    </fieldset>
  );
}

function ContextMetric({ label, detail, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="min-w-0 text-muted-foreground">
        {label}
        {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
      </dt>
      <dd className="text-right tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function lowerFirst(value) {
  const text = String(value ?? "");
  return text ? text[0].toLowerCase() + text.slice(1) : text;
}

function marketStateText(marketState) {
  if (marketState === "REGULAR") return "Regular market";
  if (marketState === "PRE") return "Pre-market";
  if (marketState === "POST") return "After hours";
  if (marketState === "CLOSED") return "Market closed";
  return null;
}
