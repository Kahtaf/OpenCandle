import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import {
  buildChatRunActionEnvelope,
  buildSessionBootstrapPayload,
  canProxyChatRunToCoordinator,
  resolveSessionManagerById,
  sessionIdFromRoute,
} from "../../../gui/server/http-routes.js";
import { acquireWriterLock, writerLockScopeForSession } from "../../../gui/server/writer-lock.js";
import type { WsHub } from "../../../gui/server/ws-hub.js";

describe("session-addressed GUI bootstrap", () => {
  it("builds a transcript snapshot for the requested session without using active state", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-session-bootstrap-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-session-bootstrap-sessions-"));
    try {
      const requested = SessionManager.create(cwd, sessionDir);
      requested.appendSessionInfo("Requested session");
      requested.appendMessage({ role: "user", content: "Load this exact session" });

      const other = SessionManager.create(cwd, sessionDir);
      other.appendMessage({ role: "user", content: "Do not load me" });

      const payload = await buildSessionBootstrapPayload(
        {
          cwd,
          sessionDir,
          role: "writer",
          getSessionManager: () => other,
          wsHub: wsHubWithPrompts(),
          modelSetupController: {
            buildCurrentModelSetupState: () => ({
              requirement: "ready",
              providers: [],
              availableModels: [],
            }),
          },
        },
        requested,
      );

      expect(payload.sessionId).toBe(requested.getSessionId());
      // Pi intentionally does not create the JSONL file until a real assistant
      // response exists. The UI must not rotate away from this transient session.
      expect(payload.sessionPersisted).toBe(false);
      const snapshot = payload.snapshot as {
        sessionId: string;
        events: Array<{ sessionId: string; type: string }>;
      };
      expect(snapshot.sessionId).toBe(requested.getSessionId());
      expect(snapshot.events.every((event) => event.sessionId === requested.getSessionId())).toBe(
        true,
      );
      expect(JSON.stringify(snapshot.events)).toContain("Load this exact session");
      expect(JSON.stringify(snapshot.events)).not.toContain("Do not load me");
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("reports follower role when the requested session is locked by another writer", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-session-bootstrap-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-session-bootstrap-sessions-"));
    try {
      const requested = SessionManager.create(cwd, sessionDir);
      const current = SessionManager.create(cwd, sessionDir);
      await acquireWriterLock(writerLockScopeForSession(requested), "tui", { pid: 999_999 });

      const payload = await buildSessionBootstrapPayload(
        {
          cwd,
          sessionDir,
          role: "writer",
          getSessionManager: () => current,
          wsHub: wsHubWithPrompts(),
          modelSetupController: {
            buildCurrentModelSetupState: () => ({
              requirement: "ready",
              providers: [],
              availableModels: [],
            }),
          },
        },
        requested,
      );

      expect(payload.role).toBe("follower");
      expect(payload.sessionId).toBe(requested.getSessionId());
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("resolves the current fresh session before it appears in saved-session listings", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-session-bootstrap-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-session-bootstrap-sessions-"));
    try {
      const current = SessionManager.create(cwd, sessionDir);

      const resolved = await resolveSessionManagerById(
        {
          cwd,
          sessionDir,
          getSessionManager: () => current,
        },
        current.getSessionId(),
      );

      expect(resolved).toBe(current);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("includes pending ask-user prompts in requested session bootstrap payloads", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-session-bootstrap-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-session-bootstrap-sessions-"));
    try {
      const requested = SessionManager.create(cwd, sessionDir);

      const payload = await buildSessionBootstrapPayload(
        {
          cwd,
          sessionDir,
          role: "writer",
          getSessionManager: () => requested,
          wsHub: wsHubWithPrompts([
            {
              id: "ask-1",
              sessionId: requested.getSessionId(),
              question: "Continue?",
              status: "pending",
            },
          ]),
          modelSetupController: {
            buildCurrentModelSetupState: () => ({
              requirement: "ready",
              providers: [],
              availableModels: [],
            }),
          },
        },
        requested,
      );

      expect(payload.askUserPrompts).toMatchObject([
        { id: "ask-1", sessionId: requested.getSessionId(), status: "pending" },
      ]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("ignores malformed percent-encoded session route ids instead of throwing", () => {
    expect(sessionIdFromRoute("/api/sessions/%/bootstrap", "bootstrap")).toBe("");
    expect(sessionIdFromRoute("/api/sessions/%/runs", "runs")).toBe("");
    expect(sessionIdFromRoute("/api/sessions/session%20id/bootstrap", "bootstrap")).toBe(
      "session id",
    );
  });

  it("builds a session-scoped chat action envelope from chat run requests", () => {
    expect(
      buildChatRunActionEnvelope(
        {
          prompt: "Tell me about AAPL",
          actionId: "action-1",
          sessionId: "session-from-body",
        },
        "session-from-route",
      ),
    ).toEqual({
      sessionId: "session-from-route",
      actionId: "action-1",
      actionType: "chat.prompt",
      payload: { prompt: "Tell me about AAPL" },
      source: "browser",
    });
  });

  it("does not mint a fallback chat action id when older clients do not send one", () => {
    const action = buildChatRunActionEnvelope({ prompt: "hello" }, "session-1");

    expect(action).toEqual({
      sessionId: "session-1",
      actionId: "",
      actionType: "chat.prompt",
      payload: { prompt: "hello" },
      source: "browser",
    });
  });

  it("detects only a fresh live per-session coordinator when this process owns another session", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-session-bootstrap-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-session-bootstrap-sessions-"));
    try {
      const current = SessionManager.create(cwd, sessionDir);
      const requested = SessionManager.create(cwd, sessionDir);
      const staleRequested = SessionManager.create(cwd, sessionDir);
      await acquireWriterLock(writerLockScopeForSession(current), "gui", { pid: process.pid });
      await acquireWriterLock(writerLockScopeForSession(requested), "tui", {
        pid: process.ppid,
        coordinatorEndpoint: "http://127.0.0.1:25432",
        coordinatorSecret: "secret",
      });
      await acquireWriterLock(writerLockScopeForSession(staleRequested), "tui", {
        pid: process.ppid,
        coordinatorEndpoint: "http://127.0.0.1:25432",
        coordinatorSecret: "secret",
        now: () => new Date("2000-01-01T00:00:00.000Z"),
      });

      expect(canProxyChatRunToCoordinator(current)).toBe(false);
      expect(canProxyChatRunToCoordinator(requested)).toBe(true);
      expect(canProxyChatRunToCoordinator(staleRequested)).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});

function wsHubWithPrompts(askUserPrompts: unknown[] = []): WsHub {
  return {
    buildBootstrapPayload: async () => ({ askUserPrompts }),
  } as unknown as WsHub;
}
