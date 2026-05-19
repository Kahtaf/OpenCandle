import { useMemo } from "react";
import { Activity, CheckCircle2, KeyRound, RefreshCcw, Settings2 } from "lucide-react";
import { Badge } from "../../components/ui/badge.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Sheet, SheetContent } from "../../components/ui/sheet.jsx";
import { cn } from "../../lib/utils.js";

// Friendly workflow-id → display name. Falls back to capitalized snake_case.
const WORKFLOW_NAMES = {
  comprehensive_analysis: "Comprehensive analysis",
  portfolio_builder: "Portfolio builder",
  options_screener: "Options screener",
  compare_assets: "Compare assets",
  single_asset_analysis: "Single-asset analysis",
  watchlist_or_tracking: "Watchlist update",
  general_finance_qa: "General Q&A",
};

export function FinancialContextDrawer({ open, state, catalog, onClose, onConfigureProvider }) {
  return (
    <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <SheetContent width="sm" handleLabel="Context" className="bg-card p-0">
        <Header state={state} />
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Watchlist rows={state?.watchlist ?? []} />
          <Analyses rows={state?.activeAnalyses ?? []} />
          <Research rows={state?.recentResearch ?? []} />
          <DataQuality state={state?.dataQuality ?? { softGaps: [], hardSkips: [] }} catalog={catalog} onConfigureProvider={onConfigureProvider} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Header — drops the misleading "{N} symbols" badge in favor of a quick
// status pill that reflects whatever's most actionable right now.
// ---------------------------------------------------------------------------

function Header({ state }) {
  const pill = useMemo(() => summarize(state), [state]);
  return (
    <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Context</span>
      {pill ? (
        <span className={cn(
          "inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium tabular-nums",
          pill.tone === "success" && "text-success",
          pill.tone === "warning" && "text-warning",
          pill.tone === "info" && "text-info",
          pill.tone === "muted" && "text-muted-foreground",
        )}>
          <span className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            pill.tone === "success" && "bg-success",
            pill.tone === "warning" && "bg-warning",
            pill.tone === "info" && "bg-info",
            pill.tone === "muted" && "bg-muted-foreground/40",
          )} />
          {pill.label}
        </span>
      ) : null}
    </div>
  );
}

function summarize(state) {
  if (!state) return null;
  const hardSet = new Set((state.dataQuality?.hardSkips ?? []).map((g) => g.provider));
  const softSet = new Set((state.dataQuality?.softGaps ?? []).map((g) => g.provider));
  if (hardSet.size > 0) return { tone: "warning", label: `${hardSet.size} provider${hardSet.size === 1 ? "" : "s"} need a key` };
  if ((state.activeAnalyses ?? []).length > 0) return { tone: "info", label: `${state.activeAnalyses.length} running` };
  if (softSet.size > 0) return { tone: "muted", label: `${softSet.size} data gap${softSet.size === 1 ? "" : "s"}` };
  if ((state.watchlist ?? []).length > 0) return { tone: "success", label: "All clear" };
  return null;
}

// ---------------------------------------------------------------------------
// Section — uppercase label + optional right-aligned meta. No nested cards;
// hairline dividers carry the grouping per DESIGN.md.
// ---------------------------------------------------------------------------

function Section({ title, meta, children, last = false }) {
  return (
    <section className={cn("px-3 pt-3", last ? "pb-4" : "pb-3 border-b border-border")}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{title}</h3>
        {meta ? <span className="text-[11px] tabular-nums text-muted-foreground/70">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

function EmptyHint({ children }) {
  return <p className="py-1 text-xs text-muted-foreground">{children}</p>;
}

function Row({ children, className }) {
  return (
    <div className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2 first:pt-1 last:pb-0", className)}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recent quotes (was "Watchlist" — but it shows symbols *seen* via tool calls,
// not the user's saved manage_watchlist entries).
// ---------------------------------------------------------------------------

function Watchlist({ rows }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => {
    const ta = Date.parse(a.lastSeen ?? "") || 0;
    const tb = Date.parse(b.lastSeen ?? "") || 0;
    return tb - ta;
  }), [rows]);

  return (
    <Section title="Recent quotes" meta={sorted.length ? `${sorted.length}` : null}>
      {sorted.length === 0 ? (
        <EmptyHint>No quotes pulled yet. Try <code className="font-mono text-foreground/70">/quote AAPL</code> or run a workflow.</EmptyHint>
      ) : (
        <div className="divide-y divide-border">
          {sorted.map((row) => (
            <QuoteRow key={row.symbol} row={row} />
          ))}
        </div>
      )}
    </Section>
  );
}

function QuoteRow({ row }) {
  const pct = Number(row.quote?.changePercent);
  const price = Number(row.quote?.price);
  const hasQuote = Number.isFinite(price);
  const hasChange = Number.isFinite(pct);
  const positive = hasChange && pct >= 0;
  return (
    <Row>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tabular-nums text-foreground">{row.symbol}</span>
          {row.lastSeen ? <span className="text-[11px] text-muted-foreground/70">{relativeTime(row.lastSeen)}</span> : null}
        </div>
        <div className="text-xs tabular-nums text-muted-foreground">
          {hasQuote ? formatPrice(price) : <span className="italic text-muted-foreground/70">No quote</span>}
        </div>
      </div>
      {hasChange ? (
        <span className={cn("text-sm font-medium tabular-nums", positive ? "text-success" : "text-destructive")}>
          {positive ? "+" : ""}{pct.toFixed(2)}%
        </span>
      ) : null}
    </Row>
  );
}

// ---------------------------------------------------------------------------
// Active analyses — friendly workflow names, symbol chip, elapsed time
// ---------------------------------------------------------------------------

function Analyses({ rows }) {
  return (
    <Section title="Active analyses" meta={rows.length ? `${rows.length}` : null}>
      {rows.length === 0 ? (
        <EmptyHint>None running. Start one from <span className="text-foreground/80">Catalog → Workflows</span>.</EmptyHint>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((item) => (
            <Row key={item.workflowId}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Activity aria-hidden="true" className="h-3 w-3 animate-pulse text-info" />
                  <span className="truncate text-sm font-medium text-foreground">{friendlyWorkflow(item.workflow)}</span>
                  {item.symbol ? <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-foreground">{item.symbol}</span> : null}
                </div>
                <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                  {item.startedAt ? `${relativeTime(item.startedAt)}` : "just started"}
                  {item.analystsTotal > 0 ? (
                    <span> · {item.analystsDone}/{item.analystsTotal} analysts</span>
                  ) : null}
                </div>
              </div>
              {item.analystsTotal > 0 ? (
                <ProgressDot done={item.analystsDone} total={item.analystsTotal} />
              ) : null}
            </Row>
          ))}
        </div>
      )}
    </Section>
  );
}

function ProgressDot({ done, total }) {
  const pct = Math.max(0, Math.min(100, total > 0 ? Math.round((done / total) * 100) : 0));
  return <span className="text-[11px] tabular-nums text-muted-foreground">{pct}%</span>;
}

// ---------------------------------------------------------------------------
// Recent research — completed workflows, with relative time
// ---------------------------------------------------------------------------

function Research({ rows }) {
  return (
    <Section title="Recent research" meta={rows.length ? `${rows.length}` : null}>
      {rows.length === 0 ? (
        <EmptyHint>Completed workflows will appear here.</EmptyHint>
      ) : (
        <div className="divide-y divide-border">
          {rows.map((item) => (
            <Row key={`${item.sessionId}-${item.completedAt}`}>
              <div className="min-w-0 flex items-center gap-2">
                <span className="truncate text-sm text-foreground">{friendlyWorkflow(item.workflow)}</span>
                {item.symbol ? <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-foreground">{item.symbol}</span> : null}
              </div>
              <span className="text-[11px] tabular-nums text-muted-foreground">{relativeTime(item.completedAt)}</span>
            </Row>
          ))}
        </div>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Data quality — the section that needed the most help. Aggregates by
// provider+kind, looks up display names, and surfaces a single "Configure"
// CTA for hard skips (missing keys) instead of a wall of "fred · gap" rows.
// ---------------------------------------------------------------------------

function DataQuality({ state, catalog, onConfigureProvider }) {
  const aggregated = useMemo(() => aggregateGaps(state, catalog), [state, catalog]);
  const total = aggregated.length;

  return (
    <Section title="Data quality" meta={total ? `${total}` : null} last>
      {total === 0 ? (
        <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-success" />
          All providers reporting clean data this session.
        </div>
      ) : (
        <div className="grid divide-y divide-border">
          {aggregated.map((gap) => (
            <GapRow key={`${gap.kind}-${gap.providerId}`} gap={gap} onConfigure={() => onConfigureProvider?.(gap.providerId)} />
          ))}
        </div>
      )}
    </Section>
  );
}

function GapRow({ gap, onConfigure }) {
  const isHard = gap.kind === "hard";
  return (
    <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3 py-2.5">
      <span aria-hidden="true" className={cn("mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full", isHard ? "bg-warning/15 text-warning" : "bg-muted/15 text-muted-foreground")}>
        {isHard ? <KeyRound className="h-3 w-3" /> : <RefreshCcw className="h-3 w-3" />}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">{gap.displayName}</span>
          <Badge variant={isHard ? "warning" : "outline"} className="h-4 px-1.5 text-[10px]">
            {isHard ? "Missing key" : "Data gap"}
          </Badge>
        </div>
        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">
          {isHard
            ? <>Skipped {gap.count}× — add an API key to unlock {gap.unlocks || "this provider's tools"}.</>
            : <>Reported a data gap {gap.count}× this session{gap.fallbackDescription ? ` — ${gap.fallbackDescription}` : ""}.</>}
          {gap.lastSeen ? <> · last {relativeTime(gap.lastSeen)}</> : null}
        </p>
      </div>
      {isHard ? (
        <Button variant="bordered" size="xs" prefixIcon={Settings2} onClick={onConfigure} className="shrink-0">
          Configure
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function friendlyWorkflow(id) {
  if (!id) return "Workflow";
  const known = WORKFLOW_NAMES[id];
  if (known) return known;
  return String(id).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function relativeTime(iso) {
  if (!iso) return "";
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const diffMs = Date.now() - ts;
  const sec = Math.round(diffMs / 1000);
  if (sec < 30) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

function formatPrice(price) {
  if (price >= 1000) return `$${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${price.toFixed(2)}`;
}

function aggregateGaps(state, catalog) {
  if (!state) return [];
  const providerLookup = new Map();
  for (const provider of catalog?.providers ?? []) {
    providerLookup.set(provider.id, provider);
  }

  const groups = new Map();
  const record = (kind, raw) => {
    if (!raw?.provider) return;
    const key = `${kind}:${raw.provider}`;
    const ts = Date.parse(raw.lastSeen ?? "");
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      if (Number.isFinite(ts) && ts > existing.tsLast) {
        existing.tsLast = ts;
        existing.lastSeen = raw.lastSeen;
      }
      return;
    }
    const meta = providerLookup.get(raw.provider);
    groups.set(key, {
      kind,
      providerId: raw.provider,
      displayName: meta?.displayName ?? defaultProviderName(raw.provider),
      unlocks: (meta?.unlocks ?? []).slice(0, 2).join(" + "),
      fallbackDescription: meta?.fallbackDescription ?? null,
      count: 1,
      tsLast: Number.isFinite(ts) ? ts : 0,
      lastSeen: raw.lastSeen ?? null,
    });
  };

  for (const gap of state.hardSkips ?? []) record("hard", gap);
  for (const gap of state.softGaps ?? []) record("soft", gap);

  return [...groups.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "hard" ? -1 : 1;
    return b.tsLast - a.tsLast;
  });
}

function defaultProviderName(id) {
  return String(id || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
