import { MoneyTile, PlainOutput, StackBar, ToolCard } from "./_shared.jsx";
import { extractDetails, formatDateShort, formatLargeNumber, formatPrice } from "./card-format.js";

export function OptionsChainCard({ message, header, text }) {
  const d = extractDetails(message);
  if (!d?.symbol) {
    return (
      <ToolCard>
        {header}
        <PlainOutput text={text} />
      </ToolCard>
    );
  }
  const calls = Array.isArray(d.calls) ? d.calls : [];
  const puts = Array.isArray(d.puts) ? d.puts : [];
  const callVol = Number.isFinite(d.totalCallVolume)
    ? d.totalCallVolume
    : calls.reduce((a, c) => a + (c.volume || 0), 0);
  const putVol = Number.isFinite(d.totalPutVolume)
    ? d.totalPutVolume
    : puts.reduce((a, c) => a + (c.volume || 0), 0);
  const allIVs = [...calls, ...puts].map((c) => c.impliedVolatility).filter(Number.isFinite);
  const avgIV = allIVs.length ? allIVs.reduce((a, b) => a + b, 0) / allIVs.length : null;
  const otmCalls = calls.filter((c) => !c.inTheMoney).slice(0, 4);
  const otmPuts = puts.filter((c) => !c.inTheMoney).slice(0, 4);

  return (
    <ToolCard>
      {header}
      <div>
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="font-mono text-base font-medium text-foreground">{d.symbol}</span>
          <span className="text-xl font-semibold tabular-nums tracking-tight text-foreground">
            {formatPrice(d.underlyingPrice)}
          </span>
          <span className="text-xs text-muted-foreground">underlying</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Expiration {formatDateShort(d.expirationDate)} · {d.expirationDates?.length ?? 0} dates
          available
        </div>
      </div>
      <StackBar
        left={callVol}
        right={putVol}
        leftLabel={`Calls ${formatLargeNumber(callVol)}`}
        rightLabel={`Puts ${formatLargeNumber(putVol)}`}
      />
      <div className="text-[11px] tabular-nums text-muted-foreground">
        Put/Call ratio{" "}
        <span className="text-foreground">
          {Number.isFinite(d.putCallRatio) ? d.putCallRatio.toFixed(2) : "—"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MoneyTile
          label="Avg IV"
          value={Number.isFinite(avgIV) ? `${(avgIV * 100).toFixed(1)}%` : "—"}
        />
        <MoneyTile label="Call contracts" value={calls.length} />
        <MoneyTile label="Put contracts" value={puts.length} />
        <MoneyTile label="Total volume" value={formatLargeNumber(callVol + putVol)} />
      </div>
      {otmCalls.length > 0 || otmPuts.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {otmCalls.length > 0 ? <ContractList title="OTM calls" rows={otmCalls} /> : null}
          {otmPuts.length > 0 ? <ContractList title="OTM puts" rows={otmPuts} /> : null}
        </div>
      ) : null}
    </ToolCard>
  );
}

function ContractList({ title, rows }) {
  return (
    <div className="rounded-md border border-border">
      <div className="border-b border-border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <ul>
        {rows.map((c) => (
          <li
            key={c.contractSymbol}
            className="grid grid-cols-3 items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0 text-xs tabular-nums"
          >
            <span className="text-foreground">{formatPrice(c.strike)}</span>
            <span className="text-muted-foreground">last {formatPrice(c.lastPrice)}</span>
            <span className="text-right text-muted-foreground">
              IV{" "}
              {Number.isFinite(c.impliedVolatility)
                ? `${(c.impliedVolatility * 100).toFixed(0)}%`
                : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
