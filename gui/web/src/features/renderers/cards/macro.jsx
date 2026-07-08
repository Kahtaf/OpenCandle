import { Badge } from "../../../components/ui/badge.jsx";
import { DeltaChip, MoneyTile, PlainOutput, RangeBar, Sparkline, ToolCard } from "./_shared.jsx";
import { extractDetails, formatDateShort } from "./card-format.js";

export function MacroSeriesCard({ message, header, text }) {
  const d = extractDetails(message);
  const observations = Array.isArray(d?.observations) ? d.observations : [];
  if (observations.length === 0) {
    return (
      <ToolCard>
        {header}
        <PlainOutput text={text} />
      </ToolCard>
    );
  }
  const numeric = observations
    .map((o) => ({
      date: o.date,
      value: typeof o.value === "string" ? parseFloat(o.value) : o.value,
    }))
    .filter((o) => Number.isFinite(o.value));
  if (numeric.length === 0) {
    return (
      <ToolCard>
        {header}
        <PlainOutput text={text} />
      </ToolCard>
    );
  }
  const latest = numeric[numeric.length - 1];
  const prior = numeric[numeric.length - 2];
  const change = prior ? latest.value - prior.value : null;
  const pct = prior && prior.value !== 0 ? (change / prior.value) * 100 : null;
  return (
    <ToolCard>
      {header}
      <div>
        <div className="text-base font-medium tracking-tight text-foreground">
          {d.title || d.id || "Series"}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {d.id ? <span className="font-mono">{d.id}</span> : null}
          {d.frequency ? <Badge variant="outline">{d.frequency}</Badge> : null}
          {d.units ? <span>{d.units}</span> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">
          {latest.value.toFixed(2)}
        </span>
        {change !== null ? <DeltaChip value={change} percent={pct} prefix="" /> : null}
        <span className="text-xs text-muted-foreground">{formatDateShort(latest.date)}</span>
      </div>
      <Sparkline values={numeric.map((o) => o.value)} height={64} />
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>{formatDateShort(numeric[0].date)}</span>
        <span>{numeric.length} observations</span>
        <span>{formatDateShort(latest.date)}</span>
      </div>
      {d.lastUpdated ? (
        <div className="text-[11px] text-muted-foreground">
          FRED last updated {formatDateShort(d.lastUpdated)}
        </div>
      ) : null}
    </ToolCard>
  );
}

export function FearGreedCard({ message, header, text }) {
  const d = extractDetails(message);
  if (!Number.isFinite(d?.value)) {
    return (
      <ToolCard>
        {header}
        <PlainOutput text={text} />
      </ToolCard>
    );
  }
  const tone = labelTone(d.label);
  return (
    <ToolCard>
      {header}
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-[3rem] font-semibold leading-none tabular-nums tracking-tight text-foreground">
          {d.value}
        </span>
        <span className={`text-base font-medium ${tone}`}>{d.label || "—"}</span>
        <span className="text-xs text-muted-foreground">/ 100</span>
      </div>
      <RangeBar low={0} high={100} current={d.value} label="Sentiment scale" prefix="" />
      <div className="grid grid-cols-3 gap-2">
        <MoneyTile
          label="Prev close"
          value={Number.isFinite(d.previousClose) ? d.previousClose : "—"}
        />
        <MoneyTile label="Week ago" value={Number.isFinite(d.weekAgo) ? d.weekAgo : "—"} />
        <MoneyTile label="Month ago" value={Number.isFinite(d.monthAgo) ? d.monthAgo : "—"} />
      </div>
    </ToolCard>
  );
}

function labelTone(label) {
  if (!label) return "text-foreground";
  const l = String(label).toLowerCase();
  if (l.includes("extreme fear")) return "text-destructive";
  if (l.includes("fear")) return "text-destructive";
  if (l.includes("extreme greed")) return "text-success";
  if (l.includes("greed")) return "text-success";
  return "text-foreground";
}
