import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpRequestHandler } from "../../../gui/server/http-routes.js";
import type { ToolInvokeController } from "../../../gui/server/invoke-tool.js";
import type { ModelSetupController } from "../../../gui/server/model-setup.js";
import { privateApiCookieHeader } from "../../../gui/server/private-api-access.js";
import type { QuoteSnapshotStore } from "../../../gui/server/quote-snapshot-store.js";
import { createGuiRunRegistry } from "../../../gui/server/run-cancellation.js";
import type { SessionActionsController } from "../../../gui/server/session-actions.js";
import type { WsHub } from "../../../gui/server/ws-hub.js";

const privateApiSessionToken = "run-cancel-route-token";
const coordinatorSecret = "run-cancel-coordinator-secret";
const trustedHeaders = { cookie: privateApiCookieHeader(privateApiSessionToken) };

describe("run cancellation HTTP route", () => {
  let server: Server;
  let endpoint: string;
  const runRegistry = createGuiRunRegistry();
  let currentSessionId = "session-0";
  let sessionCounter = 0;

  beforeAll(async () => {
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
      localCoordinatorSecret: coordinatorSecret,
      allowRemotePrivateApi: false,
      getSession: () => ({}) as AgentSession,
      getSessionManager: () => sessionManager(currentSessionId),
      createSessionForManager: async () => ({ session: {} as AgentSession }),
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
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  beforeEach(() => {
    sessionCounter += 1;
    currentSessionId = `session-${sessionCounter}`;
  });

  async function postCancel(body: Record<string, unknown>, headers: Record<string, string> = {}) {
    return fetch(`${endpoint}/api/sessions/${currentSessionId}/run-cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  }

  it("rejects untrusted callers before touching the run registry", async () => {
    const response = await postCancel({ actionId: "stop-1", targetActionId: "chat-1" });
    expect(response.status).toBe(403);
  });

  it("requires a client action id", async () => {
    const response = await postCancel({ targetActionId: "chat-1" }, trustedHeaders);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "actionId is required" });
  });

  it("requires the original run action id", async () => {
    const response = await postCancel({ actionId: "stop-1" }, trustedHeaders);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "targetActionId is required" });
  });

  it("rejects an unknown session", async () => {
    const response = await fetch(`${endpoint}/api/sessions/missing-session/run-cancel`, {
      method: "POST",
      headers: { "content-type": "application/json", ...trustedHeaders },
      body: JSON.stringify({ actionId: "stop-1", targetActionId: "chat-1" }),
    });
    // getSessionManager only claims session-1; unknown ids fall through to the
    // session list and resolve to null.
    expect(response.status).toBe(404);
  });

  it("safely reports no active run for a known but idle session", async () => {
    const response = await postCancel(
      { actionId: "stop-1", targetActionId: "chat-1" },
      trustedHeaders,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      cancelled: false,
      reason: "no_active_run",
    });
  });

  it("rejects a stale stop that names an older run", async () => {
    const applyCancel = vi.fn();
    runRegistry
      .start({ sessionId: currentSessionId, actionId: "chat-new" })
      .setApplyCancel(applyCancel);

    const response = await postCancel(
      { actionId: "stop-1", targetActionId: "chat-old" },
      trustedHeaders,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      cancelled: false,
      reason: "stale_target",
    });
    expect(applyCancel).not.toHaveBeenCalled();
  });

  it("cancels the matching active run", async () => {
    const applyCancel = vi.fn();
    runRegistry
      .start({ sessionId: currentSessionId, actionId: "chat-1" })
      .setApplyCancel(applyCancel);

    const response = await postCancel(
      { actionId: "stop-1", targetActionId: "chat-1" },
      trustedHeaders,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      cancelled: true,
      duplicate: false,
    });
    expect(applyCancel).toHaveBeenCalledOnce();
  });
});

function sessionManager(sessionId = "session-1"): SessionManager {
  return {
    getSessionId: () => sessionId,
    getSessionFile: () => `/missing/${sessionId}.jsonl`,
    getSessionDir: () => "/missing-session-dir",
  } as unknown as SessionManager;
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
      throw new Error("not used by run cancellation route tests");
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
