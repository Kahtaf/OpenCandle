import { Badge } from "../../../components/ui/badge.jsx";
import { Favicon } from "../../../components/ui/favicon.jsx";
import { hostFrom } from "../../../components/ui/favicon-utils.js";
import { SourcePill } from "../../../components/ui/source-pill.jsx";
import { MoneyTile, PlainOutput, Sparkline, StackBar, ToolCard } from "./_shared.jsx";
import { extractDetails, formatLargeNumber, relativeTime } from "./card-format.js";

export function WebSearchCard({ message, header, text }) {
  const d = extractDetails(message);
  const results = Array.isArray(d?.results) ? d.results : Array.isArray(d) ? d : null;
  if (!results || results.length === 0) {
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
      {d.query || results.length ? (
        <div className="text-xs text-muted-foreground">
          {d.query ? (
            <>
              “<span className="text-foreground">{d.query}</span>” ·{" "}
            </>
          ) : null}
          {results.length} result{results.length === 1 ? "" : "s"}
          {d.provider ? <> · via {d.provider}</> : null}
        </div>
      ) : null}
      {/* Favicon chip row for at-a-glance source overview. Hover reveals title/snippet. */}
      <div className="flex flex-wrap gap-1.5">
        {results.slice(0, 12).map((r, i) => (
          <SourcePill
            key={`pill-${r.url || r.title || i}`}
            url={r.url}
            title={r.title}
            snippet={r.snippet}
          />
        ))}
      </div>
      {/* Detailed result rows below */}
      <ul className="grid gap-1.5">
        {results.slice(0, 8).map((r, i) => (
          <li key={`row-${r.url || r.title || i}`}>
            <a
              href={r.url || undefined}
              target={r.url ? "_blank" : undefined}
              rel={r.url ? "noreferrer" : undefined}
              className="grid min-h-10 grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-md px-1 py-1.5 transition-[background-color,transform,scale] duration-150 ease-out hover:bg-secondary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              <Favicon url={r.url} size="sm" className="mt-0.5" />
              <div className="min-w-0">
                <div className="line-clamp-1 text-[13px] font-medium text-foreground">
                  {r.title}
                </div>
                {r.snippet ? (
                  <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-relaxed text-muted-foreground">
                    {r.snippet}
                  </p>
                ) : null}
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
                  <span className="truncate">{hostFrom(r.url) || r.source}</span>
                  {r.published ? <span>· {relativeTime(r.published)}</span> : null}
                  {r.category && r.category !== "general" ? (
                    <Badge variant="outline" size="sm">
                      {r.category}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </ToolCard>
  );
}

export function SocialSentimentCard({ message, header, text, sourceLabel }) {
  const d = extractDetails(message);
  const score = Number.isFinite(d?.sentimentScore) ? d.sentimentScore : null;
  const bullish = d?.bullishCount ?? 0;
  const bearish = d?.bearishCount ?? 0;
  if (score === null && bullish + bearish === 0) {
    return (
      <ToolCard>
        {header}
        <PlainOutput text={text} />
      </ToolCard>
    );
  }
  const tone =
    score === null
      ? "text-foreground"
      : score > 0.15
        ? "text-success"
        : score < -0.15
          ? "text-destructive"
          : "text-foreground";
  const items = (d?.tweets || d?.posts || []).slice(0, 4);
  const subject = d?.query || d?.subreddit;
  const insight = d?.insight || null;
  return (
    <ToolCard>
      {header}
      {sourceLabel || subject ? (
        <div className="text-xs text-muted-foreground">
          {sourceLabel ? <span>{sourceLabel}</span> : null}
          {sourceLabel && subject ? <span> · </span> : null}
          {subject ? <span className="font-mono text-foreground">{subject}</span> : null}
        </div>
      ) : null}
      {score !== null ? (
        <div className="flex flex-wrap items-baseline gap-3">
          <span className={`text-3xl font-semibold tabular-nums tracking-tight ${tone}`}>
            {score >= 0 ? "+" : "−"}
            {Math.abs(score).toFixed(2)}
          </span>
          <span className="text-xs text-muted-foreground">{labelForScore(score)}</span>
        </div>
      ) : null}
      <StackBar
        left={bullish}
        right={bearish}
        leftLabel={`Bullish ${bullish}`}
        rightLabel={`Bearish ${bearish}`}
      />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <MoneyTile
          label="Sample size"
          value={d?.tweetCount ?? d?.postCount ?? items.length ?? "—"}
        />
        <MoneyTile label="Bullish" value={bullish} tone="success" />
        <MoneyTile label="Bearish" value={bearish} tone="destructive" />
      </div>
      {Array.isArray(d?.topMentions) && d.topMentions.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {d.topMentions.slice(0, 8).map((m) => (
            <Badge variant="outline" key={m} className="font-mono">
              {m}
            </Badge>
          ))}
        </div>
      ) : null}
      <InsightPanel insight={insight} />
      {items.length > 0 ? (
        <div className="rounded-md border border-border">
          <div className="border-b border-border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Top items
          </div>
          <ul>
            {items.map((it, i) => {
              const url = it.url || it.permalink;
              return (
                <li key={it.id || i} className="border-b border-border last:border-b-0">
                  <a
                    href={url || undefined}
                    target={url ? "_blank" : undefined}
                    rel={url ? "noreferrer" : undefined}
                    className="grid min-h-10 grid-cols-[20px_minmax(0,1fr)] items-start gap-2 px-3 py-2 transition-[background-color,transform,scale] duration-150 ease-out hover:bg-secondary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                  >
                    <Favicon url={url} size="sm" className="mt-0.5" />
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-xs leading-relaxed text-foreground">
                        {it.title || it.text}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
                        {it.author ? <span>{it.author}</span> : null}
                        {Number.isFinite(it.score) ? (
                          <span>· {formatLargeNumber(it.score)} pts</span>
                        ) : null}
                        {Number.isFinite(it.likes) ? (
                          <span>· {formatLargeNumber(it.likes)} likes</span>
                        ) : null}
                        {Number.isFinite(it.comments) ? (
                          <span>· {formatLargeNumber(it.comments)} comments</span>
                        ) : null}
                        {it.created ? <span>· {relativeTime(it.created)}</span> : null}
                      </div>
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </ToolCard>
  );
}

export function WebSentimentCard({ message, header, text }) {
  const d = extractDetails(message);
  const records = Array.isArray(d?.fresh) ? d.fresh : Array.isArray(d?.records) ? d.records : null;
  if (!records || records.length === 0) {
    return (
      <SocialSentimentCard
        message={message}
        header={header}
        text={text}
        sourceLabel="Web sentiment"
      />
    );
  }
  const scores = records.map((r) => r.sentiment?.score).filter(Number.isFinite);
  const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const bullish = scores.filter((s) => s > 0.15).length;
  const bearish = scores.filter((s) => s < -0.15).length;
  const tone =
    avg === null
      ? "text-foreground"
      : avg > 0.15
        ? "text-success"
        : avg < -0.15
          ? "text-destructive"
          : "text-foreground";
  const trendValues =
    Array.isArray(d?.trend) && d.trend[0]?.values
      ? d.trend[0].values.filter(Number.isFinite)
      : null;
  return (
    <ToolCard>
      {header}
      <div className="text-xs text-muted-foreground">
        Web sentiment{" "}
        {d?.query ? (
          <>
            for <span className="font-mono text-foreground">{d.query}</span>
          </>
        ) : null}
      </div>
      {avg !== null ? (
        <div className="flex flex-wrap items-baseline gap-3">
          <span className={`text-3xl font-semibold tabular-nums tracking-tight ${tone}`}>
            {avg >= 0 ? "+" : "−"}
            {Math.abs(avg).toFixed(2)}
          </span>
          <span className="text-xs text-muted-foreground">{labelForScore(avg)}</span>
        </div>
      ) : null}
      <StackBar
        left={bullish}
        right={bearish}
        leftLabel={`Bullish ${bullish}`}
        rightLabel={`Bearish ${bearish}`}
        neutral={records.length - bullish - bearish}
        neutralLabel={`Neutral ${records.length - bullish - bearish}`}
      />
      {trendValues && trendValues.length > 1 ? (
        <Sparkline values={trendValues} height={48} />
      ) : null}
      <InsightPanel insight={d?.insight} />
      {/* Source pill row above the detailed list */}
      <div className="flex flex-wrap gap-1.5">
        {records.slice(0, 10).map((r, i) => (
          <SourcePill
            key={`wp-${r.url || r.id || i}`}
            url={r.url}
            title={r.title}
            snippet={r.snippet || r.summary}
          />
        ))}
      </div>
      <ul className="grid gap-1">
        {records.slice(0, 6).map((r, i) => {
          const score = r.sentiment?.score;
          const scoreTone = !Number.isFinite(score)
            ? "text-muted-foreground"
            : score > 0.15
              ? "text-success"
              : score < -0.15
                ? "text-destructive"
                : "text-muted-foreground";
          const Tag = r.url ? "a" : "div";
          return (
            <li key={r.id || r.url || i}>
              <Tag
                href={r.url || undefined}
                target={r.url ? "_blank" : undefined}
                rel={r.url ? "noreferrer" : undefined}
                className="grid min-h-10 grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-md px-1 py-1.5 transition-[background-color,transform,scale] duration-150 ease-out hover:bg-secondary active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
              >
                <Favicon url={r.url} size="sm" className="mt-0.5" />
                <div className="min-w-0">
                  <div className="line-clamp-1 text-[12.5px] text-foreground">{r.title}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
                    {r.author ? <span>{r.author}</span> : null}
                    {r.published ? <span>· {relativeTime(r.published)}</span> : null}
                  </div>
                </div>
                <span className={`shrink-0 text-[11px] tabular-nums ${scoreTone}`}>
                  {Number.isFinite(score)
                    ? `${score >= 0 ? "+" : "−"}${Math.abs(score).toFixed(2)}`
                    : "—"}
                </span>
              </Tag>
            </li>
          );
        })}
      </ul>
    </ToolCard>
  );
}

export function SentimentSummaryCard({ message, header, text }) {
  const d = extractDetails(message);
  const sources = d?.sources || d?.bySource || null;
  const insight = d?.insight || null;
  const score = Number.isFinite(d?.score)
    ? d.score
    : Number.isFinite(d?.aggregateScore)
      ? d.aggregateScore
      : null;
  const trend = Array.isArray(d?.trend)
    ? d.trend.map((t) => Number(t.score ?? t.value)).filter(Number.isFinite)
    : null;
  if (score === null && !sources) {
    return (
      <ToolCard>
        {header}
        <InsightPanel insight={insight} />
        <PlainOutput text={text} />
      </ToolCard>
    );
  }
  const tone =
    score === null
      ? "text-foreground"
      : score > 0.15
        ? "text-success"
        : score < -0.15
          ? "text-destructive"
          : "text-foreground";
  return (
    <ToolCard>
      {header}
      {score !== null ? (
        <div className="flex flex-wrap items-baseline gap-3">
          <span className={`text-3xl font-semibold tabular-nums tracking-tight ${tone}`}>
            {score >= 0 ? "+" : "−"}
            {Math.abs(score).toFixed(2)}
          </span>
          <span className="text-xs text-muted-foreground">{labelForScore(score)}</span>
        </div>
      ) : null}
      {trend && trend.length > 1 ? <Sparkline values={trend} height={48} /> : null}
      <InsightPanel insight={insight} />
      {sources ? (
        <div className="grid gap-1">
          {Object.entries(sources).map(([key, value]) => {
            const sc = typeof value === "object" ? (value.score ?? value.sentimentScore) : value;
            return (
              <div
                className="flex items-center justify-between border-b border-border py-1.5 last:border-b-0"
                key={key}
              >
                <span className="text-xs text-muted-foreground">{key}</span>
                <span className="text-sm font-medium tabular-nums text-foreground">
                  {Number.isFinite(sc) ? sc.toFixed(2) : "—"}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </ToolCard>
  );
}

function InsightPanel({ insight }) {
  if (!insight) return null;
  const confidence = insight.confidence || {};
  const representativeCount = Array.isArray(insight.representativeItems)
    ? insight.representativeItems.length
    : 0;
  return (
    <div className="grid gap-2 rounded-md border border-border bg-secondary/35 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Findings
        </div>
        <Badge variant="outline" className="capitalize">
          {confidence.level || "unknown"} confidence
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <MoneyTile label="Scored sample" value={insight.sampleSize ?? "—"} />
        <MoneyTile label="With evidence" value={insight.scoredSampleSize ?? "—"} />
        <MoneyTile label="Preview shown" value={representativeCount} />
      </div>
      <DriverList label="Positive drivers" drivers={insight.positiveDrivers} />
      <DriverList label="Negative drivers" drivers={insight.negativeDrivers} />
      <DriverList label="Mixed drivers" drivers={insight.mixedDrivers} />
      {Array.isArray(insight.caveats) && insight.caveats.length > 0 ? (
        <div className="grid gap-1">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Caveats
          </div>
          <ul className="grid gap-1 text-[11.5px] leading-relaxed text-muted-foreground">
            {insight.caveats.slice(0, 3).map((caveat) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {representativeCount > 0 ? (
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Representative evidence preview: {representativeCount} shown from{" "}
          {insight.scoredSampleSize ?? "the scored"} scored records
          {insight.sampleSize != null ? ` (${insight.sampleSize} total records).` : "."}
        </p>
      ) : null}
    </div>
  );
}

function DriverList({ label, drivers }) {
  if (!Array.isArray(drivers) || drivers.length === 0) return null;
  return (
    <div className="grid gap-1">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {drivers.slice(0, 4).map((driver) => (
          <Badge variant="outline" key={`${driver.polarity}-${driver.label}`}>
            Source evidence: {driver.label} ({driver.count})
          </Badge>
        ))}
      </div>
    </div>
  );
}

function labelForScore(score) {
  if (score >= 0.5) return "strongly bullish";
  if (score >= 0.15) return "leaning bullish";
  if (score <= -0.5) return "strongly bearish";
  if (score <= -0.15) return "leaning bearish";
  return "neutral";
}
