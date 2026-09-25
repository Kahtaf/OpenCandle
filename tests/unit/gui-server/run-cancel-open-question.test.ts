/**
 * HTTP integration proof that Stop retires a run whose tool is waiting on an
 * open ask_user question.
 *
 * Defect: the run-cancel route acknowledged the Stop (cancelled: true) but the
 * tool kept awaiting the GUI question, which only settled on an answer or an
 * explicit cancel. The run never ended, so every later send hit 409
 * session_busy. Stop must cancel the session's open questions so the waiting
 * tool settles and the run terminates as stopped.
 *
 * Boundary: a real ephemeral `node:http` server around the real
 * `createHttpRequestHandler` and the real ask_user bridge. The fake session's
 * prompt() stands in for a tool that ignores the abort signal and waits on the
 * bridge, which is the worst case the route must still retire.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSession, SessionEntry, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAskUserBridge } from "../../../gui/server/ask-user-bridge.js";
import { createHttpRequestHandler } from "../../../gui/server/http-routes.js";
import type { ToolInvokeController } from "../../../gui/server/invoke-tool.js";
import type { ModelSetupController } from "../../../gui/server/model-setup.js";
import { privateApiCookieHeader } from "../../../gui/server/private-api-access.js";
import type { QuoteSnapshotStore } from "../../../gui/server/quote-snapshot-store.js";
import { createGuiRunRegistry } from "../../../gui/server/run-cancellation.js";
import type { SessionActionsController } from "../../../gui/server/session-actions.js";
import type { WsHub } from "../../../gui/server/ws-hub.js";

const privateApiSessionToken = "run-cancel-open-question-token";
const trustedHeaders = { cookie: privateApiCookieHeader(privateApiSessionToken) };
const sessionId = "session-open-question";

describe("chat-run Stop while an ask_user question is open", () => {
  let server: Server;
  let endpoint: string;
  let tempRoot: string;
  let sessionDir: string;
  let previousHome: string | undefined;
  const entries: SessionEntry[] = [];
  const runRegistry = createGuiRunRegistry();
  const bridge = createAskUserBridge({ broadcast: () => {}, getSessionId: () => sessionId });
  const askAnswers: Array<{ answer: string | null; cancelled: boolean }> = [];
  let questionOpened: () => void = () => {};

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
      getSessionFile: () => join(sessionDir, `${sessionId}.jsonl`),
      getSessionDir: () => sessionDir,
      getEntries: () => entries,
      getSessionName: () => "Open question session",
      isPersisted: () => false,
      appendMessage: () => {},
      appendCustomEntry: () => {},
      appendCustomMessageEntry: () => {},
      appendSessionInfo: () => {},
    } as unknown as SessionManager;
  }

  const agentSession = {
    modelRuntime,
    model,
    get sessionManager() {
      return currentSessionManager();
    },
    isStreaming: false,
    pendingMessageCount: 0,
    subscribe: () => () => {},
    dispose: () => {},
    clearQueue: () => ({ steering: [], followUp: [] }),
    // A tool that ignores the abort signal: abort alone never settles it.
    abort: async () => {},
    prompt: async () => {
      const pending = bridge.askForSession(sessionId)({
        question: "Which horizon?",
        questionType: "select",
        options: ["1 month", "1 year"],
      });
      questionOpened();
      askAnswers.push(await pending);
      entries.push({
        id: `entry-${entries.length}`,
        type: "message",
        message: { role: "assistant", content: [], stopReason: "aborted" },
        timestamp: Date.now(),
      } as unknown as SessionEntry);
    },
  } as unknown as AgentSession;

  beforeAll(async () => {
    previousHome = process.env.OPENCANDLE_HOME;
    tempRoot = mkdtempSync(join(tmpdir(), "oc-run-cancel-question-"));
    process.env.OPENCANDLE_HOME = join(tempRoot, "home");
    sessionDir = mkdtempSync(join(tempRoot, "session-"));

    const handler = createHttpRequestHandler({
      host: "127.0.0.1",
      port: 0,
      webDist: "/missing-web-dist",
      role: "writer",
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
      cancelAskUserPromptsForSession: (id) => bridge.cancelForSession(id),
      wsHub: fakeWsHub(),
      modelSetupController: fakeModelSetupController(),
      sessionActionsController: fakeSessionActionsController(),
      toolInvokeController: fakeToolInvokeController(),
      quoteSnapshotStore: fakeQuoteSnapshotStore(),
      indicesSnapshotStore: fakeIndicesStore(),
      runRegistry,
    });
    server = createServer((req, res) => {
      void handler(req, res);
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
    for (const prompt of bridge.getPrompts()) bridge.cancel(prompt.id);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    if (previousHome === undefined) delete process.env.OPENCANDLE_HOME;
    else process.env.OPENCANDLE_HOME = previousHome;
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it("settles the open question as cancelled and retires the run", async () => {
    const actionId = "chat-open-question";
    const opened = new Promise<void>((resolve) => {
      questionOpened = resolve;
    });
    const runPromise = fetch(`${endpoint}/api/sessions/${sessionId}/runs`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ actionId, prompt: "Ask me which horizon", sessionId }),
    });
    await opened;
    const response = await runPromise;
    expect(response.status).toBe(200);

    const stop = await fetch(`${endpoint}/api/sessions/${sessionId}/run-cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ actionId: `stop-${actionId}`, targetActionId: actionId }),
    });
    await expect(stop.json()).resolves.toEqual({ ok: true, cancelled: true, duplicate: false });

    const body = await response.text();
    expect(body).toContain("Run stopped.");
    expect(body).not.toContain("run.completed");
    expect(askAnswers).toEqual([{ answer: null, cancelled: true }]);
    expect(bridge.getPrompts()[0]).toMatchObject({ status: "cancelled" });
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
