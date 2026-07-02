import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writerLockScopeForSession, type SessionLockScopeSource } from "./session-writer-lock.js";

interface AcceptedActionStore {
  acceptedActionIds: string[];
  pendingActionIds: string[];
}

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
  return readAcceptedActionStore(sessionManager).pendingActionIds.includes(normalizedActionId);
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
  if (store.pendingActionIds.includes(normalizedActionId)) return;
  writeAcceptedActionStore(storePath, {
    acceptedActionIds: store.acceptedActionIds,
    pendingActionIds: [...store.pendingActionIds.slice(-499), normalizedActionId],
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
    pendingActionIds: store.pendingActionIds.filter((id) => id !== normalizedActionId),
  });
}

function readAcceptedActionStore(sessionManager: SessionLockScopeSource): AcceptedActionStore {
  try {
    const storePath = acceptedActionStorePath(sessionManager);
    if (!storePath) return { acceptedActionIds: [], pendingActionIds: [] };
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as {
      acceptedActionIds?: unknown;
      pendingActionIds?: unknown;
    };
    return {
      acceptedActionIds: Array.isArray(parsed.acceptedActionIds)
        ? parsed.acceptedActionIds.filter((id): id is string => typeof id === "string")
        : [],
      pendingActionIds: Array.isArray(parsed.pendingActionIds)
        ? parsed.pendingActionIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return { acceptedActionIds: [], pendingActionIds: [] };
  }
}

function writeAcceptedActionStore(storePath: string, store: AcceptedActionStore): void {
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2), { mode: 0o600 });
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
