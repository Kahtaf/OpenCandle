/**
 * HTTP integration proof for the trusted-GUI auth boundary.
 *
 * Despite living in the unit-project tree, these cases boot a real ephemeral
 * `node:http` server around the real `createHttpRequestHandler` and the real
 * `private-api-access` guard. Only external/heavy collaborators (doctor report,
 * market-state feeds, sparkline, session listing) are stubbed, and each stub is
 * a sentinel spy so an unauthorized request can be shown to never reach the
 * business handler. No live network calls are made; loopback only.
 *
 * This replaces the source-string `it.each` route rows that previously only
 * grepped `http-routes.ts` for the guard call text.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHttpRequestHandler } from "../../../gui/server/http-routes.js";
import type { ToolInvokeController } from "../../../gui/server/invoke-tool.js";
import type { MarketIndicesSnapshotStore } from "../../../gui/server/market-indices-snapshot-store.js";
import type { ModelSetupController } from "../../../gui/server/model-setup.js";
import { privateApiCookieHeader } from "../../../gui/server/private-api-access.js";
import type { QuoteSnapshotStore } from "../../../gui/server/quote-snapshot-store.js";
import type { SessionActionsController } from "../../../gui/server/session-actions.js";
import type { WsHub } from "../../../gui/server/ws-hub.js";

const mocks = vi.hoisted(() => ({
  buildBootstrapPayload: vi.fn(),
  broadcast: vi.fn(),
  broadcastModelSetup: vi.fn(),
  broadcastState: vi.fn(),
  broadcastSessions: vi.fn(),
  handleNewSession: vi.fn(),
  getSessionManager: vi.fn(),
  currentChatEvents: vi.fn(),
  getSession: vi.fn(),
  refresh: vi.fn(),
  handleSaveModelApiKey: vi.fn(),
  handleSelectModel: vi.fn(),
  handleSaveProviderApiKey: vi.fn(),
  buildDoctorReport: vi.fn(),
  buildModelSetupState: vi.fn(),
  listDisplaySessions: vi.fn(),
  indicesGet: vi.fn(),
  fetchTickerLineSparkline: vi.fn(),
  getInstrumentHistorySnapshot: vi.fn(),
  getInstrumentOverviewSnapshot: vi.fn(),
}));

vi.mock("../../../src/doctor/report.js", () => ({
  buildDoctorReport: mocks.buildDoctorReport,
}));

vi.mock("../../../gui/server/ticker-line-sparkline.js", () => ({
  fetchTickerLineSparkline: mocks.fetchTickerLineSparkline,
}));

vi.mock("../../../gui/server/session-list.js", () => ({
  listDisplaySessions: mocks.listDisplaySessions,
}));

vi.mock("../../../gui/server/model-setup.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../gui/server/model-setup.js")>();
  return { ...actual, buildModelSetupState: mocks.buildModelSetupState };
});

vi.mock("../../../gui/server/market-state-api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../gui/server/market-state-api.js")>();
  return {
    ...actual,
    getInstrumentHistorySnapshot: mocks.getInstrumentHistorySnapshot,
    getInstrumentOverviewSnapshot: mocks.getInstrumentOverviewSnapshot,
  };
});

const privateApiSessionToken = "route-auth-boundary-session-token";
const trustedHeaders = { cookie: privateApiCookieHeader(privateApiSessionToken) };
const wrongCookie = privateApiCookieHeader("not-the-session-token");

type RouteBoundaryCase = {
  name: string;
  method: "GET" | "POST";
  path: string;
  sentinel: ReturnType<typeof vi.fn>;
};

/**
 * One row per trusted GUI route whose authorization the old source-string
 * `it.each` asserted. `sentinel` is the first business-handler call the route
 * makes after the guard, so `not.toHaveBeenCalled()` proves the unauthorized
 * request never crossed the boundary.
 */
const routeBoundaryCases: RouteBoundaryCase[] = [
  {
    name: "GET /api/bootstrap",
    method: "GET",
    path: "/api/bootstrap",
    sentinel: mocks.buildBootstrapPayload,
  },
  {
    name: "POST /api/session/new",
    method: "POST",
    path: "/api/session/new",
    sentinel: mocks.handleNewSession,
  },
  {
    name: "GET /api/sessions",
    method: "GET",
    path: "/api/sessions",
    sentinel: mocks.getSessionManager,
  },
  {
    name: "GET /api/session/events",
    method: "GET",
    path: "/api/session/events",
    sentinel: mocks.currentChatEvents,
  },
  {
    name: "POST /api/model-setup/refresh",
    method: "POST",
    path: "/api/model-setup/refresh",
    sentinel: mocks.refresh,
  },
  {
    name: "POST /api/model-setup/api-key",
    method: "POST",
    path: "/api/model-setup/api-key",
    sentinel: mocks.handleSaveModelApiKey,
  },
  {
    name: "POST /api/model-setup/model",
    method: "POST",
    path: "/api/model-setup/model",
    sentinel: mocks.handleSelectModel,
  },
  {
    name: "POST /api/provider-setup/api-key",
    method: "POST",
    path: "/api/provider-setup/api-key",
    sentinel: mocks.handleSaveProviderApiKey,
  },
  {
    name: "GET /api/doctor",
    method: "GET",
    path: "/api/doctor",
    sentinel: mocks.buildDoctorReport,
  },
  {
    name: "GET /api/market-state/indices",
    method: "GET",
    path: "/api/market-state/indices",
    sentinel: mocks.indicesGet,
  },
  {
    name: "GET /api/market-state/sparkline",
    method: "GET",
    path: "/api/market-state/sparkline?symbol=AAPL&assetType=equity",
    sentinel: mocks.fetchTickerLineSparkline,
  },
  {
    name: "GET /api/instruments/history",
    method: "GET",
    path: "/api/instruments/history?symbol=AAPL&range=1D",
    sentinel: mocks.getInstrumentHistorySnapshot,
  },
  {
    name: "GET /api/instruments/overview",
    method: "GET",
    path: "/api/instruments/overview?symbol=AAPL",
    sentinel: mocks.getInstrumentOverviewSnapshot,
  },
];

describe("GUI route authorization HTTP integration", () => {
  let server: Server;
  let endpoint: string;

  beforeAll(async () => {
    mocks.buildBootstrapPayload.mockResolvedValue({});
    mocks.handleNewSession.mockResolvedValue(undefined);
    mocks.getSessionManager.mockReturnValue({ getSessionId: () => "session-1" });
    mocks.currentChatEvents.mockReturnValue([]);
    mocks.getSession.mockReturnValue({ modelRuntime: { refresh: mocks.refresh }, model: {} });
    mocks.refresh.mockResolvedValue(undefined);
    mocks.handleSaveModelApiKey.mockResolvedValue(undefined);
    mocks.handleSelectModel.mockResolvedValue(undefined);
    mocks.handleSaveProviderApiKey.mockResolvedValue(undefined);
    mocks.buildDoctorReport.mockResolvedValue({});
    mocks.buildModelSetupState.mockReturnValue({ requirement: "ready", providers: [] });
    mocks.listDisplaySessions.mockResolvedValue([]);
    mocks.indicesGet.mockResolvedValue({ generatedAt: "2026-01-01T00:00:00.000Z", indices: [] });
    mocks.fetchTickerLineSparkline.mockResolvedValue({
      status: "ok",
      svg: "<svg></svg>",
      dataAsOf: "2026-01-01T00:00:00.000Z",
    });
    mocks.getInstrumentHistorySnapshot.mockResolvedValue({ status: "ok", bars: [] });
    mocks.getInstrumentOverviewSnapshot.mockResolvedValue({ status: "ok", symbol: "AAPL" });

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
      getSession: mocks.getSession as unknown as () => never,
      getSessionManager: mocks.getSessionManager as unknown as () => never,
      createSessionForManager: async () => {
        throw new Error("not used by route auth boundary tests");
      },
      wsHub: fakeWsHub(),
      modelSetupController: fakeModelSetupController(),
      sessionActionsController: fakeSessionActionsController(),
      toolInvokeController: fakeToolInvokeController(),
      quoteSnapshotStore: {} as QuoteSnapshotStore,
      indicesSnapshotStore: { get: mocks.indicesGet } as unknown as MarketIndicesSnapshotStore,
    });
    server = createServer((req, res) => void handler(req, res));
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
    for (const mock of Object.values(mocks)) mock.mockClear();
  });

  it.each(routeBoundaryCases)(
    "$name rejects missing, wrong, and cross-origin credentials before the handler, then serves a trusted same-origin request",
    async ({ method, path, sentinel }) => {
      const expectDenied = async (headers: Record<string, string>) => {
        sentinel.mockClear();
        const response = await fetch(`${endpoint}${path}`, { method, headers });
        expect(response.status).toBe(403);
        expect(sentinel).not.toHaveBeenCalled();
      };

      await expectDenied({});
      await expectDenied({ cookie: wrongCookie });
      await expectDenied({ ...trustedHeaders, origin: "http://untrusted.example" });

      sentinel.mockClear();
      const authorized = await fetch(`${endpoint}${path}`, { method, headers: trustedHeaders });

      expect(authorized.status).not.toBe(404);
      expect(authorized.status).toBe(200);
      expect(sentinel).toHaveBeenCalledTimes(1);
    },
  );
});

function fakeWsHub(): WsHub {
  return {
    handleUpgrade: vi.fn(),
    getClientCount: () => 0,
    closeClients: vi.fn(),
    sendBoot: vi.fn(),
    buildBootstrapPayload: mocks.buildBootstrapPayload,
    broadcast: mocks.broadcast,
    broadcastModelSetup: mocks.broadcastModelSetup,
    broadcastState: mocks.broadcastState,
    broadcastSessionSnapshot: vi.fn(),
    broadcastSessions: mocks.broadcastSessions,
    buildStateSnapshot: () => ({ sessionId: "session", state: {}, entries: [], events: [] }),
    currentChatEvents: mocks.currentChatEvents,
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
    handleSaveModelApiKey: mocks.handleSaveModelApiKey,
    handleSaveProviderApiKey: mocks.handleSaveProviderApiKey,
    handleSelectModel: mocks.handleSelectModel,
  };
}

function fakeSessionActionsController(): SessionActionsController {
  return {
    handleAskUserAnswer: async () => {},
    handleAskUserCancel: async () => {},
    handleNewSession: mocks.handleNewSession,
    handleOpenSession: async () => {},
    handleRenameSession: async () => {},
    handleDeleteSession: async () => {},
  };
}

function fakeToolInvokeController(): ToolInvokeController {
  return {
    handleToolInvoke: async () => {
      throw new Error("not used by route auth boundary tests");
    },
    handleToolInvokeMessage: async () => {},
  };
}
