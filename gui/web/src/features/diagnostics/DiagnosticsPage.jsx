import {
  AlertTriangle,
  CheckCircle2,
  CircleHelp,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table.jsx";
import { cn } from "../../lib/utils.js";
import { useRuntimeTransport } from "../../runtime/runtime-transport-context.js";
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

const SESSION_CHECK_WARNING =
  "Session checks may read browser cookies or trigger platform permission prompts for Reddit and X/Twitter. Continue?";

export function SessionCheckDialog({ open, onOpenChange, onConfirm }) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <SessionCheckDialogContent onConfirm={onConfirm} />
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SessionCheckDialogContent({ onConfirm }) {
  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>Check browser sessions?</AlertDialogTitle>
        <AlertDialogDescription>{SESSION_CHECK_WARNING}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm}>Continue</AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

/**
 * The health report itself, with no page frame: Settings mounts it as its
 * Diagnostics section. Everything below the report title, including the report
 * fetch, the refresh and session-check actions, and the session-check dialog,
 * belongs to this component.
 */
export function DiagnosticsContent({
  role,
  onOpenProviders,
  onOpenModelSetup,
  setToast,
  initialReport,
  dataQuality,
}) {
  const transport = useRuntimeTransport();
  const [report, setReport] = useState(initialReport ?? null);
  const [loading, setLoading] = useState(!initialReport);
  const [checkingSessions, setCheckingSessions] = useState(false);
  const [sessionCheckDialogOpen, setSessionCheckDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const hosted = report?.runtime === "hosted-web";

  const loadReport = useCallback(
    async ({ sessions = false } = {}) => {
      setLoading(!sessions);
      setCheckingSessions(sessions);
      setError("");
      try {
        const data = await transport.getDiagnostics({ sessions });
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
    [setToast, transport],
  );

  useEffect(() => {
    if (initialReport) return;
    void loadReport();
  }, [initialReport, loadReport]);

  const checkSessions = useCallback(() => {
    setSessionCheckDialogOpen(true);
  }, []);

  const confirmSessionCheck = useCallback(() => {
    setSessionCheckDialogOpen(false);
    void loadReport({ sessions: true });
  }, [loadReport]);

  const counts = useMemo(() => summarizeChecks(report), [report]);
  const dataQualityMessage = useMemo(() => {
    const missing = dataQuality?.hardSkips?.length || 0;
    const gaps = dataQuality?.softGaps?.length || 0;
    if (!missing && !gaps) return "";
    return missing
      ? `Data quality: ${missing} provider${missing === 1 ? " needs" : "s need"} setup.`
      : `Data quality: ${gaps} provider data gap${gaps === 1 ? "" : "s"} this session.`;
  }, [dataQuality]);

  return (
    <div className="flex min-w-0 flex-col gap-3" data-slot="diagnostics-content">
      <header className="flex flex-wrap items-center justify-between gap-3 px-1">
        <p className="m-0 min-w-0 text-pretty text-xs text-muted-foreground">
          {report?.summary || "Checking OpenCandle health..."}
        </p>
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
          {!hosted ? (
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
          ) : null}
        </div>
      </header>

      {error ? <StatusBand tone="error">{error}</StatusBand> : null}
      {role === "follower" && !hosted ? (
        <StatusBand>
          Some setup changes are unavailable while OpenCandle reconnects local access.
        </StatusBand>
      ) : null}
      {dataQualityMessage ? <StatusBand tone="warn">{dataQualityMessage}</StatusBand> : null}

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
              className="overflow-hidden rounded-xl border border-border bg-card shadow-subtle-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-3">
                <h2 className="m-0 text-balance text-sm font-semibold text-foreground">
                  {section.label}
                </h2>
                <Badge tone={badgeTone(STATUS_META[section.status]?.tone)}>
                  {STATUS_META[section.status]?.label}
                </Badge>
              </div>
              <Table>
                <TableHeader className="sr-only">
                  <TableRow>
                    <TableHead>Check</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {section.checks.map((check) => (
                    <DiagnosticCheck
                      key={check.id}
                      check={check}
                      onOpenProviders={onOpenProviders}
                      onOpenModelSetup={onOpenModelSetup}
                      onCheckSessions={checkSessions}
                    />
                  ))}
                </TableBody>
              </Table>
            </section>
          ))}
        </div>
      )}

      <footer className="border-t border-border px-1 pt-3 text-xs leading-5 text-muted-foreground">
        <p className="m-0">TradingView Lightweight Charts™</p>
        <p className="m-0">
          Copyright (c) 2025 TradingView, Inc.{" "}
          <a
            className="underline underline-offset-2 hover:text-foreground"
            href="https://www.tradingview.com/"
            target="_blank"
            rel="noreferrer"
          >
            https://www.tradingview.com/
          </a>
        </p>
      </footer>
      <SessionCheckDialog
        open={sessionCheckDialogOpen}
        onOpenChange={setSessionCheckDialogOpen}
        onConfirm={confirmSessionCheck}
      />
    </div>
  );
}

function Metric({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 shadow-subtle-xs">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          toneClass(value ? tone : "muted"),
        )}
      >
        {value}
      </div>
    </div>
  );
}

function DiagnosticCheck({ check, onOpenProviders, onOpenModelSetup, onCheckSessions }) {
  const meta = STATUS_META[check.status] || STATUS_META.unknown;
  const Icon = meta.icon;
  const providerId = check.metadata?.providerId;
  const isProvider = Boolean(providerId);
  const isMissingProvider =
    isProvider &&
    check.status === "skip" &&
    (check.id?.endsWith(".credential") || check.id?.endsWith(".binary"));
  const isModel = check.id === "model.readiness";
  const isUncheckedSession = check.id?.endsWith(".session") && check.status === "unknown";
  const remediation = isMissingProvider
    ? `Connect in OpenCandle to enable ${(check.metadata?.unlocks || []).join(", ") || "this provider"}.`
    : isUncheckedSession
      ? "Use Check to verify session readiness."
      : check.remediation;

  return (
    <TableRow>
      <TableCell className="min-w-[16rem] py-3">
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? (
            <Icon className={cn("h-4 w-4 shrink-0", toneClass(meta.tone))} aria-hidden="true" />
          ) : null}
          <h3 className="m-0 truncate text-balance text-sm font-medium text-foreground">
            {check.label}
          </h3>
        </div>
        <p className="m-0 mt-1 text-pretty text-sm leading-5 text-muted-foreground">
          {check.summary}
        </p>
        {remediation ? (
          <p className="m-0 mt-1 text-pretty text-xs leading-5 text-muted-foreground">
            {remediation}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="w-px py-3 whitespace-nowrap">
        <Badge tone={badgeTone(meta.tone)}>{meta.label}</Badge>
      </TableCell>
      <TableCell className="w-px py-3">
        <div className="flex flex-wrap gap-2 justify-end">
          {isProvider ? (
            <Button
              type="button"
              variant="bordered"
              size="sm"
              onClick={() => onOpenProviders?.(providerId)}
            >
              {isMissingProvider ? "Connect" : "Providers"}
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
      </TableCell>
    </TableRow>
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
