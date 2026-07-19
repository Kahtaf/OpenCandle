import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { SessionManager as PiSessionManager } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createHttpRequestHandler } from "../../../gui/server/http-routes.js";
import type { ToolInvokeController } from "../../../gui/server/invoke-tool.js";
import { createLocalSessionCoordinator } from "../../../gui/server/local-session-coordinator.js";
import type { ModelSetupController } from "../../../gui/server/model-setup.js";
import type { QuoteSnapshotStore } from "../../../gui/server/quote-snapshot-store.js";
import type { SessionActionsController } from "../../../gui/server/session-actions.js";
import { acquireWriterLock, writerLockScopeForSession } from "../../../gui/server/writer-lock.js";
import type { WsHub } from "../../../gui/server/ws-hub.js";

describe("GUI/TUI coordinator convergence smoke", () => {
  it("streams a GUI-owned coordinator prompt and a separate TUI-side reader sees the same transcript", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "opencandle-wp7-cwd-"));
    const sessionDir = mkdtempSync(join(tmpdir(), "opencandle-wp7-sessions-"));
    let closeServer: (() => Promise<void>) | undefined;
    try {
      const sessionManager = PiSessionManager.create(cwd, sessionDir);
      const session = fakeSession(sessionManager);
      const options = {
        host: "127.0.0.1",
        port: 0,
        webDist: join(cwd, "missing-web-dist"),
        role: "writer",
        cwd,
        agentDir: join(cwd, ".agent"),
        sessionDir,
        privateApiSessionToken: "private-token",
        localCoordinatorEndpoint: "",
        localCoordinatorSecret: "coordinator-secret",
        allowRemotePrivateApi: false,
        syncCurrentWriterLockScope: vi.fn(),
        getSession: () => session,
        getSessionManager: () => sessionManager,
        createSessionForManager: async () => ({ session }),
        wsHub: fakeWsHub(),
        modelSetupController: fakeModelSetupController(),
        sessionActionsController: fakeSessionActionsController(),
        toolInvokeController: fakeToolInvokeController(),
        quoteSnapshotStore: fakeQuoteSnapshotStore(),
        localSessionCoordinator: createLocalSessionCoordinator(),
      };
      const handler = createHttpRequestHandler(options);
      const server = createServer((req, res) => {
        void handler(req, res);
      });
      closeServer = () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      options.localCoordinatorEndpoint = endpoint;
      await acquireWriterLock(writerLockScopeForSession(sessionManager), "gui", {
        coordinatorEndpoint: endpoint,
        coordinatorSecret: options.localCoordinatorSecret,
      });

      const prompt = "WP7 coordinator convergence prompt";
      const response = await fetch(`${endpoint}/api/local-coordinator/chat-run`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencandle-coordinator-secret": options.localCoordinatorSecret,
        },
        body: JSON.stringify({
          prompt,
          sessionId: sessionManager.getSessionId(),
          actionId: "wp7-convergence-action",
        }),
      });

      expect(response.status).toBe(200);
      const stream = await response.text();
      expect(stream).toContain('"type":"run.started"');
      expect(stream).toContain('"type":"run.completed"');
      expect(stream).toContain(prompt);
      expect(stream).toContain("GUI owner accepted the coordinator prompt");

      const sessionFile = sessionManager.getSessionFile();
      expect(sessionFile).toBeTruthy();
      const tuiRead = spawnSync(process.execPath, ["--input-type=module", "-e", tuiReaderScript], {
        encoding: "utf8",
        env: {
          ...process.env,
          OPENCANDLE_WP7_SESSION_FILE: sessionFile ?? "",
          OPENCANDLE_WP7_SESSION_DIR: sessionDir,
          OPENCANDLE_WP7_CWD: cwd,
        },
      });
      expect(tuiRead.status).toBe(0);
      const tuiSnapshot = asRecord(JSON.parse(tuiRead.stdout));
      expect(tuiSnapshot.pid).not.toBe(process.pid);
      expect(tuiSnapshot.sessionId).toBe(sessionManager.getSessionId());
      const tuiTranscript = JSON.stringify(tuiSnapshot.entries);
      expect(tuiTranscript).toContain(prompt);
      expect(tuiTranscript).toContain("GUI owner accepted the coordinator prompt");
      expect(tuiSnapshot.entries).toEqual(JSON.parse(JSON.stringify(sessionManager.getEntries())));
    } finally {
      await closeServer?.();
      await rm(cwd, { recursive: true, force: true });
      await rm(sessionDir, { recursive: true, force: true });
    }
  });
});

const tuiReaderScript = `
const { SessionManager } = await import("@earendil-works/pi-coding-agent");
const sessionFile = process.env.OPENCANDLE_WP7_SESSION_FILE;
const sessionDir = process.env.OPENCANDLE_WP7_SESSION_DIR;
const cwd = process.env.OPENCANDLE_WP7_CWD;
if (!sessionFile || !sessionDir || !cwd) throw new Error("Missing WP7 reader environment");
const session = SessionManager.open(sessionFile, sessionDir, cwd);
process.stdout.write(JSON.stringify({
  pid: process.pid,
  sessionId: session.getSessionId(),
  sessionFile: session.getSessionFile(),
  entries: session.getEntries(),
}));
`;

function fakeSession(sessionManager: SessionManager): AgentSession {
  const model = { provider: "test", id: "test-model" };
  return {
    sessionManager,
    model,
    modelRuntime: {
      refresh: vi.fn(async () => {}),
      reloadConfig: vi.fn(async () => {}),
      getAvailableSnapshot: () => [model],
      hasConfiguredAuth: () => true,
      getModel: () => model,
    },
    isStreaming: false,
    pendingMessageCount: 0,
    async prompt(value: string) {
      sessionManager.appendMessage({ role: "user", content: value, timestamp: Date.now() });
      sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "GUI owner accepted the coordinator prompt" }],
        api: "openai-responses",
        provider: "test",
        model: "test-model",
        usage: emptyUsage(),
        stopReason: "stop",
        timestamp: Date.now(),
      });
    },
    subscribe: () => () => {},
  } as unknown as AgentSession;
}

function fakeWsHub(): WsHub {
  return {
    handleUpgrade: vi.fn(),
    getClientCount: () => 0,
    closeClients: vi.fn(),
    sendBoot: vi.fn(),
    buildBootstrapPayload: async () => ({ askUserPrompts: [] }),
    broadcast: vi.fn(),
    broadcastModelSetup: vi.fn(),
    broadcastState: vi.fn(),
    broadcastSessionSnapshot: vi.fn(),
    broadcastSessions: vi.fn(),
    buildStateSnapshot: () => ({ sessionId: "session", state: {}, entries: [], events: [] }),
    currentChatEvents: () => [],
    subscribeToSessionEvents: () => () => {},
  };
}

function fakeModelSetupController(): ModelSetupController {
  return {
    buildCurrentModelSetupState: () => ({
      requirement: "ready",
      providers: [],
      availableModels: [],
    }),
    handleSaveModelApiKey: async () => {},
    handleSaveProviderApiKey: async () => {},
    handleSelectModel: async () => {},
  };
}

function fakeSessionActionsController(): SessionActionsController {
  return {
    handleAskUserAnswer: async () => {},
    handleAskUserCancel: async () => {},
    handleNewSession: async () => {},
    handleOpenSession: async () => {},
    handleRenameSession: async () => {},
    handleDeleteSession: async () => {},
  };
}

function fakeToolInvokeController(): ToolInvokeController {
  return {
    handleToolInvoke: async () => {
      throw new Error("not used by WP7 convergence smoke");
    },
    handleToolInvokeMessage: async () => {},
  };
}

function fakeQuoteSnapshotStore(): QuoteSnapshotStore {
  return {
    get: async () => ({ updatedAt: new Date().toISOString(), quotes: [] }),
    invalidate: vi.fn(),
  } as unknown as QuoteSnapshotStore;
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
