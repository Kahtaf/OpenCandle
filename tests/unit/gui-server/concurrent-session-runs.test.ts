/**
 * HTTP integration proof for #254: runs in different sessions are independent.
 *
 * A browser sends a long prompt in session A (the server's current session),
 * then starts a new chat while A is still running and sends a quick prompt
 * there. The new chat used to be rejected with 409 `session_busy` because
 * "new chat" replaced the Pi runtime's current session, which cannot happen
 * while A's run is in flight. The new chat must instead get its own session,
 * whose run is admitted and completes while A keeps running; A then completes
 * normally. One run per session is still enforced.
 *
 * Boundary: a real ephemeral `node:http` server around the real
 * `createHttpRequestHandler`, the real session-actions controller, the real
 * detached-session registry, and real Pi `SessionManager`s in a temp session
 * directory. Only the model turn is a gated fake AgentSession.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDetachedSessionRegistry } from "../../../gui/server/gui-session-manager.js";
import { createHttpRequestHandler } from "../../../gui/server/http-routes.js";
import type { ToolInvokeController } from "../../../gui/server/invoke-tool.js";
import { createLocalSessionCoordinator } from "../../../gui/server/local-session-coordinator.js";
import type { ModelSetupController } from "../../../gui/server/model-setup.js";
import { privateApiCookieHeader } from "../../../gui/server/private-api-access.js";
import type { QuoteSnapshotStore } from "../../../gui/server/quote-snapshot-store.js";
import { createSessionActionsController } from "../../../gui/server/session-actions.js";
import type { WsHub } from "../../../gui/server/ws-hub.js";
import {
  attachSessionCancellationState,
  createSessionCancellationState,
} from "../../../src/pi/session-cancellation.js";

const privateApiSessionToken = "concurrent-session-runs-token";
const trustedHeaders = { cookie: privateApiCookieHeader(privateApiSessionToken) };

describe("chat runs in different sessions are independent", () => {
  let server: Server;
  let endpoint: string;
  let tempRoot: string;
  let previousHome: string | undefined;
  let currentManager: SessionManager;
  let currentSession: AgentSession;
  const runtimeNewSession = vi.fn(async () => ({ cancelled: false }));
  const createdFor: string[] = [];
  const handlerRejections: unknown[] = [];
  const currentGate = createDeferred<void>();
  const currentEngaged = createDeferred<void>();

  beforeAll(async () => {
    previousHome = process.env.OPENCANDLE_HOME;
    tempRoot = mkdtempSync(join(tmpdir(), "oc-concurrent-sessions-"));
    process.env.OPENCANDLE_HOME = join(tempRoot, "home");
    const cwd = join(tempRoot, "cwd");
    const sessionDir = join(tempRoot, "sessions");
    currentManager = SessionManager.create(cwd, sessionDir);
    currentSession = fakeAgentSession(currentManager, "long portfolio answer", {
      gate: currentGate,
      engaged: currentEngaged,
    });
    // The real per-session cancellation state is how the controller sees that
    // the current session has a run in flight.
    attachSessionCancellationState(currentSession, createSessionCancellationState());

    const detachedSessions = createDetachedSessionRegistry();
    const localSessionCoordinator = createLocalSessionCoordinator();
    const sessionActionsController = createSessionActionsController({
      role: "writer",
      cwd,
      sessionDir,
      getSession: () => currentSession,
      getSessionManager: () => currentManager,
      getModelSetupState: () => ({ requirement: "ready", providers: [], availableModels: [] }),
      askUserBridge: { answer: () => true, cancel: () => true },
      runtime: { newSession: runtimeNewSession, switchSession: vi.fn() },
      sendBoot: vi.fn(),
      broadcastState: vi.fn(),
      broadcastSessions: vi.fn(),
      localSessionCoordinator,
      detachedSessions,
    });

    const handler = createHttpRequestHandler({
      host: "127.0.0.1",
      port: 0,
      webDist: "/missing-web-dist",
      role: "writer",
      cwd,
      agentDir: "/missing-agent-dir",
      sessionDir,
      privateApiSessionToken,
      localCoordinatorEndpoint: "",
      localCoordinatorSecret: "coordinator-secret",
      allowRemotePrivateApi: false,
      getSession: () => currentSession,
      getSessionManager: () => currentManager,
      createSessionForManager: async (sessionManager) => {
        createdFor.push(sessionManager.getSessionId());
        return { session: fakeAgentSession(sessionManager, "AAPL is trading at $189.42.") };
      },
      wsHub: fakeWsHub(),
      modelSetupController: fakeModelSetupController(),
      sessionActionsController,
      toolInvokeController: fakeToolInvokeController(),
      quoteSnapshotStore: fakeQuoteSnapshotStore(),
      indicesSnapshotStore: fakeIndicesStore(),
      localSessionCoordinator,
      detachedSessions,
    });
    server = createServer((req, res) => {
      void handler(req, res).catch((error: unknown) => {
        handlerRejections.push(error);
        if (!res.headersSent) res.writeHead(500);
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
    currentGate.resolve();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousHome === undefined) delete process.env.OPENCANDLE_HOME;
    else process.env.OPENCANDLE_HOME = previousHome;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function postRun(sessionId: string, actionId: string, prompt: string) {
    return fetch(`${endpoint}/api/sessions/${encodeURIComponent(sessionId)}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ sessionId, actionId, prompt }),
    });
  }

  it("admits and completes a new chat's run while another session's run is still active", async () => {
    const sessionA = currentManager.getSessionId();
    const runA = postRun(sessionA, "chat-a", "Build me a balanced portfolio with $50,000");
    await currentEngaged.promise;

    // New chat while A is still running: a separate session, not a 409.
    const created = await fetch(`${endpoint}/api/session/new`, {
      method: "POST",
      headers: trustedHeaders,
    });
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as { sessionId?: string; detached?: boolean };
    expect(createdBody.detached).toBe(true);
    const sessionB = String(createdBody.sessionId ?? "");
    expect(sessionB).toBeTruthy();
    expect(sessionB).not.toBe(sessionA);
    expect(runtimeNewSession).not.toHaveBeenCalled();

    // B's run is admitted on its own Pi session and completes while A is held.
    const runB = await postRun(sessionB, "chat-b", "What is AAPL trading at?");
    expect(runB.status).toBe(200);
    const bodyB = await runB.text();
    expect(bodyB).toContain("run.completed");
    expect(bodyB).not.toContain("run.failed");
    expect(createdFor).toEqual([sessionB]);

    // One run per session still holds for A.
    const secondA = await postRun(sessionA, "chat-a-2", "A second prompt for A");
    expect(secondA.status).toBe(409);
    await expect(secondA.json()).resolves.toMatchObject({ code: "session_busy" });

    // A's stream was not disrupted by B and completes normally.
    currentGate.resolve();
    const responseA = await runA;
    expect(responseA.status).toBe(200);
    const bodyA = await responseA.text();
    expect(bodyA).toContain("run.completed");
    expect(bodyA).not.toContain("run.failed");

    // B is now a saved session that resolves by id like any other.
    const saved = await SessionManager.list(join(tempRoot, "cwd"), join(tempRoot, "sessions"));
    expect(saved.map((session) => session.id)).toEqual(
      expect.arrayContaining([sessionA, sessionB]),
    );
    expect(handlerRejections).toEqual([]);
  });
});

function fakeAgentSession(
  sessionManager: SessionManager,
  answer: string,
  hold?: { gate: Deferred<void>; engaged: Deferred<void> },
): AgentSession {
  const model = { provider: "test-provider", id: "test-model" };
  const session = {
    modelRuntime: {
      refresh: () => undefined,
      getError: () => undefined,
      getModels: () => [model],
      getAvailableSnapshot: () => [model],
      getModel: () => undefined,
      hasConfiguredAuth: () => true,
    },
    model,
    sessionManager,
    isStreaming: false,
    pendingMessageCount: 0,
    subscribe: () => () => {},
    dispose: () => {},
    abort: async () => {},
    prompt: async (prompt: string) => {
      session.isStreaming = true;
      try {
        sessionManager.appendMessage({ role: "user", content: prompt, timestamp: Date.now() });
        if (hold) {
          hold.engaged.resolve();
          await hold.gate.promise;
        }
        sessionManager.appendMessage(assistantMessage(answer));
      } finally {
        session.isStreaming = false;
      }
    },
  };
  return session as unknown as AgentSession;
}

function assistantMessage(text: string) {
  return {
    role: "assistant" as const,
    content: [{ type: "text" as const, text }],
    api: "openai-completions",
    provider: "test-provider",
    model: "test-model",
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

function fakeToolInvokeController(): ToolInvokeController {
  return {
    handleToolInvoke: async () => {
      throw new Error("not used by concurrent session run tests");
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
