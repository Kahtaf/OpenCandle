import { unlink } from "node:fs/promises";
import { type AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type {
  LocalSessionCoordinator,
  SessionActionEnvelope,
  SessionActionSource,
} from "./local-session-coordinator.js";
import type { ModelSetupState } from "./model-setup.js";
import { type PromptObservation, selectReplayPrompt } from "./prompt-observation.js";
import {
  waitForNewEntryId,
  waitForResolvedToolCalls,
  waitForSessionTurnSettlement,
} from "./session-entry-wait.js";
import { readWriterLock, writerLockScopeForSession } from "./writer-lock.js";

interface AskUserBridge {
  answer(id: string, answer: string): boolean;
  cancel(id: string): boolean;
}

interface SessionActionsRuntime {
  newSession(): Promise<{ cancelled: boolean }>;
  switchSession(path: string): Promise<{ cancelled: boolean }>;
}

interface SessionActionClient {
  send(message: unknown): void;
}

export interface SessionActionsController {
  handleAskUserAnswer(id: string, value: unknown, action?: SessionActionMeta): Promise<void>;
  handleAskUserCancel(id: string, action?: SessionActionMeta): Promise<void>;
  handleNewSession(): Promise<void>;
  handleOpenSession(path: string): Promise<void>;
  handleRenameSession(path: string, name: string): Promise<void>;
  handleDeleteSession(client: SessionActionClient, path: string): Promise<void>;
}

export interface SessionActionsControllerOptions {
  role: string;
  cwd: string;
  sessionDir: string;
  getSession: () => AgentSession;
  getSessionManager: () => SessionManager;
  getModelSetupState: () => ModelSetupState;
  askUserBridge: AskUserBridge;
  runtime: SessionActionsRuntime;
  sendBoot: (client: SessionActionClient) => void;
  broadcastState: () => void;
  broadcastSessions: () => void;
  localSessionCoordinator?: LocalSessionCoordinator;
  now?: () => number;
}

export interface SessionActionMeta {
  sessionId?: string;
  actionId?: string;
  source?: SessionActionSource;
  allowProxy?: boolean;
}

export function createSessionActionsController({
  role,
  cwd,
  sessionDir,
  getSessionManager,
  askUserBridge,
  runtime,
  sendBoot,
  broadcastState,
  broadcastSessions,
  localSessionCoordinator,
}: SessionActionsControllerOptions): SessionActionsController {
  function ensureWriter(): void {
    if (role !== "writer") throw new Error("Read-only follower mode");
  }

  async function handleAskUserAnswer(
    id: string,
    value: unknown,
    action?: SessionActionMeta,
  ): Promise<void> {
    const answer = String(value ?? "").trim();
    if (!answer) throw new Error("Answer cannot be empty");
    if (shouldProxyAskUserAction(action)) {
      if (await proxyAskUserAction("ask_user.answer", { id, answer }, action)) return;
      throw new Error("OpenCandle is reconnecting to this session.");
    }
    await runCoordinatedSessionAction("ask_user.answer", { id, answer }, action, async () => {
      if (!askUserBridge.answer(id, answer)) throw new Error("Unknown or resolved question");
    });
  }

  async function handleAskUserCancel(id: string, action?: SessionActionMeta): Promise<void> {
    if (shouldProxyAskUserAction(action)) {
      if (await proxyAskUserAction("ask_user.cancel", { id }, action)) return;
      throw new Error("OpenCandle is reconnecting to this session.");
    }
    await runCoordinatedSessionAction("ask_user.cancel", { id }, action, async () => {
      if (!askUserBridge.cancel(id)) throw new Error("Unknown or resolved question");
    });
  }

  async function handleNewSession(): Promise<void> {
    ensureWriter();
    const result = await runtime.newSession();
    if (result.cancelled) throw new Error("Session switch cancelled");
  }

  async function handleOpenSession(path: string): Promise<void> {
    ensureWriter();
    const sessions = await SessionManager.list(cwd, sessionDir);
    const match = sessions.find((candidate) => candidate.path === path);
    if (!match) throw new Error("Unknown saved session");
    const result = await runtime.switchSession(match.path);
    if (result.cancelled) throw new Error("Session switch cancelled");
  }

  async function handleRenameSession(path: string, name: string): Promise<void> {
    ensureWriter();
    const nextName = name.trim();
    if (!nextName) throw new Error("Session name cannot be empty");
    const sessionManager = getSessionManager();
    if (sessionManager.getSessionFile() === path) {
      sessionManager.appendSessionInfo(nextName);
      return;
    }
    await renameSessionFile(cwd, sessionDir, path, nextName);
  }

  async function handleDeleteSession(client: SessionActionClient, path: string): Promise<void> {
    ensureWriter();
    const deletingCurrent = getSessionManager().getSessionFile() === path;
    await deleteSessionFile(cwd, sessionDir, path);
    if (deletingCurrent) {
      await handleNewSession();
      sendBoot(client);
      broadcastState();
    }
    broadcastSessions();
  }

  return {
    handleAskUserAnswer,
    handleAskUserCancel,
    handleNewSession,
    handleOpenSession,
    handleRenameSession,
    handleDeleteSession,
  };

  async function runCoordinatedSessionAction(
    actionType: SessionActionEnvelope["actionType"],
    payload: Record<string, unknown>,
    action: SessionActionMeta | undefined,
    handler: () => Promise<void> | void,
  ): Promise<void> {
    if (!localSessionCoordinator || !action?.actionId) {
      await handler();
      return;
    }
    const sessionId = action.sessionId?.trim();
    if (!sessionId) throw new Error("sessionId is required");
    const result = await localSessionCoordinator.runSessionAction(
      {
        sessionId,
        actionId: action.actionId,
        actionType,
        payload,
        source: action.source ?? "gui",
      },
      async () => {
        await handler();
        return { accepted: true };
      },
    );
    if (!result.ok) throw new Error(result.message);
  }

  async function proxyAskUserAction(
    actionType: "ask_user.answer" | "ask_user.cancel",
    payload: Record<string, unknown>,
    action: SessionActionMeta | undefined,
  ): Promise<boolean> {
    if (action?.allowProxy === false) return false;
    const sessionManager = await resolveActionSessionManager(action);
    const lock = readWriterLock(writerLockScopeForSession(sessionManager));
    if (!lock?.coordinatorEndpoint || !lock.coordinatorSecret || lock.pid === process.pid) {
      return false;
    }
    if (lock.processKind === "tui") return false;
    const endpoint = new URL("/api/local-coordinator/ask-user", lock.coordinatorEndpoint);
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencandle-coordinator-secret": lock.coordinatorSecret,
        },
        body: JSON.stringify({
          sessionId: action?.sessionId,
          actionId: action?.actionId || "",
          actionType,
          payload,
        }),
      });
    } catch {
      return false;
    }
    if (response.ok) return true;
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || "OpenCandle is reconnecting to this session.");
  }

  function shouldProxyAskUserAction(action: SessionActionMeta | undefined): boolean {
    if (role !== "writer") return true;
    const targetSessionId = action?.sessionId?.trim();
    return Boolean(targetSessionId && targetSessionId !== getSessionManager().getSessionId());
  }

  async function resolveActionSessionManager(
    action: SessionActionMeta | undefined,
  ): Promise<SessionManager> {
    const current = getSessionManager();
    const targetSessionId = action?.sessionId?.trim();
    if (!targetSessionId || targetSessionId === current.getSessionId()) return current;
    const sessions = await SessionManager.list(cwd, sessionDir);
    const match = sessions.find((candidate) => candidate.id === targetSessionId);
    if (!match) throw new Error("Unknown saved session");
    return SessionManager.open(match.path, sessionDir, cwd);
  }
}

export async function promptAndSettle(
  runSession: AgentSession,
  prompt: string,
  beforeIds: Set<string>,
  observation?: PromptObservation,
  options?: { images?: Array<{ type: "image"; data: string; mimeType: string }> },
): Promise<void> {
  await runSession.prompt(prompt, options);
  await settleWithEventProgress(runSession);
  await waitForNewEntryId(
    () => runSession.sessionManager.getEntries().map((entry) => entry.id),
    beforeIds,
  );
  await waitForResolvedToolCalls(() => runSession.sessionManager.getEntries());
  await replayObservedWorkflowPromptIfNeeded(runSession, prompt, observation);
}

/**
 * Settle wait fed by a session-event counter: a single long model generation
 * keeps isStreaming/pendingMessageCount frozen for its whole duration, and
 * without an activity signal the stall detector killed healthy long turns.
 */
async function settleWithEventProgress(runSession: AgentSession): Promise<void> {
  let progressToken = 0;
  const unsubscribe = runSession.subscribe(() => {
    progressToken += 1;
  });
  try {
    await waitForSessionTurnSettlement(() => ({
      isStreaming: runSession.isStreaming,
      pendingMessageCount: runSession.pendingMessageCount,
      progressToken,
    }));
  } finally {
    unsubscribe();
  }
}

export async function replayObservedWorkflowPromptIfNeeded(
  runSession: AgentSession,
  originalPrompt: string,
  observation?: PromptObservation,
): Promise<void> {
  if (!observation) return;
  const replayPrompt = selectReplayPrompt(observation, originalPrompt);
  if (!replayPrompt) return;

  // V1 attachment replay is text-only: the recorded expanded prompt is
  // re-sent, but image bytes are not replayed.
  await runSession.prompt(replayPrompt, {
    expandPromptTemplates: false,
    source: "extension",
  });
  await settleWithEventProgress(runSession);
  await waitForResolvedToolCalls(() => runSession.sessionManager.getEntries());
}

export async function renameSessionFile(
  cwd: string,
  sessionDir: string,
  sessionPath: string,
  nextName: string,
): Promise<void> {
  const target = await resolveListedSession(cwd, sessionDir, sessionPath);
  const name = nextName.trim();
  if (!name) throw new Error("Session name cannot be empty");
  const manager = SessionManager.open(target.path);
  manager.appendSessionInfo(name);
}

export async function deleteSessionFile(
  cwd: string,
  sessionDir: string,
  sessionPath: string,
): Promise<void> {
  const target = await resolveListedSession(cwd, sessionDir, sessionPath);
  await unlink(target.path);
}

async function resolveListedSession(cwd: string, sessionDir: string, sessionPath: string) {
  const sessions = await SessionManager.list(cwd, sessionDir);
  const target = sessions.find((session) => session.path === sessionPath);
  if (!target) throw new Error("Unknown saved session");
  return target;
}
