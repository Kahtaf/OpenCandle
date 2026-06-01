import type Database from "better-sqlite3";
import {
  defaultAlertRunnerProviders,
  runAlertChecks,
  type AlertRunnerProviders,
  type AlertRunnerResult,
} from "./alert-runner.js";
import { nextDailyReportRunAt, recordDailyWatchlistReportRun } from "./daily-report.js";
import { MarketStateService, type AutomationRunnerLeaseResult, type ReportRunRecord } from "./service.js";

export interface LocalAutomationHeartbeatResult {
  lease: AutomationRunnerLeaseResult;
  alertCheck: AlertRunnerResult | null;
  reportRuns: ReportRunRecord[];
}

export async function runLocalAutomationHeartbeat(
  db: Database.Database,
  params: {
    ownerId: string;
    ownerKind: "writer" | "monitor";
        now?: string;
        ttlSeconds?: number;
        checkAlerts?: boolean;
        checkReports?: boolean;
        providers?: AlertRunnerProviders;
      },
): Promise<LocalAutomationHeartbeatResult> {
  const service = new MarketStateService(db);
  const now = params.now ?? new Date().toISOString();
  const lease = service.acquireAutomationRunnerLease({
    ownerId: params.ownerId,
    ownerKind: params.ownerKind,
    now,
    ttlSeconds: params.ttlSeconds ?? 90,
  });

  if (!lease.acquired) {
    return { lease, alertCheck: null, reportRuns: [] };
  }

  const reportRuns = params.checkReports === false
    ? []
    : await runDueReports(service, {
        ownerId: params.ownerId,
        now,
      });
  if (params.checkAlerts === false || !hasDueAlertRules(service, now)) {
    return { lease, alertCheck: null, reportRuns };
  }

  return {
    lease,
    alertCheck: await runAlertChecks(service, {
      ownerId: params.ownerId,
      triggerType: "heartbeat",
      now,
      providers: params.providers ?? defaultAlertRunnerProviders,
    }),
    reportRuns,
  };
}

function hasDueAlertRules(service: MarketStateService, now: string): boolean {
  const nowMs = new Date(now).getTime();
  return service.listAlertRules().some((rule) => {
    if (!rule.enabled || rule.status !== "active") return false;
    if (rule.nextCheckAt == null) return true;
    return new Date(rule.nextCheckAt).getTime() <= nowMs;
  });
}

async function runDueReports(
  service: MarketStateService,
  params: { ownerId: string; now: string },
): Promise<ReportRunRecord[]> {
  const nowMs = new Date(params.now).getTime();
  const dueTemplates = service.listReportTemplates().filter((template) =>
    template.enabled &&
    template.reportType === "watchlist_daily" &&
    template.nextRunAt != null &&
    new Date(template.nextRunAt).getTime() <= nowMs
  );
  const runs: ReportRunRecord[] = [];
  for (const template of dueTemplates) {
    const scheduledFor = template.nextRunAt;
    if (scheduledFor == null) continue;
    const nextRunAt = nextDailyReportRunAt(
      template.timezone,
      template.localTime,
      new Date(params.now),
    );
    const claimed = service.claimDueReportTemplateRun(template.id, {
      scheduledFor,
      nextRunAt,
      claimedAt: params.now,
    });
    if (claimed == null) continue;
    const { run } = await recordDailyWatchlistReportRun(service, {
      templateId: template.id,
      triggerType: "scheduled",
      scheduledFor,
      ownerId: params.ownerId,
    });
    runs.push(run);
  }
  return runs;
}
