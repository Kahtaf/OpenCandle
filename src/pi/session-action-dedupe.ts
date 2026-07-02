import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writerLockScopeForSession, type SessionLockScopeSource } from "./session-writer-lock.js";

interface AcceptedActionStore {
  acceptedActionIds: string[];
}

export function hasAcceptedSessionAction(
  sessionManager: SessionLockScopeSource,
  actionId: string,
): boolean {
  const normalizedActionId = actionId.trim();
  if (!normalizedActionId) return false;
  return readAcceptedActionStore(sessionManager).acceptedActionIds.includes(normalizedActionId);
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
  const nextStore = {
    acceptedActionIds: [...store.acceptedActionIds.slice(-499), normalizedActionId],
  };
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(storePath, JSON.stringify(nextStore, null, 2), { mode: 0o600 });
}

function readAcceptedActionStore(sessionManager: SessionLockScopeSource): AcceptedActionStore {
  try {
    const storePath = acceptedActionStorePath(sessionManager);
    if (!storePath) return { acceptedActionIds: [] };
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as {
      acceptedActionIds?: unknown;
    };
    return {
      acceptedActionIds: Array.isArray(parsed.acceptedActionIds)
        ? parsed.acceptedActionIds.filter((id): id is string => typeof id === "string")
        : [],
    };
  } catch {
    return { acceptedActionIds: [] };
  }
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
