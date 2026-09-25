/**
 * HTTP integration proof that a Stop arriving while a chat run is still being
 * set up prevents the queued prompt from starting.
 *
 * Defect (review P2): the run handle is registered before setup awaits
 * (prompt dispatch, writer lock, session creation). A Stop during those awaits
 * was remembered, but the queued prompt was still dispatched afterwards, so a
 * slash command such as `/analyze` (which Pi runs without the extension input
 * hook that checks the cancellation token) ran anyway. The run must settle as
 * stopped without ever calling `prompt()`.
 *
 * Boundary: a real ephemeral `node:http` server around the real
 * `createHttpRequestHandler`. The only seam is a deterministic gate at the
 * writer-lock module boundary, which holds setup open until the Stop lands.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession, SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpRequestHandler } from "../../../gui/server/http-routes.js";
import type { ToolInvokeController } from "../../../gui/server/invoke-tool.js";
import type { ModelSetupController } from "../../../gui/server/model-setup.js";
import { privateApiCookieHeader } from "../../../gui/server/private-api-access.js";
import type { QuoteSnapshotStore } from "../../../gui/server/quote-snapshot-store.js";
import { createGuiRunRegistry } from "../../../gui/server/run-cancellation.js";
import type { SessionActionsController } from "../../../gui/server/session-actions.js";
import type { WsHub } from "../../../gui/server/ws-hub.js";

const lockGate = vi.hoisted(() => ({
  entered: undefined as undefined | (() => void),
  release: undefined as undefined | Promise<void>,
}));

// Hold writer-lock acquisition open so a Stop deterministically lands during
// setup; the real implementation still runs once the gate opens.
vi.mock("../../../src/pi/session-writer-lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/pi/session-writer-lock.js")>();
  return {
    ...actual,
    acquireWriterLock: async (...args: Parameters<typeof actual.acquireWriterLock>) => {
      lockGate.entered?.();
      if (lockGate.release) await lockGate.release;
      return actual.acquireWriterLock(...args);
    },
  };
});

const privateApiSessionToken = "run-cancel-during-setup-token";
const trustedHeaders = { cookie: privateApiCookieHeader(privateApiSessionToken) };
const sessionId = "session-cancel-during-setup";

describe("chat-run Stop during setup", () => {
  let server: Server;
  let endpoint: string;
  let tempRoot: string;
  let sessionDir: string;
  let sessionFile: string;
  let entries: SessionEntry[];
  let agentSession: AgentSession;
  let promptCalls: string[];
  let previousHome: string | undefined;

  const runRegistry = createGuiRunRegistry();
  const handlerRejections: unknown[] = [];

  const model = { provider: "test-provider", id: "test-model" };
  const modelRuntime = {
    refresh: () => undefined,
    getError: () => undefined,
    getModels: () => [model],
    getAvailableSnapshot: () => [model],
    getModel: () => undefined,
    hasConfiguredAuth: () => true,
  };

  function currentSessionManager(): SessionManager {
    return {
      getSessionId: () => sessionId,
      getSessionFile: () => sessionFile,
      getSessionDir: () => sessionDir,
      getEntries: () => entries,
      getSessionName: () => "Cancel during setup session",
      isPersisted: () => false,
      appendMessage: (message: unknown) => {
        entries.push({
          id: `entry-${entries.length}`,
          type: "message",
          message,
          timestamp: Date.now(),
        } as unknown as SessionEntry);
      },
      appendCustomEntry: () => {},
      appendCustomMessageEntry: () => {},
      appendSessionInfo: () => {},
    } as unknown as SessionManager;
  }

  beforeAll(async () => {
    previousHome = process.env.OPENCANDLE_HOME;
    tempRoot = mkdtempSync(join(tmpdir(), "oc-run-cancel-setup-"));
    process.env.OPENCANDLE_HOME = join(tempRoot, "home");

    const handler = createHttpRequestHandler({
      host: "127.0.0.1",
      port: 0,
      webDist: "/missing-web-dist",
      // Follower role forces the writer-lock await even for the current
      // session, which is the setup window this test holds open.
      role: "follower",
      cwd: process.cwd(),
      agentDir: "/missing-agent-dir",
      sessionDir: "/missing-session-dir",
      privateApiSessionToken,
      localCoordinatorEndpoint: "",
      localCoordinatorSecret: "coordinator-secret",
      allowRemotePrivateApi: false,
      getSession: () => agentSession,
      getSessionManager: currentSessionManager,
      createSessionForManager: async () => ({ session: agentSession }),
      wsHub: fakeWsHub(),
      modelSetupController: fakeModelSetupController(),
      sessionActionsController: fakeSessionActionsController(),
      toolInvokeController: fakeToolInvokeController(),
      quoteSnapshotStore: fakeQuoteSnapshotStore(),
      indicesSnapshotStore: fakeIndicesStore(),
      runRegistry,
    });
    server = createServer((req, res) => {
      void handler(req, res).catch((error: unknown) => {
        handlerRejections.push(error);
        res.end();
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousHome === undefined) delete process.env.OPENCANDLE_HOME;
    else process.env.OPENCANDLE_HOME = previousHome;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    sessionDir = mkdtempSync(join(tempRoot, "session-"));
    sessionFile = join(sessionDir, `${sessionId}.jsonl`);
    entries = [];
    promptCalls = [];
    handlerRejections.length = 0;
    lockGate.entered = undefined;
    lockGate.release = undefined;
    agentSession = {
      modelRuntime,
      model,
      sessionManager: currentSessionManager(),
      isStreaming: false,
      pendingMessageCount: 0,
      subscribe: () => () => {},
      dispose: () => {},
      clearQueue: () => {},
      abort: async () => {},
      prompt: async (text: string) => {
        promptCalls.push(text);
        entries.push({
          id: `entry-${entries.length}`,
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "analysis ran" }],
            stopReason: "stop",
          },
          timestamp: Date.now(),
        } as unknown as SessionEntry);
      },
    } as unknown as AgentSession;
  });

  it.each([
    ["a slash command", "/analyze AAPL"],
    ["a chat prompt", "hello"],
  ])("never starts %s when Stop lands before setup resolves", async (_label, prompt) => {
    const actionId = `chat-setup-${prompt.startsWith("/") ? "slash" : "chat"}`;
    const entered = createDeferred<void>();
    const release = createDeferred<void>();
    lockGate.entered = () => entered.resolve();
    lockGate.release = release.promise;

    const runPromise = fetch(`${endpoint}/api/sessions/${sessionId}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ actionId, prompt, sessionId }),
    });
    await entered.promise;

    const stop = await fetch(`${endpoint}/api/sessions/${sessionId}/run-cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ actionId: `stop-${actionId}`, targetActionId: actionId }),
    });
    await expect(stop.json()).resolves.toEqual({ ok: true, cancelled: true, duplicate: false });

    release.resolve();
    const response = await runPromise;
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(promptCalls).toEqual([]);
    expect(body).toContain("run.failed");
    expect(body).toContain("Run stopped.");
    expect(body).not.toContain("run.completed");
    expect(body).not.toContain("Timed out");
    expect(handlerRejections).toHaveLength(0);
    await vi.waitFor(() => expect(runRegistry.has(sessionId)).toBe(false));
  });

  it("never starts a run whose Stop overtook the run request", async () => {
    const actionId = "chat-stop-overtook-run";
    // Deterministic worst case: the Stop is fully handled before the run
    // request is even sent, so the run is not registered yet.
    const stop = await fetch(`${endpoint}/api/sessions/${sessionId}/run-cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ actionId: `stop-${actionId}`, targetActionId: actionId }),
    });
    expect(stop.status).toBe(200);

    const response = await fetch(`${endpoint}/api/sessions/${sessionId}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ actionId, prompt: "hello", sessionId }),
    });
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(promptCalls).toEqual([]);
    expect(body).toContain("Run stopped.");
    expect(body).not.toContain("run.completed");
    expect(handlerRejections).toHaveLength(0);
    await vi.waitFor(() => expect(runRegistry.has(sessionId)).toBe(false));
  });

  function fakeWsHub(): WsHub {
    return {
      handleUpgrade: vi.fn(),
      getClientCount: () => 0,
      closeClients: vi.fn(),
      sendBoot: vi.fn(),
      buildBootstrapPayload: async () => ({}),
      broadcast: vi.fn(),
      broadcastModelSetup: vi.fn(),
      broadcastState: vi.fn(),
      broadcastSessionSnapshot: vi.fn(),
      broadcastSessions: vi.fn(),
      buildStateSnapshot: () => ({ sessionId: "session", state: {}, entries: [], events: [] }),
      currentChatEvents: () => [],
      subscribeToSessionEvents: () => () => {},
    } as unknown as WsHub;
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
        throw new Error("not used by run-admission lock failure tests");
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

  function fakeIndicesStore() {
    return {
      get: async () => ({ updatedAt: new Date().toISOString(), indices: [] }),
      invalidate: vi.fn(),
    } as never;
  }
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
