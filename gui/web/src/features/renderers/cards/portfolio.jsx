import { Badge } from "../../../components/ui/badge.jsx";
import { Favicon } from "../../../components/ui/favicon.jsx";
import { formatQuantity } from "../../../lib/financial-format.js";
import { DeltaChip, MoneyTile, PlainOutput, ToolCard } from "./_shared.jsx";
import {
  extractDetails,
  formatLargeNumber,
  formatPercent,
  formatPrice,
  relativeTime,
} from "./card-format.js";

export function PortfolioCard({ message, header, text }) {
  const d = extractDetails(message);
  const positions = Array.isArray(d?.positions) ? d.positions : null;
  if (!positions || positions.length === 0) {
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
      <div>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-[2rem] font-semibold leading-none tabular-nums tracking-tight text-foreground">
            ${formatLargeNumber(d.totalValue)}
          </span>
          <DeltaChip value={d.totalPnl} percent={d.totalPnlPercent} size="lg" />
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground">
          {positions.length} position{positions.length === 1 ? "" : "s"} · cost basis $
          {formatLargeNumber(d.totalCost)}
        </div>
      </div>
      <div className="rounded-md border border-border">
        <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span>Symbol</span>
          <span className="text-right">Value</span>
          <span className="text-right">Weight</span>
          <span className="text-right">P&L</span>
        </div>
        <ul>
          {positions.map((p) => {
            const weight = d.totalValue ? (p.marketValue / d.totalValue) * 100 : 0;
            return (
              <li
                key={p.symbol}
                className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-b border-border px-3 py-2 last:border-b-0"
              >
                <div className="grid">
                  <span className="font-mono text-sm font-medium text-foreground">{p.symbol}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {formatQuantity(p.shares)} @ {formatPrice(p.avgCost)}
                  </span>
                </div>
                <span className="text-right text-sm tabular-nums text-foreground">
                  ${formatLargeNumber(p.marketValue)}
                </span>
                <span className="text-right text-xs tabular-nums text-muted-foreground">
                  {weight.toFixed(1)}%
                </span>
                <span className="text-right">
                  <DeltaChip percent={p.pnlPercent} prefix="" />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </ToolCard>
  );
}

export function RiskCard({ message, header, text }) {
  const d = extractDetails(message);
  if (!d?.symbol && !Number.isFinite(d?.sharpeRatio) && !Number.isFinite(d?.annualizedVolatility)) {
    return (
      <ToolCard>
        {header}
        <PlainOutput text={text} />
      </ToolCard>
    );
  }
  const sharpeTone = d.sharpeRatio > 1 ? "success" : d.sharpeRatio < 0 ? "destructive" : "default";
  const ddTone =
    d.maxDrawdown <= -0.3 ? "destructive" : d.maxDrawdown <= -0.1 ? "default" : "success";
  return (
    <ToolCard>
      {header}
      {d.symbol ? (
        <div className="font-mono text-sm font-medium text-foreground">{d.symbol}</div>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <MoneyTile
          label="Annualized return"
          value={
            Number.isFinite(d.annualizedReturn) ? formatPercent(d.annualizedReturn * 100) : "—"
          }
          tone={
            d.annualizedReturn > 0 ? "success" : d.annualizedReturn < 0 ? "destructive" : "default"
          }
        />
        <MoneyTile
          label="Volatility (annl.)"
          value={
            Number.isFinite(d.annualizedVolatility)
              ? formatPercent(d.annualizedVolatility * 100)
              : "—"
          }
        />
        <MoneyTile
          label="Sharpe ratio"
          value={Number.isFinite(d.sharpeRatio) ? d.sharpeRatio.toFixed(2) : "—"}
          tone={sharpeTone}
        />
        <MoneyTile
          label="Max drawdown"
          value={Number.isFinite(d.maxDrawdown) ? formatPercent(d.maxDrawdown * 100) : "—"}
          tone={ddTone}
        />
        <MoneyTile
          label="VaR 95% (daily)"
          value={Number.isFinite(d.var95) ? formatPercent(d.var95 * 100) : "—"}
          tone="destructive"
        />
      </div>
    </ToolCard>
  );
}

export function CorrelationCard({ message, header, text }) {
  const d = extractDetails(message);
  const matrix = d?.matrix || d?.correlations || null;
  const symbols =
    Array.isArray(d?.symbols) && d.symbols.length > 0
      ? d.symbols
      : matrix && typeof matrix === "object"
        ? Object.keys(matrix)
        : null;
  if (!matrix || !symbols || symbols.length === 0) {
    return (
      <ToolCard>
        {header}
        <PlainOutput text={text} />
      </ToolCard>
    );
  }
  const warnings = Array.isArray(d?.warnings) ? d.warnings : [];
  return (
    <ToolCard>
      {header}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead>
            <tr className="bg-secondary">
              <th
                scope="col"
                className="border-b border-border px-2 py-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
              >
                {" "}
              </th>
              {symbols.map((s) => (
                <th
                  scope="col"
                  key={s}
                  className="border-b border-border px-2 py-1.5 text-right font-mono text-[11px] font-medium text-foreground"
                >
                  {s}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {symbols.map((rowSym) => (
              <tr key={rowSym}>
                <th
                  scope="row"
                  className="border-b border-border px-2 py-1.5 text-left font-mono text-[11px] font-medium text-foreground"
                >
                  {rowSym}
                </th>
                {symbols.map((colSym) => {
                  const val = matrix[rowSym]?.[colSym] ?? matrix[colSym]?.[rowSym];
                  return (
                    <td
                      key={colSym}
                      className="border-b border-border px-2 py-1.5 text-right"
                      style={Number.isFinite(val) ? { backgroundColor: corrColor(val) } : undefined}
                    >
                      {Number.isFinite(val) ? val.toFixed(2) : "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Cell shading: green for positive correlation, red for negative.
      </p>
      {warnings.length > 0 ? (
        <ul className="grid gap-1 text-[11px] text-muted-foreground">
          {warnings.map((w) => (
            <li key={w}>· {w}</li>
          ))}
        </ul>
      ) : null}
    </ToolCard>
  );
}

function corrColor(v) {
  const clamped = Math.max(-1, Math.min(1, v));
  if (clamped >= 0) return `hsl(142 71% 35% / ${(clamped * 0.18).toFixed(3)})`;
  return `hsl(0 84% 60% / ${(Math.abs(clamped) * 0.18).toFixed(3)})`;
}

export function WatchlistCard({ message, header, text }) {
  const d = extractDetails(message);
  const symbols = Array.isArray(d?.symbols)
    ? d.symbols
    : Array.isArray(d?.watchlist)
      ? d.watchlist
      : Array.isArray(d)
        ? d
        : null;
  if (!symbols || symbols.length === 0) {
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
      <div className="text-xs text-muted-foreground">
        {symbols.length} symbol{symbols.length === 1 ? "" : "s"}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {symbols.map((s) => (
          <Badge variant="outline" key={typeof s === "string" ? s : s.symbol} className="font-mono">
            {typeof s === "string" ? s : s.symbol}
          </Badge>
        ))}
      </div>
    </ToolCard>
  );
}

export function SECFilingsCard({ message, header, text }) {
  const d = extractDetails(message);
  const filings = Array.isArray(d?.filings)
    ? d.filings
    : Array.isArray(d?.results)
      ? d.results
      : Array.isArray(d)
        ? d
        : null;
  if (!filings || filings.length === 0) {
    return (
      <ToolCard>
        {header}
        <PlainOutput text={text} />
      </ToolCard>
    );
  }
  const symbol = d?.symbol;
  const entity = filings[0]?.entityName;
  return (
    <ToolCard>
      {header}
      <div className="text-xs text-muted-foreground">
        {symbol ? <span className="font-mono text-foreground">{symbol}</span> : null}
        {entity ? <span> · {entity}</span> : null}
        <span>
          {" "}
          · {filings.length} filing{filings.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="grid gap-0.5">
        {filings.slice(0, 10).map((f, i) => {
          const filed = f.filedDate || f.filedAt || f.filingDate || f.acceptedAt;
          const form = f.formType || f.form || f.type;
          const period = f.periodOfReport;
          const url = f.url || f.documentUrl || f.link;
          const accession = f.accessionNumber;
          const Tag = url ? "a" : "div";
          return (
            <li key={accession || `${form}-${filed}-${i}`}>
              <Tag
                href={url || undefined}
                target={url ? "_blank" : undefined}
                rel={url ? "noreferrer" : undefined}
                className="grid min-h-10 grid-cols-[20px_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-1.5 transition-[background-color,transform,scale] duration-150 ease-out hover:bg-secondary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                <Favicon url="https://www.sec.gov" size="sm" />
                <Badge variant="outline" size="sm" className="font-mono">
                  {form || "—"}
                </Badge>
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] text-foreground">
                    {period
                      ? `Period ${period}`
                      : f.title || f.description || f.primaryDocument || "Filing"}
                  </div>
                  {accession ? (
                    <div className="truncate font-mono text-[10.5px] text-muted-foreground">
                      {accession}
                    </div>
                  ) : null}
                </div>
                <span className="whitespace-nowrap text-[10.5px] tabular-nums text-muted-foreground">
                  {filed ? relativeTime(filed) : "—"}
                </span>
              </Tag>
            </li>
          );
        })}
      </ul>
    </ToolCard>
  );
}
