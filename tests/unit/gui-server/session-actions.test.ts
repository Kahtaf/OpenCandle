import { existsSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createLocalSessionCoordinator } from "../../../gui/server/local-session-coordinator.js";
import {
  createSessionActionsController,
  deleteSessionFile,
  renameSessionFile,
} from "../../../gui/server/session-actions.js";

describe("GUI session actions", () => {
  it("renames a Pi session by appending session_info so the TUI session list sees it", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-session-actions-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-session-actions-sessions-"));
    try {
      const manager = SessionManager.create(cwd, sessionDir);
      manager.appendMessage({ role: "user", content: "Original title source" });
      manager.appendMessage(assistantMessage("Original response"));
      const sessionFile = manager.getSessionFile();
      if (!sessionFile) throw new Error("Expected session file");

      await renameSessionFile(cwd, sessionDir, sessionFile, "Macro watchlist");

      const listed = await SessionManager.list(cwd, sessionDir);
      expect(listed.find((session) => session.path === sessionFile)?.name).toBe("Macro watchlist");
      expect(SessionManager.open(sessionFile).getSessionName()).toBe("Macro watchlist");
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("deletes a Pi session file so it is no longer resumable", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-session-actions-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-session-actions-sessions-"));
    try {
      const manager = SessionManager.create(cwd, sessionDir);
      manager.appendMessage({ role: "user", content: "Delete me" });
      manager.appendMessage(assistantMessage("Deleted response"));
      const sessionFile = manager.getSessionFile();
      if (!sessionFile) throw new Error("Expected session file");

      await deleteSessionFile(cwd, sessionDir, sessionFile);

      expect(existsSync(sessionFile)).toBe(false);
      const listed = await SessionManager.list(cwd, sessionDir);
      expect(listed.some((session) => session.path === sessionFile)).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("records a setup message instead of prompting when no model is configured", async () => {
    const appendedMessages: unknown[] = [];
    const customMessages: unknown[] = [];
    const broadcastState = vi.fn();
    const session = { prompt: vi.fn() } as unknown as AgentSession;
    const sessionManager = {
      appendMessage: (message: unknown) => appendedMessages.push(message),
      appendCustomMessageEntry: (...args: unknown[]) => customMessages.push(args),
      getEntries: () => [],
    } as unknown as SessionManager;
    const controller = createSessionActionsController({
      role: "writer",
      cwd: "/tmp",
      sessionDir: "/tmp/sessions",
      getSession: () => session,
      getSessionManager: () => sessionManager,
      getModelSetupState: () => ({
        requirement: "connect_auth",
        providers: [],
        availableModels: [],
      }),
      askUserBridge: { answer: () => true, cancel: () => true },
      runtime: {
        newSession: async () => ({ cancelled: false }),
        switchSession: async () => ({ cancelled: false }),
      },
      sendBoot: vi.fn(),
      broadcastState,
      broadcastSessions: vi.fn(),
      now: () => 123,
    });

    await controller.handlePrompt("Tell me about AAPL");

    expect(session.prompt).not.toHaveBeenCalled();
    expect(appendedMessages).toEqual([
      { role: "user", content: "Tell me about AAPL", timestamp: 123 },
    ]);
    expect(customMessages[0]).toEqual([
      "opencandle-model-setup",
      "Connect an AI model before chat can run. Paste a Google Gemini, OpenAI, or Anthropic API key in the setup panel.",
      true,
      { source: "gui", requirement: "connect_auth" },
    ]);
    expect(broadcastState).toHaveBeenCalledTimes(2);
  });

  it("renames the live current session through the current session manager", async () => {
    const appendSessionInfo = vi.fn();
    const sessionManager = {
      getSessionFile: () => "/tmp/current-session.jsonl",
      appendSessionInfo,
    } as unknown as SessionManager;
    const controller = createSessionActionsController({
      role: "writer",
      cwd: "/tmp",
      sessionDir: "/tmp/sessions",
      getSession: () => ({}) as AgentSession,
      getSessionManager: () => sessionManager,
      getModelSetupState: () => ({
        requirement: "ready",
        providers: [],
        availableModels: [],
      }),
      askUserBridge: { answer: () => true, cancel: () => true },
      runtime: {
        newSession: async () => ({ cancelled: false }),
        switchSession: async () => ({ cancelled: false }),
      },
      sendBoot: vi.fn(),
      broadcastState: vi.fn(),
      broadcastSessions: vi.fn(),
    });

    await controller.handleRenameSession("/tmp/current-session.jsonl", " Macro watchlist ");

    expect(appendSessionInfo).toHaveBeenCalledWith("Macro watchlist");
  });

  it("dedupes retried ask_user answers by action id", async () => {
    const answer = vi.fn(() => true);
    const sessionManager = {
      getSessionId: () => "session-1",
    } as unknown as SessionManager;
    const controller = createSessionActionsController({
      role: "writer",
      cwd: "/tmp",
      sessionDir: "/tmp/sessions",
      getSession: () => ({}) as AgentSession,
      getSessionManager: () => sessionManager,
      getModelSetupState: () => ({
        requirement: "ready",
        providers: [],
        availableModels: [],
      }),
      askUserBridge: { answer, cancel: () => true },
      runtime: {
        newSession: async () => ({ cancelled: false }),
        switchSession: async () => ({ cancelled: false }),
      },
      sendBoot: vi.fn(),
      broadcastState: vi.fn(),
      broadcastSessions: vi.fn(),
      localSessionCoordinator: createLocalSessionCoordinator(),
    });

    await controller.handleAskUserAnswer("ask-1", "Yes", {
      actionId: "ask-action-1",
      sessionId: "session-1",
      source: "browser",
    });
    await controller.handleAskUserAnswer("ask-1", "Yes", {
      actionId: "ask-action-1",
      sessionId: "session-1",
      source: "browser",
    });

    expect(answer).toHaveBeenCalledOnce();
  });
});

function assistantMessage(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-responses",
    provider: "test",
    model: "test",
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop" as const,
    timestamp: Date.now(),
  };
}
