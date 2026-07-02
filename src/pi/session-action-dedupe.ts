import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type SessionLockScopeSource, writerLockScopeForSession } from "./session-writer-lock.js";

interface AcceptedActionStore {
  acceptedActionIds: string[];
  pendingActions: PendingActionRecord[];
}

interface PendingActionRecord {
  id: string;
  pendingAtMs: number;
}

const pendingSessionActionTtlMs = 2 * 60 * 1000;

export function hasAcceptedSessionAction(
  sessionManager: SessionLockScopeSource,
  actionId: string,
): boolean {
  const normalizedActionId = actionId.trim();
  if (!normalizedActionId) return false;
  return readAcceptedActionStore(sessionManager).acceptedActionIds.includes(normalizedActionId);
}

export function hasPendingSessionAction(
  sessionManager: SessionLockScopeSource,
  actionId: string,
): boolean {
  const normalizedActionId = actionId.trim();
  if (!normalizedActionId) return false;
  return readAcceptedActionStore(sessionManager).pendingActions.some(
    (record) => record.id === normalizedActionId,
  );
}

export function recordPendingSessionAction(
  sessionManager: SessionLockScopeSource,
  actionId: string,
): void {
  const normalizedActionId = actionId.trim();
  if (!normalizedActionId || hasAcceptedSessionAction(sessionManager, normalizedActionId)) return;
  const storePath = acceptedActionStorePath(sessionManager);
  if (!storePath) return;
  const store = readAcceptedActionStore(sessionManager);
  if (store.pendingActions.some((record) => record.id === normalizedActionId)) return;
  writeAcceptedActionStore(storePath, {
    acceptedActionIds: store.acceptedActionIds,
    pendingActions: [
      ...store.pendingActions.slice(-499),
      { id: normalizedActionId, pendingAtMs: Date.now() },
    ],
  });
}

export function clearPendingSessionAction(
  sessionManager: SessionLockScopeSource,
  actionId: string,
): void {
  const normalizedActionId = actionId.trim();
  if (!normalizedActionId) return;
  const storePath = acceptedActionStorePath(sessionManager);
  if (!storePath) return;
  const store = readAcceptedActionStore(sessionManager);
  if (!store.pendingActions.some((record) => record.id === normalizedActionId)) return;
  writeAcceptedActionStore(storePath, {
    acceptedActionIds: store.acceptedActionIds,
    pendingActions: store.pendingActions.filter((record) => record.id !== normalizedActionId),
  });
}

export function recordAcceptedSessionAction(
  sessionManager: SessionLockScopeSource,
  actionId: string,
): void {
  const normalizedActionId = actionId.trim();
  if (!normalizedActionId) return;
  const storePath = acceptedActionStorePath(sessionManager);
  if (!storePath) return;
  const store = readAcceptedActionStore(sessionManager);
  if (store.acceptedActionIds.includes(normalizedActionId)) return;
  writeAcceptedActionStore(storePath, {
    acceptedActionIds: [...store.acceptedActionIds.slice(-499), normalizedActionId],
    pendingActions: store.pendingActions.filter((record) => record.id !== normalizedActionId),
  });
}

function readAcceptedActionStore(sessionManager: SessionLockScopeSource): AcceptedActionStore {
  try {
    const storePath = acceptedActionStorePath(sessionManager);
    if (!storePath) return { acceptedActionIds: [], pendingActions: [] };
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as {
      acceptedActionIds?: unknown;
      pendingActionIds?: unknown;
    };
    const pendingRecords = readPendingActionRecords(parsed.pendingActionIds);
    const acceptedActionIds = Array.isArray(parsed.acceptedActionIds)
      ? parsed.acceptedActionIds.filter((id): id is string => typeof id === "string")
      : [];
    return {
      acceptedActionIds,
      pendingActions: pendingRecords.activeRecords,
    };
  } catch {
    return { acceptedActionIds: [], pendingActions: [] };
  }
}

function writeAcceptedActionStore(storePath: string, store: AcceptedActionStore): void {
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(
    storePath,
    JSON.stringify(
      {
        acceptedActionIds: store.acceptedActionIds,
        pendingActionIds: store.pendingActions,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

function readPendingActionRecords(value: unknown): {
  activeRecords: PendingActionRecord[];
} {
  if (!Array.isArray(value)) return { activeRecords: [] };
  const now = Date.now();
  const activeRecords: PendingActionRecord[] = [];
  for (const entry of value) {
    const record = (() => {
      if (typeof entry === "string") return null;
      if (!entry || typeof entry !== "object") return null;
      const pending = entry as { id?: unknown; pendingAtMs?: unknown };
      if (typeof pending.id !== "string" || typeof pending.pendingAtMs !== "number") return null;
      return { id: pending.id, pendingAtMs: pending.pendingAtMs };
    })();
    if (!record) continue;
    if (now - record.pendingAtMs <= pendingSessionActionTtlMs) activeRecords.push(record);
  }
  return { activeRecords };
}

function acceptedActionStorePath(sessionManager: SessionLockScopeSource): string {
  let scope: string;
  try {
    scope = writerLockScopeForSession(sessionManager);
  } catch {
    return "";
  }
  return scope.endsWith(".jsonl")
    ? `${scope}.accepted-actions.json`
    : join(scope, "accepted-actions.json");
}
