#!/usr/bin/env node
import { parseArgs } from "node:util";
import { loadEnv } from "./config.js";
import { assertSupportedNodeVersion } from "./infra/node-version.js";
import { runLocalAutomationHeartbeat } from "./market-state/local-automation-service.js";
import { MarketStateService } from "./market-state/service.js";
import { initDefaultDatabase } from "./memory/sqlite.js";

assertSupportedNodeVersion();

const DEFAULT_MONITOR_INTERVAL_MS = 60_000;
const MIN_MONITOR_INTERVAL_MS = 5_000;
const MONITOR_OWNER_ID = `monitor:${process.pid}`;

interface MonitorOptions {
  once: boolean;
  intervalMs: number;
}

function parseMonitorOptions(argv = process.argv.slice(2)): MonitorOptions {
  const parsed = parseArgs({
    args: argv,
    options: {
      once: { type: "boolean", default: false },
      "interval-ms": { type: "string" },
    },
    strict: false,
  });
  return {
    once: parsed.values.once === true,
    intervalMs: normalizeMonitorIntervalMs(parsed.values["interval-ms"]),
  };
}

function normalizeMonitorIntervalMs(raw: string | boolean | undefined): number {
  if (typeof raw !== "string" || raw.trim() === "") return DEFAULT_MONITOR_INTERVAL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < MIN_MONITOR_INTERVAL_MS)
    return DEFAULT_MONITOR_INTERVAL_MS;
  return Math.floor(parsed);
}

async function runMonitorHeartbeat(
  intervalMs: number,
  releaseLeaseOnComplete = false,
): Promise<void> {
  const db = initDefaultDatabase();
  const now = new Date().toISOString();
  try {
    const result = await runLocalAutomationHeartbeat(db, {
      ownerId: MONITOR_OWNER_ID,
      ownerKind: "monitor",
      now,
      ttlSeconds: Math.max(90, Math.ceil((intervalMs * 2) / 1000)),
      checkAlerts: true,
      checkReports: true,
      releaseLeaseOnComplete,
    });
    if (!result.lease.acquired) {
      console.log(
        `OpenCandle monitor standby: runner owned by ${result.lease.ownerId} until ${result.lease.expiresAt}`,
      );
      return;
    }
    const alertSummary = result.alertCheck
      ? `${result.alertCheck.checked} alert(s), ${result.alertCheck.triggered} triggered, ${result.alertCheck.unavailable} unavailable`
      : "no due alerts";
    const reportSummary = result.reportRuns.length
      ? `${result.reportRuns.length} report run(s)`
      : "no due reports";
    console.log(`OpenCandle monitor heartbeat ${now}: ${alertSummary}; ${reportSummary}.`);
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  loadEnv();
  const options = parseMonitorOptions();
  let inFlight = false;
  const runOnce = async (): Promise<void> => {
    if (inFlight) {
      console.log("OpenCandle monitor heartbeat skipped: previous run is still active.");
      return;
    }
    inFlight = true;
    try {
      await runMonitorHeartbeat(options.intervalMs, options.once);
    } finally {
      inFlight = false;
    }
  };

  await runOnce();
  if (options.once) return;

  console.log(
    `OpenCandle monitor running locally every ${options.intervalMs}ms. Keep this process open for local alerts and reports.`,
  );
  const timer = setInterval(() => {
    void runOnce().catch((error) => {
      console.error(
        `OpenCandle monitor heartbeat failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }, options.intervalMs);

  const stop = () => {
    clearInterval(timer);
    const db = initDefaultDatabase();
    try {
      new MarketStateService(db).releaseAutomationRunnerLease(MONITOR_OWNER_ID);
    } finally {
      db.close();
    }
    console.log("OpenCandle monitor stopped.");
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

await main();
