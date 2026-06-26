import { unlink } from "node:fs/promises";
import { type AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { ModelSetupState } from "./model-setup.js";
import { type PromptObservation, selectReplayPrompt } from "./prompt-observation.js";
import {
  waitForNewEntryId,
  waitForResolvedToolCalls,
  waitForSessionTurnSettlement,
} from "./session-entry-wait.js";

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
  handlePrompt(prompt: string): Promise<void>;
  handleAskUserAnswer(id: string, value: unknown): Promise<void>;
  handleAskUserCancel(id: string): Promise<void>;
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
  now?: () => number;
}

export function createSessionActionsController({
  role,
  cwd,
  sessionDir,
  getSession,
  getSessionManager,
  getModelSetupState,
  askUserBridge,
  runtime,
  sendBoot,
  broadcastState,
  broadcastSessions,
  now = Date.now,
}: SessionActionsControllerOptions): SessionActionsController {
  function ensureWriter(): void {
    if (role !== "writer") throw new Error("Read-only follower mode");
  }

  async function handlePrompt(prompt: string): Promise<void> {
    ensureWriter();

    const modelSetup = getModelSetupState();
    const sessionManager = getSessionManager();
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt.startsWith("/") && modelSetup.requirement !== "ready") {
      sessionManager.appendMessage({ role: "user", content: prompt, timestamp: now() });
      broadcastState();
      const message =
        modelSetup.requirement === "select_model"
          ? "Choose an available model before chat can run. OpenCandle found configured credentials but no active model."
          : "Connect an AI model before chat can run. Paste a Google Gemini, OpenAI, or Anthropic API key in the setup panel.";
      sessionManager.appendCustomMessageEntry("opencandle-model-setup", message, true, {
        source: "gui",
        requirement: modelSetup.requirement,
      });
      broadcastState();
      return;
    }

    const beforeIds = new Set(sessionManager.getEntries().map((entry) => entry.id));
    await promptAndSettle(getSession(), prompt, beforeIds);
    broadcastState();
  }

  async function handleAskUserAnswer(id: string, value: unknown): Promise<void> {
    ensureWriter();
    const answer = String(value ?? "").trim();
    if (!answer) throw new Error("Answer cannot be empty");
    if (!askUserBridge.answer(id, answer)) throw new Error("Unknown or resolved question");
  }

  async function handleAskUserCancel(id: string): Promise<void> {
    ensureWriter();
    if (!askUserBridge.cancel(id)) throw new Error("Unknown or resolved question");
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
    handlePrompt,
    handleAskUserAnswer,
    handleAskUserCancel,
    handleNewSession,
    handleOpenSession,
    handleRenameSession,
    handleDeleteSession,
  };
}

export async function promptAndSettle(
  runSession: AgentSession,
  prompt: string,
  beforeIds: Set<string>,
  observation?: PromptObservation,
): Promise<void> {
  await runSession.prompt(prompt);
  await waitForSessionTurnSettlement(() => ({
    isStreaming: runSession.isStreaming,
    pendingMessageCount: runSession.pendingMessageCount,
  }));
  await waitForNewEntryId(
    () => runSession.sessionManager.getEntries().map((entry) => entry.id),
    beforeIds,
  );
  await waitForResolvedToolCalls(() => runSession.sessionManager.getEntries());
  await replayObservedWorkflowPromptIfNeeded(runSession, prompt, observation);
}

export async function replayObservedWorkflowPromptIfNeeded(
  runSession: AgentSession,
  originalPrompt: string,
  observation?: PromptObservation,
): Promise<void> {
  if (!observation) return;
  const replayPrompt = selectReplayPrompt(observation, originalPrompt);
  if (!replayPrompt) return;

  await runSession.prompt(replayPrompt, {
    expandPromptTemplates: false,
    source: "extension",
  });
  await waitForSessionTurnSettlement(() => ({
    isStreaming: runSession.isStreaming,
    pendingMessageCount: runSession.pendingMessageCount,
  }));
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
