// biome-ignore-all lint/security/noDangerouslySetInnerHtml: PlainOutput renders sanitized rich text from renderRichText.

import { Badge } from "../../../components/ui/badge.jsx";
import { cn } from "../../../lib/utils.js";
import { renderRichText } from "../../../rendering/text.js";
import { stripOpenCandleTags } from "./card-format.js";

export function ToolCard({ children, isError, className }) {
  return (
    <div
      className={cn(
        "grid max-w-[760px] gap-3 rounded-lg border border-border bg-card p-4",
        isError && "border-destructive",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ToolHeader({ category, title, manual, isError }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge>{category}</Badge>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{title}</span>
      {isError ? <Badge variant="destructive">error</Badge> : null}
      {manual ? <Badge variant="warning">manual</Badge> : null}
    </div>
  );
}

export function WarningRow({ items }) {
  if (!items?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((w) => (
        <Badge variant="warning" key={w}>
          {w}
        </Badge>
      ))}
    </div>
  );
}

export function MoneyTile({ label, value, tone, className }) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "destructive"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className={cn("min-w-0 rounded-md bg-secondary px-3 py-2.5", className)}>
      <div className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-0.5 truncate tabular-nums text-sm font-medium", toneClass)}>
        {value}
      </div>
    </div>
  );
}

export function StatRow({ label, value, tone, mono = true }) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "destructive"
        ? "text-destructive"
        : "text-foreground";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-1.5 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm", mono && "tabular-nums", toneClass, "font-medium")}>
        {value}
      </span>
    </div>
  );
}

export function DeltaChip({ value, percent, prefix = "$", size = "md" }) {
  const ref = Number.isFinite(percent) ? percent : value;
  const positive = (ref ?? 0) >= 0;
  const arrow = positive ? "↑" : "↓";
  const tone = positive ? "text-success" : "text-destructive";
  const parts = [];
  if (Number.isFinite(value)) {
    parts.push(`${prefix}${Math.abs(value).toFixed(2)}`);
  }
  if (Number.isFinite(percent)) {
    parts.push(`${Math.abs(percent).toFixed(2)}%`);
  }
  const sizeClass = size === "lg" ? "text-base" : "text-sm";
  return (
    <span
      className={cn("inline-flex items-center gap-1 font-medium tabular-nums", sizeClass, tone)}
    >
      <span aria-hidden="true">{arrow}</span>
      <span>{parts.join(" · ") || "—"}</span>
    </span>
  );
}

export function Sparkline({ values, height = 56, className, fill = true }) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const width = 600;
  const numeric = values.filter((v) => Number.isFinite(v));
  if (numeric.length < 2) return null;
  const vmin = Math.min(...numeric);
  const vmax = Math.max(...numeric);
  const span = vmax - vmin || 1;
  const last = numeric[numeric.length - 1];
  const first = numeric[0];
  const positive = last >= first;
  const stroke = positive ? "hsl(var(--tw-success))" : "hsl(var(--tw-destructive))";
  const fillColor = positive
    ? "hsl(var(--tw-success) / 0.10)"
    : "hsl(var(--tw-destructive) / 0.10)";
  const points = numeric.map((v, i) => {
    const x = (i / (numeric.length - 1)) * width;
    const y = height - ((v - vmin) / span) * height;
    return [x, y];
  });
  const path = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  const area = `${path} L${width.toFixed(1)},${height.toFixed(1)} L0,${height.toFixed(1)} Z`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn("w-full", className)}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {fill ? <path d={area} fill={fillColor} stroke="none" /> : null}
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function RangeBar({ low, high, current, label, prefix = "$" }) {
  if (!Number.isFinite(low) || !Number.isFinite(high) || !Number.isFinite(current)) return null;
  const span = high - low || 1;
  const pct = Math.max(0, Math.min(100, ((current - low) / span) * 100));
  return (
    <div>
      {label ? (
        <div className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          <span>{label}</span>
          <span className="tabular-nums normal-case tracking-normal">{Math.round(pct)}%</span>
        </div>
      ) : null}
      <div className="relative h-1.5 rounded-full bg-secondary">
        <div
          className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-foreground"
          style={{ left: `${pct}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>
          {prefix}
          {Number(low).toFixed(2)}
        </span>
        <span>
          {prefix}
          {Number(high).toFixed(2)}
        </span>
      </div>
    </div>
  );
}

export function StackBar({
  left,
  right,
  leftLabel,
  rightLabel,
  leftClass = "bg-success",
  rightClass = "bg-destructive",
  neutral,
  neutralLabel,
  neutralClass = "bg-hard",
}) {
  const total = (left || 0) + (right || 0) + (neutral || 0) || 1;
  const lp = ((left || 0) / total) * 100;
  const np = ((neutral || 0) / total) * 100;
  const rp = ((right || 0) / total) * 100;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
        <span>{leftLabel}</span>
        {neutralLabel ? <span>{neutralLabel}</span> : null}
        <span>{rightLabel}</span>
      </div>
      <div className="mt-1 flex h-2 overflow-hidden rounded-full bg-secondary">
        <div style={{ width: `${lp}%` }} className={leftClass} />
        {neutral ? <div style={{ width: `${np}%` }} className={neutralClass} /> : null}
        <div style={{ width: `${rp}%` }} className={rightClass} />
      </div>
    </div>
  );
}

export function RawDetails({ message, details, text }) {
  return (
    <details className="group">
      <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-1 rounded-sm px-2 text-[10.5px] uppercase tracking-wider text-muted-foreground/80 transition-[color,transform,scale] duration-150 ease-out hover:text-foreground active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="inline-block transition-transform group-open:rotate-90">
          ›
        </span>
        <span>Raw input · output</span>
      </summary>
      <pre className="mt-1.5 max-h-72 overflow-auto rounded-md border border-border bg-secondary/50 p-2 text-[11px] leading-relaxed text-muted-foreground">
        {JSON.stringify({ input: message?.details?.args || null, details, text }, null, 2)}
      </pre>
    </details>
  );
}

export function PlainOutput({ text }) {
  const cleaned = stripOpenCandleTags(text);
  if (!cleaned) return <div className="text-sm text-muted-foreground">No output returned.</div>;
  return (
    <div
      className="rich-text break-words text-[13px] leading-relaxed text-foreground"
      dangerouslySetInnerHTML={{ __html: renderRichText(cleaned) }}
    />
  );
}
