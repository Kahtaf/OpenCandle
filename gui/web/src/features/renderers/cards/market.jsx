import { useRef, useState } from "react";
import { DeltaChip, MoneyTile, PlainOutput, RangeBar, ToolCard } from "./_shared.jsx";
import { extractDetails, formatDateShort, formatLargeNumber, formatPrice } from "./card-format.js";

export function StockQuoteCard({ message, header }) {
  const d = extractDetails(message);
  if (!d || !Number.isFinite(d.price)) {
    return (
      <ToolCard>
        {header}
        <PlainOutput text="Quote unavailable." />
      </ToolCard>
    );
  }
  return (
    <ToolCard>
      {header}
      <div>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-[13px] tracking-tight text-muted-foreground">
            {d.symbol}
          </span>
          <span className="text-[2rem] font-semibold leading-none tabular-nums tracking-tight text-foreground">
            {formatPrice(d.price)}
          </span>
          <DeltaChip value={d.change} percent={d.changePercent} size="lg" />
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground">
          Prev close <span className="tabular-nums">{formatPrice(d.previousClose)}</span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MoneyTile label="Open" value={formatPrice(d.open)} />
        <MoneyTile label="High" value={formatPrice(d.high)} />
        <MoneyTile label="Low" value={formatPrice(d.low)} />
        <MoneyTile label="Volume" value={formatLargeNumber(d.volume)} />
      </div>
      <RangeBar low={d.week52Low} high={d.week52High} current={d.price} label="52-week range" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <MoneyTile
          label="Market cap"
          value={d.marketCap > 0 ? `$${formatLargeNumber(d.marketCap)}` : "—"}
        />
        <MoneyTile label="P/E" value={Number.isFinite(d.pe) && d.pe ? d.pe.toFixed(2) : "—"} />
        <MoneyTile
          label="As of"
          value={d.timestamp ? new Date(d.timestamp).toLocaleTimeString() : "—"}
        />
      </div>
    </ToolCard>
  );
}

export function CryptoPriceCard({ message, header }) {
  const d = extractDetails(message);
  if (!d || !Number.isFinite(d.price)) {
    return (
      <ToolCard>
        {header}
        <PlainOutput text="Crypto price unavailable." />
      </ToolCard>
    );
  }
  return (
    <ToolCard>
      {header}
      <div>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-[13px] tracking-tight text-muted-foreground">
            {d.symbol}
          </span>
          <span className="text-[2rem] font-semibold leading-none tabular-nums tracking-tight text-foreground">
            {formatPrice(d.price)}
          </span>
          <DeltaChip value={d.change24h} percent={d.changePercent24h} size="lg" />
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground">{d.name} · 24h change</div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MoneyTile label="High 24h" value={formatPrice(d.high24h)} />
        <MoneyTile label="Low 24h" value={formatPrice(d.low24h)} />
        <MoneyTile
          label="Volume 24h"
          value={d.volume24h ? `$${formatLargeNumber(d.volume24h)}` : "—"}
        />
        <MoneyTile
          label="Market cap"
          value={d.marketCap ? `$${formatLargeNumber(d.marketCap)}` : "—"}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <MoneyTile label="All-time high" value={formatPrice(d.ath)} />
        <MoneyTile label="ATH date" value={d.athDate ? formatDateShort(d.athDate) : "—"} />
      </div>
      {d.circulatingSupply ? (
        <div className="grid grid-cols-2 gap-2">
          <MoneyTile label="Circulating supply" value={formatLargeNumber(d.circulatingSupply)} />
          <MoneyTile
            label="Total supply"
            value={d.totalSupply ? formatLargeNumber(d.totalSupply) : "—"}
          />
        </div>
      ) : null}
    </ToolCard>
  );
}

export function HistoryCard({ message, header }) {
  const raw = extractDetails(message);
  const bars = Array.isArray(raw) ? raw : Array.isArray(raw?.bars) ? raw.bars : [];
  if (bars.length === 0) {
    return (
      <ToolCard>
        {header}
        <PlainOutput text="No price history returned." />
      </ToolCard>
    );
  }
  const first = bars[0];
  const last = bars[bars.length - 1];
  const high = Math.max(...bars.map((b) => b.high ?? b.close));
  const low = Math.min(...bars.map((b) => b.low ?? b.close));
  const change = last.close - first.close;
  const changePct = first.close ? (change / first.close) * 100 : 0;
  const volumes = bars.map((b) => b.volume).filter(Number.isFinite);
  const avgVolume = volumes.length ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;
  return (
    <ToolCard>
      {header}
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
          {formatPrice(last.close)}
        </span>
        <DeltaChip value={change} percent={changePct} />
        <span className="text-xs text-muted-foreground">over {bars.length} bars</span>
      </div>
      <PriceChart bars={bars} change={change} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MoneyTile label="Period high" value={formatPrice(high)} />
        <MoneyTile label="Period low" value={formatPrice(low)} />
        <MoneyTile label="First close" value={formatPrice(first.close)} />
        <MoneyTile label="Avg volume" value={formatLargeNumber(avgVolume)} />
      </div>
    </ToolCard>
  );
}

// Interactive price chart with axis labels, gridlines, and hover crosshair.
// Computed in viewBox units (600 × 200) so the SVG scales fluidly while the
// stroke widths remain crisp via vector-effect:non-scaling-stroke.
function PriceChart({ bars, change }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const wrapRef = useRef(null);

  const closes = bars.map((b) => b.close);
  const numeric = closes.filter(Number.isFinite);
  if (numeric.length < 2) return null;

  const VB_W = 600;
  const VB_H = 200;
  const PAD_L = 48; // y-axis label gutter
  const PAD_R = 12;
  const PAD_T = 8;
  const PAD_B = 22; // x-axis label gutter
  const innerW = VB_W - PAD_L - PAD_R;
  const innerH = VB_H - PAD_T - PAD_B;

  const vmin = Math.min(...numeric);
  const vmax = Math.max(...numeric);
  const span = vmax - vmin || 1;
  // Round y-axis bounds outward to "nice" numbers so labels read cleanly.
  const niceMin = niceFloor(vmin, span);
  const niceMax = niceCeil(vmax, span);
  const niceSpan = niceMax - niceMin || 1;
  const yTicks = buildTicks(niceMin, niceMax, 4);

  const xCoord = (i) => PAD_L + (i / (closes.length - 1 || 1)) * innerW;
  const yCoord = (v) => PAD_T + innerH - ((v - niceMin) / niceSpan) * innerH;

  const path = closes
    .map((v, i) =>
      Number.isFinite(v)
        ? `${i === 0 ? "M" : "L"}${xCoord(i).toFixed(1)},${yCoord(v).toFixed(1)}`
        : "",
    )
    .filter(Boolean)
    .join(" ");
  const area = `${path} L${xCoord(closes.length - 1).toFixed(1)},${(PAD_T + innerH).toFixed(1)} L${PAD_L.toFixed(1)},${(PAD_T + innerH).toFixed(1)} Z`;
  const positive = change >= 0;
  const stroke = positive ? "hsl(var(--tw-success))" : "hsl(var(--tw-destructive))";
  const fill = positive ? "hsl(var(--tw-success) / 0.08)" : "hsl(var(--tw-destructive) / 0.08)";

  // X-axis tick positions: 4 evenly spaced bars, including first and last.
  const xTickIndices = pickTickIndices(closes.length, 4);

  const onMove = (event) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * VB_W;
    const i = Math.max(
      0,
      Math.min(closes.length - 1, Math.round(((x - PAD_L) / innerW) * (closes.length - 1))),
    );
    setHoverIndex(i);
  };
  const onLeave = () => setHoverIndex(null);

  const hoverBar = hoverIndex != null ? bars[hoverIndex] : null;
  const hoverX = hoverBar ? xCoord(hoverIndex) : null;
  const hoverY = hoverBar ? yCoord(hoverBar.close) : null;

  return (
    <div
      ref={wrapRef}
      className="relative -mx-1 select-none"
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      onTouchEnd={onLeave}
    >
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        className="block h-44 w-full"
        role="img"
        aria-label="Price history chart"
      >
        {/* horizontal gridlines + y-axis labels */}
        {yTicks.map((t) => {
          const y = yCoord(t);
          return (
            <g key={`y-${t}`}>
              <line
                x1={PAD_L}
                y1={y}
                x2={VB_W - PAD_R}
                y2={y}
                stroke="hsl(var(--tw-border))"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
                strokeDasharray="2 4"
              />
              <text
                x={PAD_L - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-foreground"
                style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}
              >
                {formatTick(t, niceSpan)}
              </text>
            </g>
          );
        })}
        {/* x-axis labels */}
        {xTickIndices.map((i) => (
          <text
            key={`x-${i}`}
            x={xCoord(i)}
            y={VB_H - 6}
            textAnchor={i === 0 ? "start" : i === closes.length - 1 ? "end" : "middle"}
            className="fill-muted-foreground"
            style={{ fontSize: 10 }}
          >
            {formatDateShort(bars[i].date)}
          </text>
        ))}
        {/* area + line */}
        <path d={area} fill={fill} stroke="none" />
        <path
          d={path}
          fill="none"
          stroke={stroke}
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        {/* hover crosshair */}
        {hoverBar ? (
          <g>
            <line
              x1={hoverX}
              y1={PAD_T}
              x2={hoverX}
              y2={PAD_T + innerH}
              stroke="hsl(var(--tw-foreground) / 0.35)"
              strokeWidth="1"
              strokeDasharray="2 3"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={hoverX}
              cy={hoverY}
              r="3"
              fill="hsl(var(--tw-card))"
              stroke={stroke}
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ) : null}
      </svg>
      {hoverBar ? <HoverTooltip bar={hoverBar} index={hoverIndex} bars={bars} /> : null}
    </div>
  );
}

function HoverTooltip({ bar, index, bars }) {
  const x = bars.length > 1 ? (index / (bars.length - 1)) * 100 : 50;
  // Flip alignment past the midpoint so the tooltip stays on-card.
  const flip = x > 60;
  return (
    <div
      className="pointer-events-none absolute top-1 -translate-x-1/2 rounded-md border border-border bg-card px-2 py-1.5 text-[11px] tabular-nums shadow-subtle-xs"
      style={{
        left: `${x}%`,
        transform: `translateX(${flip ? "-100%" : "0%"})`,
        marginLeft: flip ? -8 : 8,
      }}
      aria-hidden="true"
    >
      <div className="font-medium text-foreground">{formatPrice(bar.close)}</div>
      <div className="text-muted-foreground">{formatDateLong(bar.date)}</div>
      {Number.isFinite(bar.high) && Number.isFinite(bar.low) ? (
        <div className="mt-0.5 text-muted-foreground/80">
          H {formatPrice(bar.high)} · L {formatPrice(bar.low)}
        </div>
      ) : null}
    </div>
  );
}

function niceFloor(v, span) {
  const step = 10 ** Math.floor(Math.log10(span / 4 || 1));
  return Math.floor(v / step) * step;
}
function niceCeil(v, span) {
  const step = 10 ** Math.floor(Math.log10(span / 4 || 1));
  return Math.ceil(v / step) * step;
}
function buildTicks(min, max, count) {
  const span = max - min;
  if (span <= 0) return [min];
  const step = span / (count - 1);
  return Array.from({ length: count }, (_, i) => min + step * i);
}
function pickTickIndices(length, count) {
  if (length <= count) return Array.from({ length }, (_, i) => i);
  const step = (length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => Math.round(step * i));
}
function formatTick(value, span) {
  if (span >= 100) return `$${Math.round(value)}`;
  if (span >= 10) return `$${value.toFixed(1)}`;
  return `$${value.toFixed(2)}`;
}
function formatDateLong(date) {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return String(date);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CompareCard({ message, header, text }) {
  const d = extractDetails(message);
  const rows = Array.isArray(d)
    ? d
    : Array.isArray(d?.quotes)
      ? d.quotes
      : Array.isArray(d?.symbols)
        ? d.symbols
        : null;
  if (!rows || rows.length === 0) {
    return (
      <ToolCard>
        {header}
        <PlainOutput text={text} />
      </ToolCard>
    );
  }
  return (
    <ToolCard>
      {header}
      <div className="grid gap-2">
        {rows.map((row, index) => {
          const symbol = row.symbol || row.ticker || row.name || row.id || `#${index + 1}`;
          const price = row.price ?? row.last ?? row.close;
          const rowKey = row.symbol || row.ticker || row.id || `${symbol}-${index}`;
          return (
            <div
              className="flex items-center justify-between rounded-md bg-secondary px-3 py-2.5"
              key={rowKey}
            >
              <span className="font-mono text-sm font-medium text-foreground">{symbol}</span>
              <span className="tabular-nums text-sm font-medium text-foreground">
                {formatPrice(price)}
              </span>
              <DeltaChip value={row.change} percent={row.changePercent ?? row.changePct} />
            </div>
          );
        })}
      </div>
    </ToolCard>
  );
}
