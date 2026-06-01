import type Database from "better-sqlite3";
import {
  defaultAlertRunnerProviders,
  runAlertChecks,
  type AlertRunnerProviders,
  type AlertRunnerResult,
} from "./alert-runner.js";
import { MarketStateService, type AutomationRunnerLeaseResult } from "./service.js";

export interface LocalAutomationHeartbeatResult {
  lease: AutomationRunnerLeaseResult;
  alertCheck: AlertRunnerResult | null;
}

export async function runLocalAutomationHeartbeat(
  db: Database.Database,
  params: {
    ownerId: string;
    ownerKind: "writer" | "monitor";
        now?: string;
        ttlSeconds?: number;
        checkAlerts?: boolean;
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

  if (!lease.acquired || params.checkAlerts === false || !hasDueAlertRules(service, now)) {
    return { lease, alertCheck: null };
  }

  return {
    lease,
    alertCheck: await runAlertChecks(service, {
      ownerId: params.ownerId,
      triggerType: "heartbeat",
      now,
      providers: params.providers ?? defaultAlertRunnerProviders,
    }),
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
