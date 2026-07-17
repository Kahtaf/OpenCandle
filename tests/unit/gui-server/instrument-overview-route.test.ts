import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpRequestHandler } from "../../../gui/server/http-routes.js";
import type { ToolInvokeController } from "../../../gui/server/invoke-tool.js";
import type { ModelSetupController } from "../../../gui/server/model-setup.js";
import { privateApiCookieHeader } from "../../../gui/server/private-api-access.js";
import type { QuoteSnapshotStore } from "../../../gui/server/quote-snapshot-store.js";
import type { SessionActionsController } from "../../../gui/server/session-actions.js";
import type { WsHub } from "../../../gui/server/ws-hub.js";

const { getInstrumentOverviewSnapshotMock } = vi.hoisted(() => ({
  getInstrumentOverviewSnapshotMock: vi.fn(),
}));

vi.mock("../../../gui/server/market-state-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../gui/server/market-state-api.js")>();
  return {
    ...actual,
    getInstrumentOverviewSnapshot: getInstrumentOverviewSnapshotMock,
  };
});

const privateApiSessionToken = "instrument-overview-route-token";
const trustedHeaders = { cookie: privateApiCookieHeader(privateApiSessionToken) };
const getSessionMock = vi.fn(() => {
  throw new Error("overview route must not access a session");
});

describe("instrument overview HTTP route", () => {
  let server: Server;
  let endpoint: string;

  beforeAll(async () => {
    const unavailable = () => {
      throw new Error("not used by instrument overview route tests");
    };
    const handler = createHttpRequestHandler({
      host: "127.0.0.1",
      port: 0,
      webDist: "/missing-web-dist",
      role: "follower",
      cwd: process.cwd(),
      agentDir: "/missing-agent-dir",
      sessionDir: "/missing-session-dir",
      privateApiSessionToken,
      localCoordinatorEndpoint: "",
      localCoordinatorSecret: "coordinator-secret",
      allowRemotePrivateApi: false,
      getSession: getSessionMock,
      getSessionManager: unavailable,
      createSessionForManager: async () => unavailable(),
      wsHub: fakeWsHub(),
      modelSetupController: fakeModelSetupController(),
      sessionActionsController: fakeSessionActionsController(),
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
    getInstrumentOverviewSnapshotMock.mockReset();
    getSessionMock.mockClear();
  });

  it("rejects untrusted requests before building an overview", async () => {
    const response = await fetch(`${endpoint}/api/instruments/overview?symbol=AAPL`);

    expect(response.status).toBe(403);
    expect(getInstrumentOverviewSnapshotMock).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("returns the unavailable snapshot for a missing symbol", async () => {
    const snapshot = { symbol: "", status: "unavailable", reason: "symbol is required" };
    getInstrumentOverviewSnapshotMock.mockResolvedValue(snapshot);

    const response = await fetch(`${endpoint}/api/instruments/overview`, {
      headers: trustedHeaders,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(getInstrumentOverviewSnapshotMock).toHaveBeenCalledWith("");
    expect(getSessionMock).not.toHaveBeenCalled();
  });

  it("returns the memoized overview snapshot as JSON", async () => {
    const snapshot = okSnapshot();
    getInstrumentOverviewSnapshotMock.mockResolvedValue(snapshot);

    const response = await fetch(`${endpoint}/api/instruments/overview?symbol=aapl`, {
      headers: trustedHeaders,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(getInstrumentOverviewSnapshotMock).toHaveBeenCalledWith("aapl");
    expect(getSessionMock).not.toHaveBeenCalled();
  });
});

function okSnapshot() {
  return {
    symbol: "AAPL",
    status: "ok" as const,
    name: "Apple Inc.",
    description: "Consumer technology company.",
    exchange: "NasdaqGS",
    sector: "Technology",
    industry: "Consumer Electronics",
    marketCap: 3_200_000_000_000,
    pe: 31.5,
    forwardPe: 28.4,
    eps: 7.1,
    dividendYield: 0.0044,
    beta: 1.2,
    avgVolume: 55_000_000,
    profitMargin: 0.24,
    revenueGrowth: 0.05,
    week52High: 260.1,
    week52Low: 164.08,
    stale: false,
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
      throw new Error("not used by instrument overview route tests");
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
