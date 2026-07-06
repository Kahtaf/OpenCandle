import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createLocalSessionCoordinator } from "../../../gui/server/local-session-coordinator.js";
import {
  createSessionActionsController,
  deleteSessionFile,
  promptAndSettle,
  renameSessionFile,
} from "../../../gui/server/session-actions.js";
import { acquireWriterLock, writerLockScopeForSession } from "../../../gui/server/writer-lock.js";

describe("GUI session actions", () => {
  it("threads image prompt options into the Pi session prompt", async () => {
    const entries = [{ id: "before" }, { id: "after" }];
    const runSession = {
      prompt: vi.fn(async () => undefined),
      subscribe: vi.fn(() => () => undefined),
      isStreaming: false,
      pendingMessageCount: 0,
      sessionManager: {
        getEntries: vi.fn(() => entries),
      },
    } as unknown as AgentSession;

    await promptAndSettle(runSession, "what is in this chart?", new Set(["before"]), undefined, {
      images: [{ type: "image", data: "base64", mimeType: "image/png" }],
    });

    expect(runSession.prompt).toHaveBeenCalledWith("what is in this chart?", {
      images: [{ type: "image", data: "base64", mimeType: "image/png" }],
    });
  });

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

  it("does not expose a legacy active-session prompt action", async () => {
    const controller = createSessionActionsController({
      role: "writer",
      cwd: "/tmp",
      sessionDir: "/tmp/sessions",
      getSession: () => ({ prompt: vi.fn() }) as unknown as AgentSession,
      getSessionManager: () => ({ getEntries: () => [] }) as unknown as SessionManager,
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
      now: () => 123,
    });

    // Chat prompts must go through the session-addressed chat-run API
    // (http-routes), which owns model-setup gating and action IDs; the
    // controller no longer carries an implicit active-session mutation.
    expect("handlePrompt" in controller).toBe(false);
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

  it("requires coordinated ask_user answers to name their target session", async () => {
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

    await expect(
      controller.handleAskUserAnswer("ask-1", "Yes", {
        actionId: "ask-action-1",
        source: "browser",
      }),
    ).rejects.toThrow("sessionId is required");
    expect(answer).not.toHaveBeenCalled();
  });

  it("rejects ask_user actions for unknown non-current sessions instead of falling back", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-session-actions-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-session-actions-sessions-"));
    try {
      const currentManager = SessionManager.create(cwd, sessionDir);
      const answer = vi.fn();
      const controller = createSessionActionsController({
        role: "writer",
        cwd,
        sessionDir,
        getSession: () => ({}) as AgentSession,
        getSessionManager: () => currentManager,
        getModelSetupState: () => ({
          requirement: "ready",
          providers: [],
          availableModels: [],
        }),
        askUserBridge: { answer, cancel: vi.fn() },
        runtime: {
          newSession: async () => ({ cancelled: false }),
          switchSession: async () => ({ cancelled: false }),
        },
        sendBoot: vi.fn(),
        broadcastState: vi.fn(),
        broadcastSessions: vi.fn(),
        localSessionCoordinator: createLocalSessionCoordinator(),
      });

      await expect(
        controller.handleAskUserAnswer("ask-1", "Yes", {
          actionId: "ask-action-1",
          sessionId: "missing-session",
          source: "browser",
        }),
      ).rejects.toThrow("Unknown saved session");
      expect(answer).not.toHaveBeenCalled();
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("proxies ask_user answers from non-owner GUI windows", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-session-actions-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-session-actions-sessions-"));
    const originalFetch = globalThis.fetch;
    try {
      const currentManager = SessionManager.create(cwd, sessionDir);
      const targetManager = SessionManager.create(cwd, sessionDir);
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(
        targetManager.getSessionFile() ?? "",
        `${JSON.stringify({
          type: "session",
          version: 1,
          id: targetManager.getSessionId(),
          timestamp: new Date().toISOString(),
          cwd,
        })}\n`,
      );
      await acquireWriterLock(writerLockScopeForSession(targetManager), "gui", {
        pid: 999_999,
        coordinatorEndpoint: "http://127.0.0.1:25432",
        coordinatorSecret: "secret",
      });
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      globalThis.fetch = fetchMock as typeof fetch;
      const controller = createSessionActionsController({
        role: "follower",
        cwd,
        sessionDir,
        getSession: () => ({}) as AgentSession,
        getSessionManager: () => currentManager,
        getModelSetupState: () => ({
          requirement: "ready",
          providers: [],
          availableModels: [],
        }),
        askUserBridge: { answer: vi.fn(), cancel: vi.fn() },
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
        sessionId: targetManager.getSessionId(),
        source: "browser",
      });

      expect(fetchMock).toHaveBeenCalledWith(
        new URL("http://127.0.0.1:25432/api/local-coordinator/ask-user"),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "x-opencandle-coordinator-secret": "secret",
          }),
          body: JSON.stringify({
            sessionId: targetManager.getSessionId(),
            actionId: "ask-action-1",
            actionType: "ask_user.answer",
            payload: { id: "ask-1", answer: "Yes" },
          }),
        }),
      );
    } finally {
      globalThis.fetch = originalFetch;
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("does not proxy ask_user answers to TUI-owned sessions", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-session-actions-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-session-actions-sessions-"));
    const originalFetch = globalThis.fetch;
    try {
      const currentManager = SessionManager.create(cwd, sessionDir);
      const targetManager = SessionManager.create(cwd, sessionDir);
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(
        targetManager.getSessionFile() ?? "",
        `${JSON.stringify({
          type: "session",
          version: 1,
          id: targetManager.getSessionId(),
          timestamp: new Date().toISOString(),
          cwd,
        })}\n`,
      );
      await acquireWriterLock(writerLockScopeForSession(targetManager), "tui", {
        pid: 999_999,
        coordinatorEndpoint: "http://127.0.0.1:25432",
        coordinatorSecret: "secret",
      });
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      globalThis.fetch = fetchMock as typeof fetch;
      const controller = createSessionActionsController({
        role: "follower",
        cwd,
        sessionDir,
        getSession: () => ({}) as AgentSession,
        getSessionManager: () => currentManager,
        getModelSetupState: () => ({
          requirement: "ready",
          providers: [],
          availableModels: [],
        }),
        askUserBridge: { answer: vi.fn(), cancel: vi.fn() },
        runtime: {
          newSession: async () => ({ cancelled: false }),
          switchSession: async () => ({ cancelled: false }),
        },
        sendBoot: vi.fn(),
        broadcastState: vi.fn(),
        broadcastSessions: vi.fn(),
        localSessionCoordinator: createLocalSessionCoordinator(),
      });

      await expect(
        controller.handleAskUserAnswer("ask-1", "Yes", {
          actionId: "ask-action-1",
          sessionId: targetManager.getSessionId(),
          source: "browser",
        }),
      ).rejects.toThrow("OpenCandle is reconnecting to this session.");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("proxies ask_user answers for non-current sessions from writer windows", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-session-actions-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-session-actions-sessions-"));
    const originalFetch = globalThis.fetch;
    try {
      const currentManager = SessionManager.create(cwd, sessionDir);
      const targetManager = SessionManager.create(cwd, sessionDir);
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(
        targetManager.getSessionFile() ?? "",
        `${JSON.stringify({
          type: "session",
          version: 1,
          id: targetManager.getSessionId(),
          timestamp: new Date().toISOString(),
          cwd,
        })}\n`,
      );
      await acquireWriterLock(writerLockScopeForSession(targetManager), "gui", {
        pid: 999_999,
        coordinatorEndpoint: "http://127.0.0.1:25432",
        coordinatorSecret: "secret",
      });
      const fetchMock = vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
      globalThis.fetch = fetchMock as typeof fetch;
      const answer = vi.fn();
      const controller = createSessionActionsController({
        role: "writer",
        cwd,
        sessionDir,
        getSession: () => ({}) as AgentSession,
        getSessionManager: () => currentManager,
        getModelSetupState: () => ({
          requirement: "ready",
          providers: [],
          availableModels: [],
        }),
        askUserBridge: { answer, cancel: vi.fn() },
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
        sessionId: targetManager.getSessionId(),
        source: "browser",
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(answer).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
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
