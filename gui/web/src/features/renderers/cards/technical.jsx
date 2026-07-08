import { useMemo } from "react";
import { cn } from "../../../lib/utils.js";
import { PlainOutput, ToolCard } from "./_shared.jsx";
import { extractDetails } from "./card-format.js";

// Technical indicators card. The tool returns a human-readable summary in
// `text` plus the full per-bar arrays in `details`. Rendering them as numbers
// is useless — but the same arrays make a clean three-pane chart: price + SMA
// overlays + Bollinger envelope on top, RSI in the middle (with 30/70
// reference lines), MACD histogram + lines at the bottom.
export function TechnicalIndicatorsCard({ message, header, text }) {
  const d = extractDetails(message);
  const series = useMemo(() => projectSeries(d), [d]);
  if (!series)
    return (
      <ToolCard>
        {header}
        <PlainOutput text={text} />
      </ToolCard>
    );
  return (
    <ToolCard>
      {header}
      <PlainOutput text={text} />
      <PriceChart series={series} />
      <RsiChart series={series} />
      <MacdChart series={series} />
    </ToolCard>
  );
}

function projectSeries(d) {
  if (!d) return null;
  const sma20 = arr(d.sma20);
  const sma50 = arr(d.sma50);
  const rsi = arr(d.rsi);
  const macd = arr(d.macd)
    .map((m) => (m && typeof m === "object" ? m : null))
    .filter(Boolean);
  const bb = arr(d.bb)
    .map((b) => (b && typeof b === "object" ? b : null))
    .filter(Boolean);
  // Prefer the actual close prices when the tool emits them; older runs that
  // only carried indicator arrays fall back to the Bollinger middle band
  // (which is the same SMA20 used as the band's basis).
  const prices = arr(d.prices).filter(Number.isFinite);
  const price = prices.length ? prices : bb.map((b) => b.middle);
  if (price.length < 2) return null;
  return {
    price,
    sma20,
    sma50,
    rsi,
    macdLine: macd.map((m) => m.macd),
    macdSignal: macd.map((m) => m.signal),
    macdHist: macd.map((m) => m.histogram),
    bbUpper: bb.map((b) => b.upper),
    bbLower: bb.map((b) => b.lower),
  };
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

// ---------------------------------------------------------------------------
// Price + SMA + Bollinger envelope
// ---------------------------------------------------------------------------

function PriceChart({ series }) {
  const numeric = [
    ...series.price,
    ...series.sma20,
    ...series.sma50,
    ...series.bbUpper,
    ...series.bbLower,
  ].filter(Number.isFinite);
  if (numeric.length < 2) return null;
  const vmin = Math.min(...numeric);
  const vmax = Math.max(...numeric);
  const span = vmax - vmin || 1;
  const width = 600;
  const height = 160;
  const toY = (v) => height - ((v - vmin) / span) * (height - 8) - 4;

  const envelope = bandPath(series.bbUpper, series.bbLower, width, toY);
  const sma20Path = linePath(series.sma20, width, toY);
  const sma50Path = linePath(series.sma50, width, toY);
  const pricePath = linePath(series.price, width, toY);

  return (
    <ChartFrame
      label="Price"
      height={height}
      legend={[
        { color: "currentColor", label: "Close" },
        { color: "hsl(var(--tw-info))", label: "SMA(20)" },
        { color: "hsl(var(--tw-warning))", label: "SMA(50)" },
        { color: "hsl(var(--tw-foreground) / 0.18)", label: "Bollinger" },
      ]}
      valueLabel={`$${vmin.toFixed(2)} – $${vmax.toFixed(2)}`}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-40 w-full"
        role="img"
        aria-label="Price, moving average, and Bollinger band chart"
      >
        {envelope ? (
          <path d={envelope} fill="hsl(var(--tw-foreground) / 0.06)" stroke="none" />
        ) : null}
        {sma50Path ? (
          <path
            d={sma50Path}
            fill="none"
            stroke="hsl(var(--tw-warning))"
            strokeWidth="1"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {sma20Path ? (
          <path
            d={sma20Path}
            fill="none"
            stroke="hsl(var(--tw-info))"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {pricePath ? (
          <path
            d={pricePath}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// RSI with 30 / 70 reference lines
// ---------------------------------------------------------------------------

function RsiChart({ series }) {
  if (series.rsi.length < 2) return null;
  const width = 600;
  const height = 56;
  const toY = (v) => height - ((v - 0) / 100) * (height - 8) - 4;
  const path = linePath(series.rsi, width, toY);
  const last = series.rsi[series.rsi.length - 1];
  const tone = last >= 70 ? "text-warning" : last <= 30 ? "text-info" : "text-muted-foreground";

  return (
    <ChartFrame
      label="RSI(14)"
      height={height}
      valueLabel={
        <span className={cn("tabular-nums", tone)}>
          {Number.isFinite(last) ? last.toFixed(1) : "—"}
        </span>
      }
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-14 w-full"
        role="img"
        aria-label="RSI chart"
      >
        <line
          x1="0"
          y1={toY(70)}
          x2={width}
          y2={toY(70)}
          stroke="hsl(var(--tw-warning) / 0.5)"
          strokeDasharray="2 2"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1="0"
          y1={toY(30)}
          x2={width}
          y2={toY(30)}
          stroke="hsl(var(--tw-info) / 0.5)"
          strokeDasharray="2 2"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        {path ? (
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// MACD line + signal + histogram
// ---------------------------------------------------------------------------

function MacdChart({ series }) {
  const histAvail = series.macdHist.length >= 2;
  const lineAvail = series.macdLine.length >= 2;
  if (!histAvail && !lineAvail) return null;
  const all = [...series.macdLine, ...series.macdSignal, ...series.macdHist].filter(
    Number.isFinite,
  );
  if (all.length < 2) return null;
  const vmax = Math.max(...all.map(Math.abs));
  const span = vmax * 2 || 1;
  const width = 600;
  const height = 70;
  const toY = (v) => height - ((v + vmax) / span) * (height - 8) - 4;
  const last = series.macdLine[series.macdLine.length - 1];
  const lastSignal = series.macdSignal[series.macdSignal.length - 1];

  return (
    <ChartFrame
      label="MACD"
      height={height}
      legend={[
        { color: "currentColor", label: "MACD" },
        { color: "hsl(var(--tw-warning))", label: "Signal" },
        { color: "hsl(var(--tw-foreground) / 0.35)", label: "Histogram" },
      ]}
      valueLabel={
        Number.isFinite(last) && Number.isFinite(lastSignal) ? (
          <span className="tabular-nums text-muted-foreground">
            {last.toFixed(2)} / {lastSignal.toFixed(2)}
          </span>
        ) : null
      }
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="block h-[70px] w-full"
        role="img"
        aria-label="MACD chart"
      >
        <line
          x1="0"
          y1={toY(0)}
          x2={width}
          y2={toY(0)}
          stroke="hsl(var(--tw-border))"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
        />
        {series.macdHist.map((value, index) => {
          if (!Number.isFinite(value)) return null;
          const x = (index / (series.macdHist.length - 1)) * width;
          const y0 = toY(0);
          const y1 = toY(value);
          const positive = value >= 0;
          return (
            <line
              key={`${x.toFixed(1)}:${value.toFixed(3)}`}
              x1={x.toFixed(1)}
              y1={y0.toFixed(1)}
              x2={x.toFixed(1)}
              y2={y1.toFixed(1)}
              stroke={
                positive ? "hsl(var(--tw-success) / 0.6)" : "hsl(var(--tw-destructive) / 0.6)"
              }
              strokeWidth="1.4"
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {linePath(series.macdSignal, width, toY) ? (
          <path
            d={linePath(series.macdSignal, width, toY)}
            fill="none"
            stroke="hsl(var(--tw-warning))"
            strokeWidth="1.2"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
        {linePath(series.macdLine, width, toY) ? (
          <path
            d={linePath(series.macdLine, width, toY)}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Frame: small uppercase label + optional legend chips + value label on right
// ---------------------------------------------------------------------------

function ChartFrame({ label, valueLabel, legend, height: _height, children }) {
  return (
    <div className="grid gap-1.5 border-t border-border pt-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          {legend ? (
            <div className="hidden items-center gap-2 sm:flex">
              {legend.map((entry) => (
                <span
                  key={entry.label}
                  className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-1 w-3 rounded-sm"
                    style={{ background: entry.color }}
                  />
                  {entry.label}
                </span>
              ))}
            </div>
          ) : null}
        </div>
        {valueLabel ? (
          <span className="text-[11px] tabular-nums text-muted-foreground">{valueLabel}</span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function linePath(values, width, toY) {
  const numeric = values.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v));
  if (numeric.length < 2) return null;
  const denom = values.length - 1 || 1;
  return numeric
    .map(([i, v], idx) => {
      const x = (i / denom) * width;
      const y = toY(v);
      return `${idx === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function bandPath(upper, lower, width, toY) {
  if (upper.length < 2 || lower.length !== upper.length) return null;
  const denom = upper.length - 1 || 1;
  const top = upper
    .map((v, i) => `${i === 0 ? "M" : "L"}${((i / denom) * width).toFixed(1)},${toY(v).toFixed(1)}`)
    .join(" ");
  const bottom = lower
    .map((v, i) => `L${((i / denom) * width).toFixed(1)},${toY(v).toFixed(1)}`)
    .reverse()
    .join(" ");
  return `${top} ${bottom} Z`;
}
