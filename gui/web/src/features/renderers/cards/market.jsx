import { lazy, Suspense } from "react";
import { enrichStockQuoteDetails } from "../../chat/session-market-facts.js";
import { DeltaChip, MoneyTile, PlainOutput, RangeBar, ToolCard } from "./_shared.jsx";
import { extractDetails, formatDateShort, formatLargeNumber, formatPrice } from "./card-format.js";

const MarketChart = lazy(() =>
  import("../../../components/market-chart.jsx").then(({ MarketChart: Component }) => ({
    default: Component,
  })),
);

export function StockQuoteCard({ message, header, sessionMarketFacts }) {
  const d = enrichStockQuoteDetails(extractDetails(message), sessionMarketFacts);
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
  const symbol = message?.details?.args?.symbol ?? raw?.symbol ?? "Price";
  const chartBars = bars.map((bar) => ({
    ...bar,
    time: Number.isFinite(bar.timestamp) ? bar.timestamp : utcMidnightEpochSeconds(bar.date),
  }));
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
      <div className="text-xs tabular-nums text-muted-foreground">
        <time dateTime={epochSecondsToIso(chartBars[0].time)}>{first.date}</time>
        {" → "}
        <time dateTime={epochSecondsToIso(chartBars.at(-1).time)}>{last.date}</time>
      </div>
      <div className="h-[180px] overflow-hidden sm:h-[220px]">
        <Suspense fallback={null}>
          <MarketChart
            className="h-full w-full"
            height="100%"
            mode="area"
            series={[{ symbol, bars: chartBars }]}
          />
        </Suspense>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MoneyTile label="Period high" value={formatPrice(high)} />
        <MoneyTile label="Period low" value={formatPrice(low)} />
        <MoneyTile label="First close" value={formatPrice(first.close)} />
        <MoneyTile label="Avg volume" value={formatLargeNumber(avgVolume)} />
      </div>
    </ToolCard>
  );
}

function utcMidnightEpochSeconds(date) {
  const dateOnly = String(date ?? "").slice(0, 10);
  return Date.parse(`${dateOnly}T00:00:00.000Z`) / 1000;
}

function epochSecondsToIso(time) {
  return Number.isFinite(time) ? new Date(time * 1000).toISOString() : undefined;
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
