export const DEFAULT_AUTOMATION_HEARTBEAT_MS = 60_000;
export const MIN_AUTOMATION_HEARTBEAT_MS = 5_000;

export function normalizeAutomationHeartbeatMs(raw: string | undefined): number {
  if (raw == null || raw.trim() === "") return DEFAULT_AUTOMATION_HEARTBEAT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < MIN_AUTOMATION_HEARTBEAT_MS) return DEFAULT_AUTOMATION_HEARTBEAT_MS;
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
