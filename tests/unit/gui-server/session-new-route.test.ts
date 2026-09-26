import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpRequestHandler } from "../../../gui/server/http-routes.js";
import type { ToolInvokeController } from "../../../gui/server/invoke-tool.js";
import type { ModelSetupController } from "../../../gui/server/model-setup.js";
import { privateApiCookieHeader } from "../../../gui/server/private-api-access.js";
import type { QuoteSnapshotStore } from "../../../gui/server/quote-snapshot-store.js";
import {
  type SessionActionsController,
  SessionBusyError,
} from "../../../gui/server/session-actions.js";
import type { WsHub } from "../../../gui/server/ws-hub.js";

const privateApiSessionToken = "session-new-route-token";
const trustedHeaders = {
  cookie: privateApiCookieHeader(privateApiSessionToken),
};

describe("session new HTTP route", () => {
  let server: Server;
  let endpoint: string;
  let handleNewSession: ReturnType<typeof vi.fn>;
  let broadcastState: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    handleNewSession = vi.fn(async () => {});
    broadcastState = vi.fn();
    const unavailable = () => {
      throw new Error("not used by session new route tests");
    };
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
      getSession: unavailable,
      getSessionManager: unavailable,
      createSessionForManager: async () => unavailable(),
      wsHub: fakeWsHub(broadcastState),
      modelSetupController: fakeModelSetupController(),
      sessionActionsController: fakeSessionActionsController(handleNewSession),
      toolInvokeController: fakeToolInvokeController(),
      quoteSnapshotStore: fakeQuoteSnapshotStore(),
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
    handleNewSession.mockReset();
    handleNewSession.mockResolvedValue(undefined);
    broadcastState.mockReset();
  });

  it("returns 409 session_busy when the current session has an active run", async () => {
    handleNewSession.mockRejectedValueOnce(new SessionBusyError());

    const response = await fetch(`${endpoint}/api/session/new`, {
      method: "POST",
      headers: trustedHeaders,
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Session already has an active run",
      code: "session_busy",
    });
    expect(broadcastState).not.toHaveBeenCalled();
  });

  it("broadcasts state and returns bootstrap when the current session is idle", async () => {
    const response = await fetch(`${endpoint}/api/session/new`, {
      method: "POST",
      headers: trustedHeaders,
    });

    expect(response.status).toBe(200);
    expect(handleNewSession).toHaveBeenCalledOnce();
    expect(broadcastState).toHaveBeenCalledOnce();
  });
});

function fakeWsHub(broadcastState: ReturnType<typeof vi.fn>): WsHub {
  return {
    handleUpgrade: vi.fn(),
    getClientCount: () => 0,
    closeClients: vi.fn(),
    sendBoot: vi.fn(),
    buildBootstrapPayload: async () => ({}),
    broadcast: vi.fn(),
    broadcastModelSetup: vi.fn(),
    broadcastState,
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

function fakeSessionActionsController(
  handleNewSession: ReturnType<typeof vi.fn>,
): SessionActionsController {
  return {
    handleAskUserAnswer: async () => {},
    handleAskUserCancel: async () => {},
    handleNewSession,
    handleOpenSession: async () => {},
    handleRenameSession: async () => {},
    handleDeleteSession: async () => {},
  };
}

function fakeToolInvokeController(): ToolInvokeController {
  return {
    handleToolInvoke: async () => {
      throw new Error("not used by session new route tests");
    },
    handleToolInvokeMessage: async () => {},
  };
}

function fakeQuoteSnapshotStore(): QuoteSnapshotStore {
  return {
    get: async () => ({ status: "unavailable" }),
    invalidate: () => {},
  } as unknown as QuoteSnapshotStore;
}
