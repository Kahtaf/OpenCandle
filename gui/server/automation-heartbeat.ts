import { runLocalAutomationHeartbeat } from "../../src/market-state/local-automation-service.js";
import { initDefaultDatabase } from "../../src/memory/sqlite.js";

export const DEFAULT_AUTOMATION_HEARTBEAT_MS = 60_000;
export const MIN_AUTOMATION_HEARTBEAT_MS = 5_000;

export function normalizeAutomationHeartbeatMs(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return DEFAULT_AUTOMATION_HEARTBEAT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < MIN_AUTOMATION_HEARTBEAT_MS)
    return DEFAULT_AUTOMATION_HEARTBEAT_MS;
  return Math.floor(parsed);
}

export function createAutomationHeartbeatRunner(
  run: (checkAlerts: boolean) => Promise<void>,
): (checkAlerts: boolean) => Promise<boolean> {
  let inFlight = false;
  return async (checkAlerts: boolean) => {
    if (inFlight) return false;
    inFlight = true;
    try {
      await run(checkAlerts);
      return true;
    } finally {
      inFlight = false;
    }
  };
}

type IntervalHandle = ReturnType<typeof setInterval>;
type SetIntervalFn = (callback: () => void, ms: number) => IntervalHandle;
type ClearIntervalFn = (handle: IntervalHandle) => void;

export interface LocalAutomationHeartbeat {
  start(): void;
  stop(): void;
}

export interface LocalAutomationHeartbeatOptions {
  role: string;
  getSessionId: () => string;
  intervalMs: number;
  initDatabase?: typeof initDefaultDatabase;
  runHeartbeat?: typeof runLocalAutomationHeartbeat;
  setIntervalFn?: SetIntervalFn;
  clearIntervalFn?: ClearIntervalFn;
  warn?: (message: string) => void;
}

export function createLocalAutomationHeartbeat({
  role,
  getSessionId,
  intervalMs,
  initDatabase = initDefaultDatabase,
  runHeartbeat = runLocalAutomationHeartbeat,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  warn = (message) => console.warn(message),
}: LocalAutomationHeartbeatOptions): LocalAutomationHeartbeat {
  let automationHeartbeat: IntervalHandle | null = null;

  async function executeGuiAutomationHeartbeat(checkAlerts: boolean): Promise<void> {
    const db = initDatabase();
    try {
      await runHeartbeat(db, {
        ownerId: `gui:${getSessionId()}`,
        ownerKind: "writer",
        ttlSeconds: Math.max(90, Math.ceil((intervalMs * 2) / 1000)),
        checkAlerts,
      });
    } catch (error) {
      warn(
        `Local automation heartbeat failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      db.close();
    }
  }

  const runGuiAutomationHeartbeat = createAutomationHeartbeatRunner(executeGuiAutomationHeartbeat);

  function start(): void {
    if (role !== "writer") return;
    void runGuiAutomationHeartbeat(true);
    automationHeartbeat = setIntervalFn(() => void runGuiAutomationHeartbeat(true), intervalMs);
  }

  function stop(): void {
    if (automationHeartbeat) {
      clearIntervalFn(automationHeartbeat);
      automationHeartbeat = null;
    }
  }

  return { start, stop };
}
