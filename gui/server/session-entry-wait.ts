export interface WaitForEntryCountOptions {
  timeoutMs?: number;
  intervalMs?: number;
}

export interface WaitForSessionTurnSettlementOptions extends WaitForEntryCountOptions {
  idleGraceMs?: number;
}

export interface SessionRunStatus {
  isStreaming: boolean;
  pendingMessageCount: number;
}

export async function waitForEntryCount(
  getCount: () => number,
  previousCount: number,
  options: WaitForEntryCountOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;

  while (getCount() <= previousCount && Date.now() < deadline) {
    await delay(intervalMs);
  }
  if (getCount() <= previousCount) {
    throw new Error("Timed out waiting for a new session entry");
  }
}

export async function waitForNewEntryId(
  getIds: () => string[],
  previousIds: Set<string>,
  options: WaitForEntryCountOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 2_000;
  const intervalMs = options.intervalMs ?? 25;
  const deadline = Date.now() + timeoutMs;

  while (!getIds().some((id) => !previousIds.has(id)) && Date.now() < deadline) {
    await delay(intervalMs);
  }
  if (!getIds().some((id) => !previousIds.has(id))) {
    throw new Error("Timed out waiting for a new session entry");
  }
}

export async function waitForSessionTurnSettlement(
  getStatus: () => SessionRunStatus,
  options: WaitForSessionTurnSettlementOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 25;
  const idleGraceMs = options.idleGraceMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let idleSince: number | undefined;

  while (Date.now() < deadline) {
    const status = getStatus();
    const active = status.isStreaming || status.pendingMessageCount > 0;

    if (active) {
      idleSince = undefined;
      await delay(intervalMs);
      continue;
    }

    idleSince ??= Date.now();
    if (Date.now() - idleSince >= idleGraceMs) {
      return;
    }

    await delay(intervalMs);
  }
  throw new Error("Timed out waiting for the session turn to settle");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
