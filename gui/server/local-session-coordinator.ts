export type SessionActionType =
  | "chat.prompt"
  | "tool.invoke"
  | "ask_user.answer"
  | "ask_user.cancel"
  | "run.cancel";

export type SessionActionSource = "gui" | "tui" | "browser";

export interface SessionActionEnvelope {
  sessionId: string;
  actionId: string;
  actionType: SessionActionType;
  payload: Record<string, unknown>;
  source: SessionActionSource;
}

export type SessionActionResult<T = unknown> =
  | { ok: true; duplicate: boolean; result: T }
  | { ok: false; code: "session_busy"; message: string };

export interface LocalSessionCoordinator {
  runSessionAction<T>(
    action: SessionActionEnvelope,
    handler: (action: SessionActionEnvelope) => Promise<T>,
  ): Promise<SessionActionResult<T>>;
}

export interface LocalSessionCoordinatorOptions {
  dedupeRetentionMs?: number;
  now?: () => number;
}

interface AcceptedAction {
  expiresAt: number;
  result: unknown;
}

const DEFAULT_DEDUPE_RETENTION_MS = 10 * 60 * 1000;
const BUSY_MESSAGE = "OpenCandle is still working in this session. Try again when it finishes.";

export function createLocalSessionCoordinator(
  options: LocalSessionCoordinatorOptions = {},
): LocalSessionCoordinator {
  const now = options.now ?? Date.now;
  const dedupeRetentionMs = options.dedupeRetentionMs ?? DEFAULT_DEDUPE_RETENTION_MS;
  const acceptedActions = new Map<string, AcceptedAction>();
  const activeRunSessions = new Set<string>();

  async function runSessionAction<T>(
    action: SessionActionEnvelope,
    handler: (action: SessionActionEnvelope) => Promise<T>,
  ): Promise<SessionActionResult<T>> {
    pruneExpiredActions();
    const actionKey = `${action.sessionId}:${action.actionId}`;
    const accepted = acceptedActions.get(actionKey);
    if (accepted) return { ok: true, duplicate: true, result: accepted.result as T };

    if (isRunAdmissionAction(action) && activeRunSessions.has(action.sessionId)) {
      return { ok: false, code: "session_busy", message: BUSY_MESSAGE };
    }

    if (isRunAdmissionAction(action)) activeRunSessions.add(action.sessionId);
    try {
      const result = await handler(action);
      acceptedActions.set(actionKey, {
        expiresAt: now() + dedupeRetentionMs,
        result,
      });
      return { ok: true, duplicate: false, result };
    } finally {
      if (isRunAdmissionAction(action)) activeRunSessions.delete(action.sessionId);
    }
  }

  function pruneExpiredActions(): void {
    const currentTime = now();
    for (const [actionKey, accepted] of acceptedActions) {
      if (accepted.expiresAt <= currentTime) acceptedActions.delete(actionKey);
    }
  }

  return { runSessionAction };
}

function isRunAdmissionAction(action: SessionActionEnvelope): boolean {
  return action.actionType === "chat.prompt" || action.actionType === "tool.invoke";
}
