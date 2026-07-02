import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startTuiSessionCoordinatorServer } from "../../../src/pi/tui-session-coordinator.js";

describe("TUI session coordinator", () => {
  const servers: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.close()));
  });

  it("rejects unauthorized local coordinator requests", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-sessions-"));
    try {
      const manager = SessionManager.create(cwd, sessionDir);
      const server = await startTuiSessionCoordinatorServer({
        getSession: () => fakeSession(manager),
        getSessionManager: () => manager,
        getModelUnavailableMessage: () => "Connect an AI model before chat can run.",
      });
      servers.push(server);

      const response = await fetch(`${server.endpoint}/api/local-coordinator/chat-run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: "hello", sessionId: manager.getSessionId() }),
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "Local coordinator request was not authorized.",
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("accepts an authorized forwarded prompt and streams the canonical transcript", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-sessions-"));
    try {
      const manager = SessionManager.create(cwd, sessionDir);
      const server = await startTuiSessionCoordinatorServer({
        getSession: () => fakeSession(manager),
        getSessionManager: () => manager,
        getModelUnavailableMessage: () => "Connect an AI model before chat can run.",
      });
      servers.push(server);

      const response = await fetch(`${server.endpoint}/api/local-coordinator/chat-run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencandle-coordinator-secret": server.secret,
        },
        body: JSON.stringify({
          prompt: "Can GUI write into this TUI session?",
          sessionId: manager.getSessionId(),
          actionId: "chat-action-1",
        }),
      });

      expect(response.status).toBe(200);
      const stream = await response.text();
      expect(stream).toContain('"type":"run.started"');
      expect(stream).toContain('"type":"message.completed"');
      expect(stream).toContain("Can GUI write into this TUI session?");
      expect(stream).toContain("Connect an AI model before chat can run.");
      expect(stream).toContain('"type":"run.completed"');
      expect(JSON.stringify(manager.getEntries())).toContain(
        "Can GUI write into this TUI session?",
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("dedupes retried action ids and keeps concurrent prompts session-busy", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-sessions-"));
    try {
      const manager = SessionManager.create(cwd, sessionDir);
      let releasePrompt: (() => void) | undefined;
      const prompt = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releasePrompt = resolve;
          }),
      );
      const server = await startTuiSessionCoordinatorServer({
        getSession: () => fakeSession(manager, prompt),
        getSessionManager: () => manager,
        getModelUnavailableMessage: () => null,
      });
      servers.push(server);

      const first = fetch(`${server.endpoint}/api/local-coordinator/chat-run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencandle-coordinator-secret": server.secret,
        },
        body: JSON.stringify({
          prompt: "First",
          sessionId: manager.getSessionId(),
          actionId: "chat-action-1",
        }),
      });

      await vi.waitFor(() => expect(prompt).toHaveBeenCalledOnce());
      const busy = await fetch(`${server.endpoint}/api/local-coordinator/chat-run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencandle-coordinator-secret": server.secret,
        },
        body: JSON.stringify({
          prompt: "Second",
          sessionId: manager.getSessionId(),
          actionId: "chat-action-2",
        }),
      });
      expect(busy.status).toBe(409);
      await expect(busy.json()).resolves.toMatchObject({ code: "session_busy" });

      manager.appendMessage({ role: "user", content: "First" });
      manager.appendMessage({ role: "assistant", content: "Done" });
      releasePrompt?.();
      expect((await first).status).toBe(200);

      const duplicate = await fetch(`${server.endpoint}/api/local-coordinator/chat-run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencandle-coordinator-secret": server.secret,
        },
        body: JSON.stringify({
          prompt: "First",
          sessionId: manager.getSessionId(),
          actionId: "chat-action-1",
        }),
      });

      expect(duplicate.status).toBe(200);
      await expect(duplicate.json()).resolves.toMatchObject({ duplicate: true });
      expect(prompt).toHaveBeenCalledOnce();
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});

function fakeSession(
  sessionManager: SessionManager,
  prompt: (value: string) => Promise<void> = async (value) => {
    sessionManager.appendMessage({ role: "user", content: value });
    sessionManager.appendMessage({ role: "assistant", content: "ok" });
  },
) {
  return {
    sessionManager,
    prompt,
    isStreaming: false,
    pendingMessageCount: 0,
  } as unknown as import("@earendil-works/pi-coding-agent").AgentSession;
}
