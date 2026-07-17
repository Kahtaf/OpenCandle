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

const { getInstrumentHistorySnapshotMock } = vi.hoisted(() => ({
  getInstrumentHistorySnapshotMock: vi.fn(),
}));

vi.mock("../../../gui/server/market-state-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../gui/server/market-state-api.js")>();
  return {
    ...actual,
    getInstrumentHistorySnapshot: getInstrumentHistorySnapshotMock,
  };
});

const privateApiSessionToken = "instrument-history-route-token";
const trustedHeaders = {
  cookie: privateApiCookieHeader(privateApiSessionToken),
};

describe("instrument history HTTP route", () => {
  let server: Server;
  let endpoint: string;

  beforeAll(async () => {
    const unavailable = () => {
      throw new Error("not used by instrument history route tests");
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
      getSession: unavailable,
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
    getInstrumentHistorySnapshotMock.mockReset();
  });

  it("rejects untrusted requests before building a snapshot", async () => {
    const response = await fetch(`${endpoint}/api/instruments/history?symbol=AAPL&range=1D`);

    expect(response.status).toBe(403);
    expect(getInstrumentHistorySnapshotMock).not.toHaveBeenCalled();
  });

  it("returns a trusted history snapshot", async () => {
    const snapshot = okSnapshot();
    getInstrumentHistorySnapshotMock.mockResolvedValue(snapshot);

    const response = await fetch(`${endpoint}/api/instruments/history?symbol=AAPL&range=1D`, {
      headers: trustedHeaders,
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(getInstrumentHistorySnapshotMock).toHaveBeenCalledWith("AAPL", "1D", undefined);
  });

  it("ignores the reserved compare parameter", async () => {
    const snapshot = okSnapshot();
    getInstrumentHistorySnapshotMock.mockResolvedValue(snapshot);

    const response = await fetch(
      `${endpoint}/api/instruments/history?symbol=AAPL&range=1D&compare=MSFT`,
      { headers: trustedHeaders },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(snapshot);
    expect(getInstrumentHistorySnapshotMock).toHaveBeenCalledWith("AAPL", "1D", undefined);
  });

  it("returns invalid range and interval results with HTTP 400", async () => {
    const invalidRange = { status: "invalid_request", reason: "Unknown history range: 7W" };
    const invalidInterval = {
      status: "invalid_request",
      reason: "History range 1Y exceeds the depth cap for interval 5m",
    };
    getInstrumentHistorySnapshotMock
      .mockResolvedValueOnce(invalidRange)
      .mockResolvedValueOnce(invalidInterval);

    const rangeResponse = await fetch(`${endpoint}/api/instruments/history?symbol=AAPL&range=7W`, {
      headers: trustedHeaders,
    });
    const intervalResponse = await fetch(
      `${endpoint}/api/instruments/history?symbol=AAPL&range=1Y&interval=5m`,
      { headers: trustedHeaders },
    );

    expect(rangeResponse.status).toBe(400);
    await expect(rangeResponse.json()).resolves.toEqual(invalidRange);
    expect(intervalResponse.status).toBe(400);
    await expect(intervalResponse.json()).resolves.toEqual(invalidInterval);
    expect(getInstrumentHistorySnapshotMock).toHaveBeenNthCalledWith(1, "AAPL", "7W", undefined);
    expect(getInstrumentHistorySnapshotMock).toHaveBeenNthCalledWith(2, "AAPL", "1Y", "5m");
  });

  it("defaults the range to 1D", async () => {
    getInstrumentHistorySnapshotMock.mockResolvedValue(okSnapshot());

    const response = await fetch(`${endpoint}/api/instruments/history?symbol=AAPL`, {
      headers: trustedHeaders,
    });

    expect(response.status).toBe(200);
    expect(getInstrumentHistorySnapshotMock).toHaveBeenCalledWith("AAPL", "1D", undefined);
  });
});

function okSnapshot() {
  return {
    status: "ok" as const,
    symbol: "AAPL",
    range: "1D",
    interval: "5m" as const,
    source: "Yahoo Finance" as const,
    fetchedAt: "2026-07-16T14:00:00.000Z",
    dataAsOf: "2026-07-16",
    stale: false,
    prevClose: 211.18,
    bars: [
      {
        time: 1_768_484_700,
        open: 212,
        high: 213,
        low: 211.5,
        close: 212.75,
        volume: 1_000,
      },
    ],
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
      throw new Error("not used by instrument history route tests");
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
