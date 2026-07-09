import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button.jsx";
import { cn } from "../../lib/utils.js";
import { DesktopSidebarRestore, MobileHeader } from "../layout/AppShellChrome.jsx";
import { Badge, StatusBand } from "../market-state/shared.jsx";

const STATUS_META = {
  ready: { label: "Ready", tone: "success" },
  degraded: { label: "Degraded", tone: "warn" },
  blocked: { label: "Blocked", tone: "error" },
  pass: { label: "Pass", tone: "success", icon: CheckCircle2 },
  warn: { label: "Warn", tone: "warn", icon: AlertTriangle },
  fail: { label: "Fail", tone: "error", icon: XCircle },
  skip: { label: "Skip", tone: "muted", icon: CircleHelp },
  unknown: { label: "Info", tone: "muted", icon: CircleHelp },
};

export function confirmSessionCheck(confirmImpl = window.confirm) {
  return confirmImpl(
    "Session checks may read browser cookies or trigger platform permission prompts for Reddit and X/Twitter. Continue?",
  );
}

export function DiagnosticsPage({
  role,
  onOpenSidebar,
  onOpenHome,
  sidebarCollapsed = false,
  onExpandSidebar,
  onOpenProviders,
  onOpenModelSetup,
  setToast,
  initialReport,
}) {
  const [report, setReport] = useState(initialReport ?? null);
  const [loading, setLoading] = useState(!initialReport);
  const [checkingSessions, setCheckingSessions] = useState(false);
  const [error, setError] = useState("");

  const loadReport = useCallback(
    async ({ sessions = false } = {}) => {
      setLoading(!sessions);
      setCheckingSessions(sessions);
      setError("");
      try {
        const path = sessions ? "/api/doctor?sessions=1" : "/api/doctor";
        const response = await fetch(path);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || response.statusText);
        setReport(data);
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : String(loadError);
        setError(message);
        setToast?.(message, { destructive: true, title: "Diagnostics failed" });
      } finally {
        setLoading(false);
        setCheckingSessions(false);
      }
    },
    [setToast],
  );

  useEffect(() => {
    if (initialReport) return;
    void loadReport();
  }, [initialReport, loadReport]);

  const checkSessions = useCallback(() => {
    if (confirmSessionCheck()) void loadReport({ sessions: true });
  }, [loadReport]);

  const counts = useMemo(() => summarizeChecks(report), [report]);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
      <MobileHeader onOpenSidebar={onOpenSidebar} onOpenHome={onOpenHome} />
      {sidebarCollapsed ? <DesktopSidebarRestore onExpandSidebar={onExpandSidebar} /> : null}
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-3">
          <header className="flex flex-wrap items-center justify-between gap-3 px-1">
            <div className="min-w-0">
              <h1 className="m-0 text-balance text-[17px] font-semibold text-foreground">
                Diagnostics
              </h1>
              <p className="m-0 mt-1 text-pretty text-xs text-muted-foreground">
                {report?.summary || "Checking OpenCandle health..."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {report?.status ? (
                <Badge tone={badgeTone(STATUS_META[report.status]?.tone)}>
                  {STATUS_META[report.status]?.label}
                </Badge>
              ) : null}
              <Button
                type="button"
                variant="bordered"
                size="sm"
                prefixIcon={RefreshCw}
                disabled={loading || checkingSessions}
                onClick={() => loadReport()}
              >
                Refresh
              </Button>
              <Button
                type="button"
                variant="brand"
                size="sm"
                prefixIcon={ShieldCheck}
                disabled={loading || checkingSessions}
                onClick={checkSessions}
              >
                {checkingSessions ? "Checking..." : "Check sessions"}
              </Button>
            </div>
          </header>

          {error ? <StatusBand tone="error">{error}</StatusBand> : null}
          {role === "follower" ? (
            <StatusBand>
              Some setup changes are unavailable while OpenCandle reconnects local access.
            </StatusBand>
          ) : null}

          <div className="grid gap-3 md:grid-cols-4">
            <Metric label="Passed" value={counts.pass} tone="success" />
            <Metric label="Warnings" value={counts.warn} tone="warn" />
            <Metric label="Failures" value={counts.fail} tone="error" />
            <Metric label="Unchecked" value={counts.unknown + counts.skip} tone="muted" />
          </div>

          {loading && !report ? (
            <StatusBand>Loading diagnostics...</StatusBand>
          ) : (
            <div className="grid gap-3">
              {(report?.sections || []).map((section) => (
                <section
                  key={section.id}
                  className="rounded-xl border border-border bg-card p-3 shadow-subtle-xs"
                >
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h2 className="m-0 text-balance text-sm font-semibold text-foreground">
                      {section.label}
                    </h2>
                    <Badge tone={badgeTone(STATUS_META[section.status]?.tone)}>
                      {STATUS_META[section.status]?.label}
                    </Badge>
                  </div>
                  <div className="grid gap-2">
                    {section.checks.map((check) => (
                      <DiagnosticCheck
                        key={check.id}
                        check={check}
                        onOpenProviders={onOpenProviders}
                        onOpenModelSetup={onOpenModelSetup}
                        onCheckSessions={checkSessions}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </main>
    </section>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-subtle-xs">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", toneClass(tone))}>{value}</div>
    </div>
  );
}

function DiagnosticCheck({ check, onOpenProviders, onOpenModelSetup, onCheckSessions }) {
  const meta = STATUS_META[check.status] || STATUS_META.unknown;
  const Icon = meta.icon;
  const providerId = check.metadata?.providerId;
  const isProvider = Boolean(providerId);
  const isModel = check.id === "model.readiness";
  const isUncheckedSession = check.id?.endsWith(".session") && check.status === "unknown";

  return (
    <div className="grid gap-2 rounded-lg border border-border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? (
            <Icon className={cn("h-4 w-4 shrink-0", toneClass(meta.tone))} aria-hidden="true" />
          ) : null}
          <h3 className="m-0 truncate text-balance text-sm font-medium text-foreground">
            {check.label}
          </h3>
          <Badge tone={badgeTone(meta.tone)}>{meta.label}</Badge>
        </div>
        <p className="m-0 mt-1 text-pretty text-sm leading-5 text-muted-foreground">
          {check.summary}
        </p>
        {check.remediation ? (
          <p className="m-0 mt-1 text-pretty text-xs leading-5 text-muted-foreground">
            {check.remediation}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 sm:justify-end">
        {isProvider ? (
          <Button
            type="button"
            variant="bordered"
            size="sm"
            onClick={() => onOpenProviders?.(providerId)}
          >
            Providers
          </Button>
        ) : null}
        {isModel ? (
          <Button type="button" variant="bordered" size="sm" onClick={onOpenModelSetup}>
            Model setup
          </Button>
        ) : null}
        {isUncheckedSession ? (
          <Button type="button" variant="bordered" size="sm" onClick={onCheckSessions}>
            Check
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function summarizeChecks(report) {
  const summary = { pass: 0, warn: 0, fail: 0, unknown: 0, skip: 0 };
  for (const check of report?.sections?.flatMap((section) => section.checks) || []) {
    if (summary[check.status] !== undefined) summary[check.status]++;
  }
  return summary;
}

function toneClass(tone) {
  if (tone === "success") return "text-success";
  if (tone === "warn") return "text-warning";
  if (tone === "error") return "text-destructive";
  return "text-muted-foreground";
}

function badgeTone(tone) {
  if (tone === "success") return "ok";
  if (tone === "warn" || tone === "error") return "warn";
  return "neutral";
}
