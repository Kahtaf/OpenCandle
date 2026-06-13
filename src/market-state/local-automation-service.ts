import type Database from "better-sqlite3";
import {
  type AlertRunnerProviders,
  type AlertRunnerResult,
  defaultAlertRunnerProviders,
  runAlertChecks,
} from "./alert-runner.js";
import { nextDailyReportRunAt, recordDailyWatchlistReportRun } from "./daily-report.js";
import { deliverPendingNotifications } from "./notification-delivery.js";
import {
  type AutomationRunnerLeaseResult,
  MarketStateService,
  type ReportRunRecord,
} from "./service.js";

type DailyReportRunRecorder = typeof recordDailyWatchlistReportRun;
type NotificationDeliverer = typeof deliverPendingNotifications;

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
    recordDailyReportRun?: DailyReportRunRecorder;
    deliverNotifications?: NotificationDeliverer;
    releaseLeaseOnComplete?: boolean;
  },
): Promise<LocalAutomationHeartbeatResult> {
  const service = new MarketStateService(db);
  const now = params.now ?? new Date().toISOString();
  let acquiredLease = false;
  try {
    service.markStaleAutomationRunsLost({ now, graceSeconds: 300 });
    const hadActiveLease = service.getAutomationRunnerLease(now) != null;
    const lease = service.acquireAutomationRunnerLease({
      ownerId: params.ownerId,
      ownerKind: params.ownerKind,
      now,
      ttlSeconds: params.ttlSeconds ?? 90,
    });
    acquiredLease = lease.acquired;

    if (!lease.acquired) {
      return { lease, alertCheck: null, reportRuns: [] };
    }

    const reportRuns =
      params.checkReports === false
        ? []
        : await runDueReports(service, {
            ownerId: params.ownerId,
            now,
            recordDailyReportRun: params.recordDailyReportRun ?? recordDailyWatchlistReportRun,
          });
    if (params.checkAlerts === false || !hasDueAlertRules(service, now)) {
      await (params.deliverNotifications ?? deliverPendingNotifications)(service, { now });
      return { lease, alertCheck: null, reportRuns };
    }

    const alertCheck = await runAlertChecks(service, {
      ownerId: params.ownerId,
      triggerType: hadActiveLease ? "heartbeat" : "resume",
      now,
      providers: params.providers ?? defaultAlertRunnerProviders,
    });
    await (params.deliverNotifications ?? deliverPendingNotifications)(service, { now });
    return {
      lease,
      alertCheck,
      reportRuns,
    };
  } finally {
    if (params.releaseLeaseOnComplete && acquiredLease) {
      service.releaseAutomationRunnerLease(params.ownerId);
    }
  }
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
  params: { ownerId: string; now: string; recordDailyReportRun: DailyReportRunRecorder },
): Promise<ReportRunRecord[]> {
  const nowMs = new Date(params.now).getTime();
  const dueTemplates = service
    .listReportTemplates()
    .filter(
      (template) =>
        template.enabled &&
        template.reportType === "watchlist_daily" &&
        template.nextRunAt != null &&
        new Date(template.nextRunAt).getTime() <= nowMs,
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
    try {
      const { run } = await params.recordDailyReportRun(service, {
        templateId: template.id,
        triggerType: "scheduled",
        scheduledFor,
        ownerId: params.ownerId,
      });
      runs.push(run);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failedRun = service.recordReportRun({
        templateId: template.id,
        startedAt: params.now,
        completedAt: new Date().toISOString(),
        status: "failed",
        triggerType: "scheduled",
        scheduledFor,
        ownerId: params.ownerId,
        errors: [message],
      });
      service.recordNotificationEvent({
        sourceType: "report_run",
        sourceId: failedRun.id,
        severity: "error",
        title: "Daily watchlist report failed",
        body: message,
        payload: { template_id: template.id, scheduled_for: scheduledFor },
        createdAt: failedRun.completedAt ?? params.now,
      });
      service.updateReportTemplate(template.id, { nextRunAt: scheduledFor });
      runs.push(failedRun);
    }
  }
  return runs;
}
