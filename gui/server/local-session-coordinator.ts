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
  const activeActions = new Map<string, Promise<unknown>>();
  const sessionRunTails = new Map<string, Promise<void>>();

  async function runSessionAction<T>(
    action: SessionActionEnvelope,
    handler: (action: SessionActionEnvelope) => Promise<T>,
  ): Promise<SessionActionResult<T>> {
    pruneExpiredActions();
    const actionKey = `${action.sessionId}:${action.actionId}`;
    const accepted = acceptedActions.get(actionKey);
    if (accepted) return { ok: true, duplicate: true, result: accepted.result as T };
    const active = activeActions.get(actionKey);
    if (active) return { ok: true, duplicate: true, result: (await active) as T };

    const runAdmissionAction = isRunAdmissionAction(action);
    const queueChatPrompt = action.actionType === "chat.prompt";
    const previousRun = queueChatPrompt ? sessionRunTails.get(action.sessionId) : undefined;
    if (runAdmissionAction && !queueChatPrompt && sessionRunTails.has(action.sessionId)) {
      return { ok: false, code: "session_busy", message: BUSY_MESSAGE };
    }

    const runAction = (async () => {
      if (previousRun) await previousRun;
      const result = await handler(action);
      acceptedActions.set(actionKey, {
        expiresAt: now() + dedupeRetentionMs,
        result,
      });
      return result;
    })();
    if (runAdmissionAction) {
      const runTail = runAction.then(
        () => undefined,
        () => undefined,
      );
      sessionRunTails.set(action.sessionId, runTail);
      void runTail.finally(() => {
        if (sessionRunTails.get(action.sessionId) === runTail) {
          sessionRunTails.delete(action.sessionId);
        }
      });
    }
    activeActions.set(actionKey, runAction);
    try {
      const result = await runAction;
      return { ok: true, duplicate: false, result };
    } finally {
      activeActions.delete(actionKey);
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
