/**
 * HTTP integration proof for failed writer-lock acquisition on the
 * session-addressed chat-run route.
 *
 * Defect (verified full-branch autoreview P2): `streamAcceptedSseChatRun`
 * registers a cancellable run handle before it awaits `buildDispatchedPrompt`
 * and `acquireWriterLock`. The lock await used to sit *outside* every cleanup
 * path, so a throw from writer-lock storage leaked the registered handle for
 * the session forever. `activeGuiRuns.start` then refused every later run with
 * 409 `session_busy`, and a Stop for the leaked action id could "cancel" a run
 * that no longer existed. Ownership must be released on every unsuccessful
 * setup exit after registration.
 *
 * Boundary: this boots a real ephemeral `node:http` server around the real
 * `createHttpRequestHandler` and the real chat-run pipeline. The single fault
 * is a deterministic throw injected at the writer-lock module boundary
 * (`acquireWriterLock`) — no chmod/permission dependence, no production flag.
 * The recovery run is then driven through the real model-setup gate and the
 * real prompt/settle path with a gated fake session so a stale Stop can be
 * issued while the recovered run is genuinely active.
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

const lockFault = vi.hoisted(() => ({
  failNextAcquire: false,
  acquireCalls: 0,
}));

// Fault injection lives at the writer-lock module boundary: the real
// implementation stays in place for the recovery run, and one deterministic
// throw models writer-lock storage failing (EIO/ENOSPC) without relying on
// filesystem permissions that behave differently across platforms.
vi.mock("../../../src/pi/session-writer-lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/pi/session-writer-lock.js")>();
  return {
    ...actual,
    acquireWriterLock: async (...args: Parameters<typeof actual.acquireWriterLock>) => {
      lockFault.acquireCalls += 1;
      if (lockFault.failNextAcquire) {
        lockFault.failNextAcquire = false;
        throw new Error("EIO: writer lock storage unavailable");
      }
      return actual.acquireWriterLock(...args);
    },
  };
});

const privateApiSessionToken = "run-admission-lock-failure-token";
const trustedHeaders = { cookie: privateApiCookieHeader(privateApiSessionToken) };
const sessionId = "session-lock-fault";
const actionId = "chat-lock-fault";
const recoveredActionId = "chat-lock-recovered";

describe("chat-run writer-lock failure releases run ownership", () => {
  let server: Server;
  let endpoint: string;
  let tempRoot: string;
  let sessionDir: string;
  let sessionFile: string;
  let entries: SessionEntry[];
  let agentSession: AgentSession;
  let previousHome: string | undefined;

  const runRegistry = createGuiRunRegistry();
  const handlerRejections: unknown[] = [];
  let gateArmed = false;
  let promptGate!: Deferred<void>;
  let promptEngaged!: Deferred<void>;

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
      getSessionName: () => "Lock fault session",
      appendMessage: (message: unknown) => {
        entries.push({
          id: `entry-${entries.length}`,
          type: "message",
          message,
          timestamp: Date.now(),
        } as unknown as SessionEntry);
      },
      appendCustomMessageEntry: (
        customType: string,
        content: unknown,
        _display: boolean,
        details: unknown,
      ) => {
        entries.push({
          id: `entry-${entries.length}`,
          type: "custom_message",
          customType,
          content,
          details,
          timestamp: Date.now(),
        } as unknown as SessionEntry);
      },
      appendSessionInfo: () => {},
    } as unknown as SessionManager;
  }

  beforeAll(async () => {
    previousHome = process.env.OPENCANDLE_HOME;
    tempRoot = mkdtempSync(join(tmpdir(), "oc-run-admission-lock-"));
    process.env.OPENCANDLE_HOME = join(tempRoot, "home");

    const handler = createHttpRequestHandler({
      host: "127.0.0.1",
      port: 0,
      webDist: "/missing-web-dist",
      // Follower role forces the writer-lock acquisition branch even for the
      // current session, which is the exact setup boundary under test.
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
        // Production server.ts relies on the handler catching its own errors;
        // this only keeps the test process alive long enough to observe the
        // unhandled rejection on the pre-fix code.
        handlerRejections.push(error);
        if (!res.headersSent) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(
            JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
          );
          return;
        }
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
    lockFault.failNextAcquire = false;
    lockFault.acquireCalls = 0;
    handlerRejections.length = 0;
    gateArmed = false;
    agentSession = {
      modelRuntime,
      model,
      sessionManager: currentSessionManager(),
      isStreaming: false,
      pendingMessageCount: 0,
      subscribe: () => () => {},
      dispose: () => {},
      abort: async () => {},
      prompt: async () => {
        if (gateArmed) {
          gateArmed = false;
          promptEngaged.resolve();
          await promptGate.promise;
        }
        entries.push({
          id: `entry-${entries.length}`,
          type: "message",
          message: { role: "user", content: "hello" },
          timestamp: Date.now(),
        } as unknown as SessionEntry);
        entries.push({
          id: `entry-${entries.length}`,
          type: "message",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "ok" }],
            stopReason: "stop",
          },
          timestamp: Date.now(),
        } as unknown as SessionEntry);
      },
    } as unknown as AgentSession;
  });

  function postRun(body: Record<string, unknown>, routeSessionId = sessionId) {
    return fetch(`${endpoint}/api/sessions/${routeSessionId}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify(body),
    });
  }

  function postCancel(body: Record<string, unknown>) {
    return fetch(`${endpoint}/api/sessions/${sessionId}/run-cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify(body),
    });
  }

  it("returns 500 and releases ownership so the next run on the same session is admitted", async () => {
    // Stage 1: writer-lock storage throws during setup, after the run handle
    // was registered. The handler must fail closed with 500 and no rejection.
    lockFault.failNextAcquire = true;
    const failed = await postRun({ actionId, prompt: "hello", sessionId });
    expect(failed.status).toBe(500);
    await expect(failed.json()).resolves.toMatchObject({
      error: expect.stringContaining("EIO"),
    });
    expect(lockFault.acquireCalls).toBe(1);

    // No ownership may survive the failed setup: the registry has no active
    // run, so a Stop for that action id is an idle no-op, not a "cancellation".
    expect(runRegistry.has(sessionId)).toBe(false);
    expect(handlerRejections).toHaveLength(0);
    const staleAfterFailure = await postCancel({ actionId: "stop-1", targetActionId: actionId });
    expect(staleAfterFailure.status).toBe(200);
    await expect(staleAfterFailure.json()).resolves.toEqual({
      ok: true,
      cancelled: false,
      reason: "no_active_run",
    });

    // Stage 2: the FS/lock boundary recovers. The same session must be
    // admitted (not 409 session_busy) and complete through the real pipeline.
    promptGate = createDeferred<void>();
    promptEngaged = createDeferred<void>();
    gateArmed = true;
    const recoveredPromise = postRun({
      actionId: recoveredActionId,
      prompt: "hello again",
      sessionId,
    });
    // Race admission against the response so a leaked handle surfaces as a
    // fast 409 red instead of hanging on a prompt that is never reached.
    const admission = await Promise.race([
      promptEngaged.promise.then(() => "admitted" as const),
      recoveredPromise.then((response) => ({ response })),
    ]);
    expect(admission).toBe("admitted");

    // Stage 3: while the recovered run is genuinely active (paused inside its
    // prompt), a stale Stop naming the failed run must stay stale_target and
    // must not retire the recovered run.
    expect(runRegistry.has(sessionId)).toBe(true);
    const staleStop = await postCancel({ actionId: "stop-2", targetActionId: actionId });
    expect(staleStop.status).toBe(200);
    await expect(staleStop.json()).resolves.toEqual({
      ok: true,
      cancelled: false,
      reason: "stale_target",
    });

    promptGate.resolve();
    const recovered = await recoveredPromise;
    expect(recovered.status).toBe(200);
    const recoveredBody = await recovered.text();
    expect(recoveredBody).toContain("run.completed");
    expect(recoveredBody).not.toContain("run.failed");
    expect(handlerRejections).toHaveLength(0);
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
