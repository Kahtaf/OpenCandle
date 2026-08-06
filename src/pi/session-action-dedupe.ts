import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { type SessionLockScopeSource, writerLockScopeForSession } from "./session-writer-lock.js";

interface AcceptedActionStore {
  acceptedActionIds: string[];
  pendingActions: PendingActionRecord[];
  actionFingerprints: Record<string, string>;
}

interface PendingActionRecord {
  id: string;
  pendingAtMs: number;
  durable?: boolean;
}

const pendingSessionActionTtlMs = 2 * 60 * 1000;

export function hasAcceptedSessionAction(
  sessionManager: SessionLockScopeSource,
  actionId: string,
  fingerprint?: string,
): boolean {
  const normalizedActionId = actionId.trim();
  if (!normalizedActionId) return false;
  const store = readAcceptedActionStore(sessionManager);
  requireMatchingFingerprint(store, normalizedActionId, fingerprint);
  return store.acceptedActionIds.includes(normalizedActionId);
}

export function hasPendingSessionAction(
  sessionManager: SessionLockScopeSource,
  actionId: string,
  fingerprint?: string,
): boolean {
  const normalizedActionId = actionId.trim();
  if (!normalizedActionId) return false;
  const store = readAcceptedActionStore(sessionManager);
  requireMatchingFingerprint(store, normalizedActionId, fingerprint);
  return store.pendingActions.some((record) => record.id === normalizedActionId);
}

export function recordPendingSessionAction(
  sessionManager: SessionLockScopeSource,
  actionId: string,
  fingerprint?: string,
  options: { durable?: boolean } = {},
): void {
  const normalizedActionId = actionId.trim();
  if (
    !normalizedActionId ||
    hasAcceptedSessionAction(sessionManager, normalizedActionId, fingerprint)
  )
    return;
  const storePath = acceptedActionStorePath(sessionManager);
  if (!storePath) return;
  const store = readAcceptedActionStore(sessionManager);
  requireMatchingFingerprint(store, normalizedActionId, fingerprint);
  if (store.pendingActions.some((record) => record.id === normalizedActionId)) return;
  const pendingActions = [
    ...store.pendingActions.slice(-499),
    {
      id: normalizedActionId,
      pendingAtMs: Date.now(),
      ...(options.durable ? { durable: true } : {}),
    },
  ];
  writeAcceptedActionStore(storePath, {
    acceptedActionIds: store.acceptedActionIds,
    pendingActions,
    actionFingerprints: retainActionFingerprints(
      store.actionFingerprints,
      store.acceptedActionIds,
      pendingActions,
      normalizedActionId,
      fingerprint,
    ),
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
    actionFingerprints: Object.fromEntries(
      Object.entries(store.actionFingerprints).filter(
        ([id]) => id !== normalizedActionId || store.acceptedActionIds.includes(id),
      ),
    ),
  });
}

export function recordAcceptedSessionAction(
  sessionManager: SessionLockScopeSource,
  actionId: string,
  fingerprint?: string,
): void {
  const normalizedActionId = actionId.trim();
  if (!normalizedActionId) return;
  const storePath = acceptedActionStorePath(sessionManager);
  if (!storePath) return;
  const store = readAcceptedActionStore(sessionManager);
  requireMatchingFingerprint(store, normalizedActionId, fingerprint);
  if (store.acceptedActionIds.includes(normalizedActionId) && !fingerprint) return;
  const acceptedActionIds = store.acceptedActionIds.includes(normalizedActionId)
    ? store.acceptedActionIds
    : [...store.acceptedActionIds.slice(-499), normalizedActionId];
  const pendingActions = store.pendingActions.filter((record) => record.id !== normalizedActionId);
  writeAcceptedActionStore(storePath, {
    acceptedActionIds,
    pendingActions,
    actionFingerprints: retainActionFingerprints(
      store.actionFingerprints,
      acceptedActionIds,
      pendingActions,
      normalizedActionId,
      fingerprint,
    ),
  });
}

export interface SessionActionStoreSnapshot {
  filename: string;
  content: string;
}

export function readSessionActionStoreSnapshot(
  sessionManager: SessionLockScopeSource,
): SessionActionStoreSnapshot | undefined {
  const storePath = acceptedActionStorePath(sessionManager);
  if (!storePath) return undefined;
  try {
    const content = readFileSync(storePath, "utf8");
    parseAcceptedActionStore(content);
    return { filename: basename(storePath), content };
  } catch (error) {
    if (isMissingFileError(error)) return undefined;
    throw error;
  }
}

export function restoreSessionActionStoreSnapshot(
  sessionManager: SessionLockScopeSource,
  content: string,
): void {
  const storePath = acceptedActionStorePath(sessionManager);
  if (!storePath) return;
  writeAcceptedActionStore(storePath, parseAcceptedActionStore(content));
}

export function deleteSessionActionStore(sessionManager: SessionLockScopeSource): void {
  const storePath = acceptedActionStorePath(sessionManager);
  if (!storePath) return;
  try {
    unlinkSync(storePath);
  } catch {
    // Missing or already-removed sidecars do not block session deletion.
  }
}

function readAcceptedActionStore(sessionManager: SessionLockScopeSource): AcceptedActionStore {
  const storePath = acceptedActionStorePath(sessionManager);
  if (!storePath) return emptyAcceptedActionStore();
  try {
    return parseAcceptedActionStore(readFileSync(storePath, "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) return emptyAcceptedActionStore();
    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function writeAcceptedActionStore(storePath: string, store: AcceptedActionStore): void {
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(
    storePath,
    JSON.stringify(
      {
        acceptedActionIds: store.acceptedActionIds,
        pendingActionIds: store.pendingActions,
        actionFingerprints: store.actionFingerprints,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
}

function parseAcceptedActionStore(content: string): AcceptedActionStore {
  if (Buffer.byteLength(content) > 1_024 * 1_024) {
    throw new Error("Session action snapshot is too large");
  }
  const parsed = JSON.parse(content) as {
    acceptedActionIds?: unknown;
    pendingActionIds?: unknown;
    actionFingerprints?: unknown;
  };
  const pendingActions = readPendingActionRecords(parsed.pendingActionIds).activeRecords.slice(
    -500,
  );
  const acceptedActionIds = Array.isArray(parsed.acceptedActionIds)
    ? parsed.acceptedActionIds.filter((id): id is string => typeof id === "string").slice(-500)
    : [];
  const actionFingerprints =
    parsed.actionFingerprints &&
    typeof parsed.actionFingerprints === "object" &&
    !Array.isArray(parsed.actionFingerprints)
      ? Object.fromEntries(
          Object.entries(parsed.actionFingerprints).filter(
            (entry): entry is [string, string] =>
              typeof entry[0] === "string" && typeof entry[1] === "string",
          ),
        )
      : {};
  return {
    acceptedActionIds,
    pendingActions,
    actionFingerprints: retainActionFingerprints(
      actionFingerprints,
      acceptedActionIds,
      pendingActions,
    ),
  };
}

function emptyAcceptedActionStore(): AcceptedActionStore {
  return { acceptedActionIds: [], pendingActions: [], actionFingerprints: {} };
}

function retainActionFingerprints(
  fingerprints: Record<string, string>,
  acceptedActionIds: string[],
  pendingActions: PendingActionRecord[],
  actionId?: string,
  fingerprint?: string,
): Record<string, string> {
  const retainedIds = new Set([...acceptedActionIds, ...pendingActions.map((record) => record.id)]);
  const retained = Object.fromEntries(
    Object.entries(fingerprints).filter(([id]) => retainedIds.has(id)),
  );
  const normalized = fingerprint?.trim();
  return normalized && actionId ? { ...retained, [actionId]: normalized } : retained;
}

function requireMatchingFingerprint(
  store: AcceptedActionStore,
  actionId: string,
  fingerprint?: string,
): void {
  const normalized = fingerprint?.trim();
  const existing = Object.hasOwn(store.actionFingerprints, actionId)
    ? store.actionFingerprints[actionId]
    : undefined;
  if (normalized && existing && normalized !== existing) {
    throw new Error("Action id was already used with different input");
  }
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
      const pending = entry as { id?: unknown; pendingAtMs?: unknown; durable?: unknown };
      if (typeof pending.id !== "string" || typeof pending.pendingAtMs !== "number") return null;
      return {
        id: pending.id,
        pendingAtMs: pending.pendingAtMs,
        ...(pending.durable === true ? { durable: true } : {}),
      };
    })();
    if (!record) continue;
    if (record.durable || now - record.pendingAtMs <= pendingSessionActionTtlMs) {
      activeRecords.push(record);
    }
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
