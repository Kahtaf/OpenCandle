// biome-ignore-all lint/a11y/noStaticElementInteractions: pointer tracking only reveals read-only chart detail.

import { lazy, Suspense, useMemo, useState } from "react";
import { SERIES_COLORS } from "../../../lib/series-colors.js";
import { PlainOutput, ToolCard, WarningRow } from "./_shared.jsx";
import { extractDetails } from "./card-format.js";
import { formatRawClose } from "./price-comparison-format.js";

const MarketChart = lazy(() =>
  import("../../../components/market-chart.jsx").then(({ MarketChart: Component }) => ({
    default: Component,
  })),
);

const ET_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function PriceComparisonCard({ message, header, text }) {
  const details = extractDetails(message);
  const sourceSeries = Array.isArray(details?.series) ? details.series : [];
  const series = useMemo(
    () =>
      sourceSeries.map((item) => ({
        symbol: item.symbol,
        indexed: item.indexed,
        bars: Array.isArray(item.bars) ? item.bars.map(toChartBar) : [],
      })),
    [sourceSeries],
  );
  const unavailableSymbols = Array.isArray(details?.unavailableSymbols)
    ? details.unavailableSymbols
    : [];
  const [hoverIndex, setHoverIndex] = useState(null);

  if (series.length < 2) {
    return (
      <ToolCard>
        {header}
        <WarningRow
          items={
            unavailableSymbols.length
              ? [`Unavailable: ${unavailableSymbols.join(", ")}`]
              : undefined
          }
        />
        <PlainOutput text={text || "Price comparison unavailable."} />
      </ToolCard>
    );
  }

  const symbols = series.map((item) => item.symbol);
  const chartLabel = `Indexed price comparison of ${symbols.join(", ")} over ${details.range}`;
  const hovered = Number.isInteger(hoverIndex) ? tooltipAt(series, hoverIndex) : null;
  const endLabels = series.length <= 4 ? makeEndLabels(series) : [];

  return (
    <ToolCard>
      {header}
      <div className="grid gap-0.5 text-xs tabular-nums text-muted-foreground">
        <div>{details.range}</div>
        <div>{formatFreshnessLine(details.freshness)}</div>
      </div>
      <div data-slot="comparison-subtitle" className="text-xs tabular-nums text-muted-foreground">
        % change, indexed to 100 at {details.baseDate}
      </div>
      <figure
        aria-label={chartLabel}
        className="relative h-[180px] overflow-hidden sm:h-[220px] [&_[data-slot=market-chart-line-label]]:hidden [&_[data-slot=market-chart-tooltip]]:hidden"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const length = series[0]?.bars.length ?? 0;
          if (rect.width <= 0 || length === 0) return;
          const position = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
          setHoverIndex(Math.round(position * (length - 1)));
        }}
        onPointerLeave={() => setHoverIndex(null)}
      >
        <Suspense fallback={null}>
          <MarketChart className="h-full w-full" height="100%" mode="indexed" series={series} />
        </Suspense>
        {endLabels.map((label) => (
          <div
            key={label.symbol}
            data-slot="comparison-end-label"
            data-symbol={label.symbol}
            className="pointer-events-none absolute right-12 z-10 inline-flex -translate-y-1/2 items-center gap-1 rounded bg-card/90 px-1.5 py-0.5 text-[11px] tabular-nums text-foreground"
            style={{ top: `${label.top}%` }}
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full"
              style={{ backgroundColor: label.color }}
            />
            <span>{label.symbol}</span>
          </div>
        ))}
        {hovered ? (
          <div
            data-slot="comparison-tooltip"
            className="pointer-events-none absolute bottom-2 left-2 z-20 rounded-md border border-border bg-card/95 px-2 py-1 text-xs tabular-nums text-foreground shadow-subtle-xs"
          >
            <div>{hovered.date}</div>
            {hovered.rows.map((row) => (
              <div key={row.symbol}>
                {row.symbol} {row.indexed.toFixed(1)} ({formatRawClose(row.close)})
              </div>
            ))}
          </div>
        ) : null}
      </figure>
      <WarningRow
        items={
          unavailableSymbols.length ? [`Unavailable: ${unavailableSymbols.join(", ")}`] : undefined
        }
      />
    </ToolCard>
  );
}

function toChartBar(bar) {
  return {
    ...bar,
    time: Number.isFinite(bar.timestamp) ? bar.timestamp : utcMidnightEpochSeconds(bar.date),
  };
}

function utcMidnightEpochSeconds(date) {
  const dateOnly = String(date ?? "").slice(0, 10);
  return Date.parse(`${dateOnly}T00:00:00.000Z`) / 1000;
}

function formatFreshnessLine(freshness) {
  if (!freshness) return "As of unavailable";
  if (freshness.isStaleForSession && (freshness.providerDataAt || freshness.providerDataDate)) {
    const date = freshness.providerDataDate ?? formatEtDate(new Date(freshness.providerDataAt));
    const parenthetical = staleSessionParenthetical(freshness.marketSession);
    const cached = freshness.cachedAt
      ? ` Cached from ${formatEtDateTime(new Date(freshness.cachedAt))} ET.`
      : "";
    return `Last available price as of ${date}${parenthetical}. This is not a live quote.${cached}`;
  }

  if (freshness.cacheStatus === "stale" && freshness.cachedAt) {
    const notLive = freshness.isStaleForSession ? " This is not a live quote." : "";
    return `Using cached data from ${formatEtDateTime(new Date(freshness.cachedAt))} ET (provider unavailable).${notLive}`;
  }

  if (
    freshness.providerDataAt ||
    freshness.providerDataDate ||
    freshness.dataDelayMs !== undefined
  ) {
    const reference = freshness.providerDataAt ?? freshness.cachedAt ?? freshness.fetchedAt;
    const asOf =
      freshness.providerDataDate ??
      (reference ? formatEtDateTime(new Date(reference)) : "unavailable");
    if (freshness.dataDelayMs !== undefined) {
      return `As of ${asOf} ET (~${Math.round(freshness.dataDelayMs / 60_000)}m delayed).`;
    }
    return `As of ${asOf} ET (${marketSessionLabel(freshness.marketSession)}).`;
  }

  return `As of ${formatEtDateTime(new Date(freshness.fetchedAt))} ET (${marketSessionLabel(freshness.marketSession)}).`;
}

function formatEtDate(date) {
  return etDateTimeParts(date).date;
}

function formatEtDateTime(date) {
  const parts = etDateTimeParts(date);
  return `${parts.date} ${parts.time}`;
}

function etDateTimeParts(date) {
  const parts = ET_DATE_TIME_FORMATTER.formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

function marketSessionLabel(session) {
  if (session === "open") return "market open";
  if (session === "pre_market") return "pre-market";
  if (session === "after_close") return "after close";
  if (session === "closed_weekend") return "market closed — weekend";
  if (session === "closed_holiday") return "market closed — holiday";
  if (session === "closed_after_hours") return "market closed";
  return "market session unknown";
}

function staleSessionParenthetical(session) {
  if (session === "closed_weekend") return " (market closed — weekend)";
  if (session === "closed_holiday") return " (market closed — holiday)";
  return "";
}

function makeEndLabels(series) {
  const values = series.flatMap((item) => item.indexed ?? []).filter(Number.isFinite);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return series.flatMap((item, index) => {
    const value = item.indexed?.at(-1);
    if (!Number.isFinite(value)) return [];
    const top = Math.max(8, Math.min(92, 92 - ((value - min) / span) * 84));
    return [{ symbol: item.symbol, color: SERIES_COLORS[index], top }];
  });
}

function tooltipAt(series, index) {
  const primaryBar = series[0]?.bars[index];
  if (!primaryBar) return null;
  const rows = series.flatMap((item) => {
    const indexed = item.indexed?.[index];
    const close = item.bars[index]?.close;
    return Number.isFinite(indexed) && Number.isFinite(close)
      ? [{ symbol: item.symbol, indexed, close }]
      : [];
  });
  return {
    date: primaryBar.date ?? new Date(primaryBar.time * 1000).toISOString().slice(0, 10),
    rows,
  };
}
