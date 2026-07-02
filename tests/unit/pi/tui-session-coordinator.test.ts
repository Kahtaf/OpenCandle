import { mkdtempSync, readFileSync } from "node:fs";
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

  it("returns a syncing response when the writer lock scope cannot be synced", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-sessions-"));
    try {
      const manager = SessionManager.create(cwd, sessionDir);
      const server = await startTuiSessionCoordinatorServer({
        getSession: () => fakeSession(manager),
        getSessionManager: () => manager,
        getModelUnavailableMessage: () => null,
        syncWriterLockScope: () => {
          throw new Error("OpenCandle is reconnecting to this session.");
        },
      });
      servers.push(server);

      const response = await fetch(`${server.endpoint}/api/local-coordinator/chat-run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencandle-coordinator-secret": server.secret,
        },
        body: JSON.stringify({
          prompt: "hello",
          sessionId: manager.getSessionId(),
          actionId: "chat-action-sync-lost",
        }),
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "syncing" });
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

  it("does not dedupe failed forwarded prompts as accepted", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-sessions-"));
    try {
      const manager = SessionManager.create(cwd, sessionDir);
      const prompt = vi
        .fn()
        .mockRejectedValueOnce(new Error("temporary model failure"))
        .mockImplementationOnce(async (value: string) => {
          manager.appendMessage({ role: "user", content: value });
          manager.appendMessage({ role: "assistant", content: "Recovered" });
        });
      const server = await startTuiSessionCoordinatorServer({
        getSession: () => fakeSession(manager, prompt),
        getSessionManager: () => manager,
        getModelUnavailableMessage: () => null,
      });
      servers.push(server);

      const request = () =>
        fetch(`${server.endpoint}/api/local-coordinator/chat-run`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencandle-coordinator-secret": server.secret,
          },
          body: JSON.stringify({
            prompt: "Retry me",
            sessionId: manager.getSessionId(),
            actionId: "chat-action-1",
          }),
        });

      const failed = await request();
      expect(failed.status).toBe(200);
      expect(await failed.text()).toContain('"type":"run.failed"');

      const retried = await request();
      expect(retried.status).toBe(200);
      const retriedStream = await retried.text();
      expect(retriedStream).toContain('"type":"run.completed"');
      expect(retriedStream).toContain("Recovered");
      expect(prompt).toHaveBeenCalledTimes(2);
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("dedupes forwarded prompts that fail after the user turn is admitted", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-sessions-"));
    try {
      const manager = SessionManager.create(cwd, sessionDir);
      const subscribers: Array<(event: unknown) => void> = [];
      const prompt = vi.fn(async (value: string) => {
        for (const subscriber of subscribers) {
          subscriber({ type: "message_start", message: { role: "user", content: value } });
        }
        throw new Error("failed after admission");
      });
      const session = {
        ...fakeSession(manager, prompt),
        subscribe(handler: (event: unknown) => void) {
          subscribers.push(handler);
          return () => {
            const index = subscribers.indexOf(handler);
            if (index >= 0) subscribers.splice(index, 1);
          };
        },
      } as ReturnType<typeof fakeSession> & {
        subscribe(handler: (event: unknown) => void): () => void;
      };
      const server = await startTuiSessionCoordinatorServer({
        getSession: () => session,
        getSessionManager: () => manager,
        getModelUnavailableMessage: () => null,
      });
      servers.push(server);

      const request = () =>
        fetch(`${server.endpoint}/api/local-coordinator/chat-run`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencandle-coordinator-secret": server.secret,
          },
          body: JSON.stringify({
            prompt: "Admitted once",
            sessionId: manager.getSessionId(),
            actionId: "chat-action-1",
          }),
        });

      const failed = await request();
      expect(failed.status).toBe(200);
      expect(await failed.text()).toContain('"type":"run.failed"');

      const retried = await request();
      expect(retried.status).toBe(200);
      await expect(retried.json()).resolves.toMatchObject({ duplicate: true });
      expect(prompt).toHaveBeenCalledOnce();
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("rejects forwarded prompts while the TUI session is already streaming", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-sessions-"));
    try {
      const manager = SessionManager.create(cwd, sessionDir);
      const prompt = vi.fn();
      const server = await startTuiSessionCoordinatorServer({
        getSession: () => fakeSession(manager, prompt, { isStreaming: true }),
        getSessionManager: () => manager,
        getModelUnavailableMessage: () => null,
      });
      servers.push(server);

      const response = await fetch(`${server.endpoint}/api/local-coordinator/chat-run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencandle-coordinator-secret": server.secret,
        },
        body: JSON.stringify({
          prompt: "GUI overlap",
          sessionId: manager.getSessionId(),
          actionId: "chat-action-1",
        }),
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "session_busy" });
      expect(prompt).not.toHaveBeenCalled();
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("does not stay busy when a forwarded prompt arrives before runtime startup", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-sessions-"));
    try {
      const manager = SessionManager.create(cwd, sessionDir);
      let ready = false;
      const server = await startTuiSessionCoordinatorServer({
        getSession: () => {
          if (!ready) throw new Error("OpenCandle is still starting this session.");
          return fakeSession(manager);
        },
        getSessionManager: () => manager,
        getModelUnavailableMessage: () => "Connect an AI model before chat can run.",
      });
      servers.push(server);

      const first = await fetch(`${server.endpoint}/api/local-coordinator/chat-run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencandle-coordinator-secret": server.secret,
        },
        body: JSON.stringify({
          prompt: "Too early",
          sessionId: manager.getSessionId(),
          actionId: "chat-action-1",
        }),
      });
      expect(first.status).toBe(409);
      await expect(first.json()).resolves.toMatchObject({ code: "session_starting" });

      ready = true;
      const second = await fetch(`${server.endpoint}/api/local-coordinator/chat-run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencandle-coordinator-secret": server.secret,
        },
        body: JSON.stringify({
          prompt: "After startup",
          sessionId: manager.getSessionId(),
          actionId: "chat-action-1",
        }),
      });

      expect(second.status).toBe(200);
      expect(await second.text()).toContain("After startup");
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("syncs the writer lock scope before accepting a forwarded prompt", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-tui-coordinator-sessions-"));
    try {
      const manager = SessionManager.create(cwd, sessionDir);
      const syncWriterLockScope = vi.fn();
      const prompt = vi.fn(async () => {
        expect(syncWriterLockScope).toHaveBeenCalled();
      });
      const server = await startTuiSessionCoordinatorServer({
        getSession: () => fakeSession(manager, prompt),
        getSessionManager: () => manager,
        getModelUnavailableMessage: () => null,
        syncWriterLockScope,
      });
      servers.push(server);

      const response = await fetch(`${server.endpoint}/api/local-coordinator/chat-run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencandle-coordinator-secret": server.secret,
        },
        body: JSON.stringify({
          prompt: "Sync before prompt",
          sessionId: manager.getSessionId(),
          actionId: "chat-action-1",
        }),
      });

      expect(response.status).toBe(200);
      expect(syncWriterLockScope.mock.invocationCallOrder[0]).toBeLessThan(
        prompt.mock.invocationCallOrder[0],
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });

  it("syncs the writer lock scope when a forwarded prompt is admitted", () => {
    const source = readFileSync("src/pi/tui-session-coordinator.ts", "utf8");
    const acceptedStart = source.indexOf("const recordAcceptedAction = () =>");
    const acceptedBlock = source.slice(acceptedStart, source.indexOf("};", acceptedStart) + 2);

    expect(acceptedBlock).toContain("recordAcceptedSessionAction(sessionManager, actionId)");
    expect(acceptedBlock).toContain("options.syncWriterLockScope?.()");
  });
});

function fakeSession(
  sessionManager: SessionManager,
  prompt: (value: string) => Promise<void> = async (value) => {
    sessionManager.appendMessage({ role: "user", content: value });
    sessionManager.appendMessage({ role: "assistant", content: "ok" });
  },
  state: { isStreaming?: boolean; pendingMessageCount?: number } = {},
) {
  return {
    sessionManager,
    prompt,
    isStreaming: state.isStreaming ?? false,
    pendingMessageCount: state.pendingMessageCount ?? 0,
  } as unknown as import("@earendil-works/pi-coding-agent").AgentSession;
}
