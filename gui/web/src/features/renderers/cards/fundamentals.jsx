import { Badge } from "../../../components/ui/badge.jsx";
import { DeltaChip, MoneyTile, PlainOutput, StatRow, ToolCard } from "./_shared.jsx";
import {
  extractDetails,
  formatDateShort,
  formatLargeNumber,
  formatPercent,
  formatPrice,
} from "./card-format.js";

export function CompanyOverviewCard({ message, header }) {
  const d = extractDetails(message);
  if (!d?.symbol)
    return (
      <ToolCard>
        {header}
        <PlainOutput text="Company overview unavailable." />
      </ToolCard>
    );
  return (
    <ToolCard>
      {header}
      <div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight text-foreground">
            {d.name || d.symbol}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{d.symbol}</span>
          {d.exchange ? <Badge variant="outline">{d.exchange}</Badge> : null}
        </div>
        {d.sector || d.industry ? (
          <div className="mt-1 text-xs text-muted-foreground">
            {[d.sector, d.industry].filter(Boolean).join(" · ")}
          </div>
        ) : null}
      </div>
      {d.description ? (
        <p className="line-clamp-3 text-[13px] leading-relaxed text-muted-foreground">
          {d.description}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <MoneyTile
          label="Market cap"
          value={d.marketCap > 0 ? `$${formatLargeNumber(d.marketCap)}` : "—"}
        />
        <MoneyTile label="P/E" value={Number.isFinite(d.pe) && d.pe ? d.pe.toFixed(2) : "—"} />
        <MoneyTile
          label="Forward P/E"
          value={Number.isFinite(d.forwardPe) && d.forwardPe ? d.forwardPe.toFixed(2) : "—"}
        />
        <MoneyTile label="EPS" value={Number.isFinite(d.eps) ? d.eps.toFixed(2) : "—"} />
        <MoneyTile label="Beta" value={Number.isFinite(d.beta) ? d.beta.toFixed(2) : "—"} />
        <MoneyTile
          label="Dividend yield"
          value={Number.isFinite(d.dividendYield) ? `${(d.dividendYield * 100).toFixed(2)}%` : "—"}
        />
        <MoneyTile
          label="Profit margin"
          value={Number.isFinite(d.profitMargin) ? `${(d.profitMargin * 100).toFixed(2)}%` : "—"}
        />
        <MoneyTile
          label="Revenue growth"
          value={Number.isFinite(d.revenueGrowth) ? `${(d.revenueGrowth * 100).toFixed(2)}%` : "—"}
          tone={d.revenueGrowth > 0 ? "success" : d.revenueGrowth < 0 ? "destructive" : "default"}
        />
        <MoneyTile label="Avg volume" value={formatLargeNumber(d.avgVolume)} />
      </div>
      {Number.isFinite(d.week52Low) && Number.isFinite(d.week52High) ? (
        <div className="text-xs text-muted-foreground">
          52-week range{" "}
          <span className="tabular-nums text-foreground">
            {formatPrice(d.week52Low)} – {formatPrice(d.week52High)}
          </span>
        </div>
      ) : null}
    </ToolCard>
  );
}

export function FinancialsCard({ message, header, text }) {
  const d = extractDetails(message);
  const statements = Array.isArray(d) ? d : Array.isArray(d?.statements) ? d.statements : null;
  if (!statements || statements.length === 0) {
    return (
      <ToolCard>
        {header}
        <PlainOutput text={text} />
      </ToolCard>
    );
  }
  const latest = statements[0];
  const prior = statements[1];
  const revGrowth = prior?.revenue
    ? ((latest.revenue - prior.revenue) / prior.revenue) * 100
    : null;
  const epsGrowth = prior?.eps ? ((latest.eps - prior.eps) / prior.eps) * 100 : null;
  return (
    <ToolCard>
      {header}
      <div>
        <div className="text-xs text-muted-foreground">Latest filing</div>
        <div className="mt-0.5 text-base font-medium text-foreground">
          {formatDateShort(latest.fiscalDate)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MoneyTile label="Revenue" value={`$${formatLargeNumber(latest.revenue)}`} />
        <MoneyTile
          label="Net income"
          value={`$${formatLargeNumber(latest.netIncome)}`}
          tone={latest.netIncome >= 0 ? "success" : "destructive"}
        />
        <MoneyTile
          label="Operating income"
          value={`$${formatLargeNumber(latest.operatingIncome)}`}
        />
        <MoneyTile
          label="EPS"
          value={Number.isFinite(latest.eps) ? `$${latest.eps.toFixed(2)}` : "—"}
        />
        <MoneyTile label="Free cash flow" value={`$${formatLargeNumber(latest.freeCashFlow)}`} />
        <MoneyTile
          label="Operating cash flow"
          value={`$${formatLargeNumber(latest.operatingCashFlow)}`}
        />
        <MoneyTile label="Total assets" value={`$${formatLargeNumber(latest.totalAssets)}`} />
        <MoneyTile
          label="Total debt"
          value={
            Number.isFinite(latest.totalDebt) ? `$${formatLargeNumber(latest.totalDebt)}` : "—"
          }
        />
      </div>
      {revGrowth !== null || epsGrowth !== null ? (
        <div className="grid gap-1.5 rounded-md bg-secondary px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Year over year
          </div>
          {revGrowth !== null ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Revenue</span>
              <DeltaChip percent={revGrowth} />
            </div>
          ) : null}
          {epsGrowth !== null ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">EPS</span>
              <DeltaChip percent={epsGrowth} />
            </div>
          ) : null}
        </div>
      ) : null}
    </ToolCard>
  );
}

export function EarningsCard({ message, header, text }) {
  const d = extractDetails(message);
  const quarters = Array.isArray(d?.quarterly) ? d.quarterly : Array.isArray(d) ? d : null;
  if (!quarters || quarters.length === 0) {
    return (
      <ToolCard>
        {header}
        <PlainOutput text={text} />
      </ToolCard>
    );
  }
  const latest = quarters[0];
  const symbol = d?.symbol;
  return (
    <ToolCard>
      {header}
      <div>
        <div className="text-xs text-muted-foreground">
          {symbol ? `${symbol} · ` : ""}Latest quarter
        </div>
        <div className="mt-0.5 text-base font-medium text-foreground">
          {formatDateShort(latest.date)}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MoneyTile
          label="Reported EPS"
          value={Number.isFinite(latest.reportedEPS) ? `$${latest.reportedEPS.toFixed(2)}` : "—"}
        />
        <MoneyTile
          label="Estimated EPS"
          value={Number.isFinite(latest.estimatedEPS) ? `$${latest.estimatedEPS.toFixed(2)}` : "—"}
        />
        <MoneyTile
          label="Surprise"
          value={Number.isFinite(latest.surprise) ? `$${latest.surprise.toFixed(2)}` : "—"}
          tone={latest.surprise > 0 ? "success" : latest.surprise < 0 ? "destructive" : "default"}
        />
        <MoneyTile
          label="Surprise %"
          value={
            Number.isFinite(latest.surprisePercent) ? formatPercent(latest.surprisePercent) : "—"
          }
          tone={
            latest.surprisePercent > 0
              ? "success"
              : latest.surprisePercent < 0
                ? "destructive"
                : "default"
          }
        />
      </div>
      {quarters.length > 1 ? (
        <div className="rounded-md border border-border">
          <div className="border-b border-border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Recent quarters
          </div>
          <ul>
            {quarters.slice(0, 5).map((q) => (
              <li
                key={q.date}
                className="flex items-center justify-between gap-3 border-b border-border px-3 py-1.5 last:border-b-0"
              >
                <span className="text-xs text-muted-foreground">{formatDateShort(q.date)}</span>
                <span className="text-xs tabular-nums text-foreground">
                  EPS ${q.reportedEPS?.toFixed(2) ?? "—"}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  est ${q.estimatedEPS?.toFixed(2) ?? "—"}
                </span>
                <DeltaChip percent={q.surprisePercent} prefix="" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </ToolCard>
  );
}

export function DcfCard({ message, header, text }) {
  const d = extractDetails(message);
  const fairValue = d.fairValue ?? d.intrinsicValue ?? d.value;
  const currentPrice = d.currentPrice ?? d.price;
  const upside =
    d.upside ??
    d.upsidePercent ??
    (Number.isFinite(fairValue) && Number.isFinite(currentPrice)
      ? ((fairValue - currentPrice) / currentPrice) * 100
      : null);
  if (!Number.isFinite(fairValue) && !Number.isFinite(currentPrice)) {
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Fair value
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-foreground">
            {formatPrice(fairValue)}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Current price
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums tracking-tight text-muted-foreground">
              {formatPrice(currentPrice)}
            </span>
            {Number.isFinite(upside) ? <DeltaChip percent={upside} /> : null}
          </div>
        </div>
      </div>
      {d.assumptions || d.inputs ? (
        <div className="rounded-md bg-secondary px-3 py-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Assumptions
          </div>
          <div className="mt-1.5 grid gap-1">
            {Object.entries(d.assumptions || d.inputs || {}).map(([k, v]) => (
              <StatRow
                key={k}
                label={k}
                value={typeof v === "number" ? v.toLocaleString() : String(v)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </ToolCard>
  );
}
