import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundQuoteRefreshes } from "../../../gui/server/background-quotes.js";
import { createHttpRequestHandler } from "../../../gui/server/http-routes.js";
import type { ToolInvokeController } from "../../../gui/server/invoke-tool.js";
import type { MarketIndicesSnapshotStore } from "../../../gui/server/market-indices-snapshot-store.js";
import type { ModelSetupController } from "../../../gui/server/model-setup.js";
import { privateApiCookieHeader } from "../../../gui/server/private-api-access.js";
import type { QuoteSnapshotStore } from "../../../gui/server/quote-snapshot-store.js";
import type { SessionActionsController } from "../../../gui/server/session-actions.js";
import type { WsClient } from "../../../gui/server/websocket.js";
import { createWsHub, type WsHub } from "../../../gui/server/ws-hub.js";

const { getPreferencesSnapshotMock, deleteStoredPreferenceMock, deleteStoredToolDefaultMock } =
  vi.hoisted(() => ({
    getPreferencesSnapshotMock: vi.fn(),
    deleteStoredPreferenceMock: vi.fn(),
    deleteStoredToolDefaultMock: vi.fn(),
  }));

vi.mock("../../../gui/server/preferences-api.js", () => ({
  getPreferencesSnapshot: getPreferencesSnapshotMock,
  deleteStoredPreference: deleteStoredPreferenceMock,
  deleteStoredToolDefault: deleteStoredToolDefaultMock,
}));

const { shouldBlockCoordinatorActionMock } = vi.hoisted(() => ({
  shouldBlockCoordinatorActionMock: vi.fn(() => false),
}));

vi.mock("../../../gui/server/writer-lock.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  shouldBlockFailedCoordinatorAction: shouldBlockCoordinatorActionMock,
}));

const SNAPSHOT = {
  preferences: [
    {
      namespace: "global",
      key: "risk_profile",
      value: "balanced",
      source: "explicit",
      confidence: "high",
      updatedAt: "2026-08-01T10:00:00.000Z",
    },
  ],
  toolDefaults: [
    {
      toolName: "get_stock_history",
      paramPath: "range",
      value: "6mo",
      setAt: "2026-08-01T10:00:00.000Z",
    },
  ],
};

// The lock guard is module-mocked, so the manager only needs to be callable.
let lockSessionManager: SessionManager | null = {} as SessionManager;

beforeEach(() => {
  lockSessionManager = {} as SessionManager;
  shouldBlockCoordinatorActionMock.mockReset().mockReturnValue(false);
  getPreferencesSnapshotMock.mockReset().mockReturnValue(SNAPSHOT);
  deleteStoredPreferenceMock.mockReset().mockReturnValue({ ...SNAPSHOT, preferences: [] });
  deleteStoredToolDefaultMock.mockReset().mockReturnValue({ ...SNAPSHOT, toolDefaults: [] });
});

describe("preferences WS commands", () => {
  it("serves the list payload with both stores and no credential material", async () => {
    const client = connect();

    client.messageHandlers[0]?.({ type: "preferences.list" });

    await vi.waitFor(() =>
      expect(client.messages).toContainEqual({ type: "preferences", ...SNAPSHOT }),
    );
    const payload = client.messages.find(
      (message) => (message as { type?: string }).type === "preferences",
    );
    expect(Object.keys(payload as object).sort()).toEqual(["preferences", "toolDefaults", "type"]);
    expect(JSON.stringify(payload)).not.toMatch(/apikey|api_key|secret|token|credential/i);
  });

  it("deletes a preference and broadcasts the refreshed payload", async () => {
    const client = connect();

    client.messageHandlers[0]?.({
      type: "preferences.delete",
      namespace: "global",
      key: "risk_profile",
    });

    await vi.waitFor(() =>
      expect(deleteStoredPreferenceMock).toHaveBeenCalledWith("global", "risk_profile"),
    );
    expect(client.messages.at(-1)).toEqual({
      type: "preferences",
      ...SNAPSHOT,
      preferences: [],
    });
  });

  it("deletes a tool default and broadcasts the refreshed payload", async () => {
    const client = connect();

    client.messageHandlers[0]?.({
      type: "tool_defaults.delete",
      toolName: "get_stock_history",
      paramPath: "range",
    });

    await vi.waitFor(() =>
      expect(deleteStoredToolDefaultMock).toHaveBeenCalledWith("get_stock_history", "range"),
    );
    expect(client.messages.at(-1)).toEqual({
      type: "preferences",
      ...SNAPSHOT,
      toolDefaults: [],
    });
  });

  it("keeps a follower read-only for deletes while still serving the list", async () => {
    const client = connect("follower");

    client.messageHandlers[0]?.({
      type: "preferences.delete",
      namespace: "global",
      key: "risk_profile",
    });
    await vi.waitFor(() =>
      expect(client.messages).toContainEqual({
        type: "error",
        message: "OpenCandle is reconnecting to this session.",
      }),
    );
    expect(deleteStoredPreferenceMock).not.toHaveBeenCalled();

    client.messageHandlers[0]?.({ type: "preferences.list" });
    await vi.waitFor(() =>
      expect(client.messages).toContainEqual({ type: "preferences", ...SNAPSHOT }),
    );
  });

  it("refuses deletes while another live process owns the session lock", async () => {
    shouldBlockCoordinatorActionMock.mockReturnValue(true);
    const client = connect();

    client.messageHandlers[0]?.({
      type: "preferences.delete",
      namespace: "global",
      key: "risk_profile",
    });
    await vi.waitFor(() =>
      expect(client.messages).toContainEqual({
        type: "error",
        message: "OpenCandle is reconnecting to this session.",
      }),
    );
    expect(deleteStoredPreferenceMock).not.toHaveBeenCalled();

    client.messageHandlers[0]?.({
      type: "tool_defaults.delete",
      toolName: "get_stock_history",
      paramPath: "range",
    });
    await vi.waitFor(() =>
      expect(client.messages.filter((m) => m.type === "error").length).toBe(2),
    );
    expect(deleteStoredToolDefaultMock).not.toHaveBeenCalled();
  });

  function connect(role = "writer") {
    const client = createFakeClient();
    const hub = createWsHub({
      role,
      lock: { role: "writer" },
      cwd: process.cwd(),
      sessionDir: "/missing-session-dir",
      getSession: () =>
        ({
          modelRuntime: { refresh: vi.fn() },
          subscribe: vi.fn(() => vi.fn()),
        }) as unknown as AgentSession,
      getSessionManager: () =>
        ({
          getSessionId: () => "session-1",
          getSessionName: () => "Macro session",
          getEntries: () => [],
        }) as unknown as SessionManager,
      backgroundQuoteRefreshes: new BackgroundQuoteRefreshes(),
      askUserBridge: { getPrompts: () => [] },
      modelSetupController: {
        buildCurrentModelSetupState: () => ({
          requirement: "ready",
          providers: [],
          availableModels: [],
        }),
      } as ModelSetupController,
      toolInvokeController: {} as ToolInvokeController,
      sessionActionsController: {} as SessionActionsController,
      onClientCountChanged: vi.fn(),
      acceptWebSocketFn: () => client,
    });
    hub.handleUpgrade({ url: "/ws" } as IncomingMessage, { destroy: vi.fn() } as unknown as Duplex);
    client.messages.length = 0;
    return client;
  }
});

describe("preferences HTTP fallback routes", () => {
  const privateApiSessionToken = "preferences-route-token";
  const trustedHeaders = { cookie: privateApiCookieHeader(privateApiSessionToken) };
  let server: Server;
  let endpoint: string;
  let role = "writer";

  beforeAll(async () => {
    const unavailable = () => {
      throw new Error("not used by preferences route tests");
    };
    const handler = createHttpRequestHandler({
      host: "127.0.0.1",
      port: 0,
      webDist: "/missing-web-dist",
      get role() {
        return role;
      },
      cwd: process.cwd(),
      agentDir: "/missing-agent-dir",
      sessionDir: "/missing-session-dir",
      privateApiSessionToken,
      localCoordinatorEndpoint: "",
      localCoordinatorSecret: "coordinator-secret",
      allowRemotePrivateApi: false,
      getSession: unavailable,
      getSessionManager: () => lockSessionManager ?? unavailable(),
      createSessionForManager: async () => unavailable(),
      wsHub: { broadcast: vi.fn() } as unknown as WsHub,
      modelSetupController: {} as ModelSetupController,
      sessionActionsController: {} as SessionActionsController,
      toolInvokeController: {} as ToolInvokeController,
      quoteSnapshotStore: {} as QuoteSnapshotStore,
      indicesSnapshotStore: {} as MarketIndicesSnapshotStore,
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
    role = "writer";
  });

  it("serves the same payload the WS command serves", async () => {
    const response = await fetch(`${endpoint}/api/preferences`, { headers: trustedHeaders });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SNAPSHOT);
  });

  it("requires a trusted browser session", async () => {
    expect((await fetch(`${endpoint}/api/preferences`)).status).toBe(403);
    expect(
      (
        await fetch(`${endpoint}/api/preferences/delete`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ namespace: "global", key: "risk_profile" }),
        })
      ).status,
    ).toBe(403);
  });

  it("deletes a preference and a tool default over the fallback path", async () => {
    const preference = await fetch(`${endpoint}/api/preferences/delete`, {
      method: "POST",
      headers: { ...trustedHeaders, "content-type": "application/json" },
      body: JSON.stringify({ namespace: "global", key: "risk_profile" }),
    });
    expect(preference.status).toBe(200);
    expect(await preference.json()).toEqual({ ...SNAPSHOT, preferences: [] });
    expect(deleteStoredPreferenceMock).toHaveBeenCalledWith("global", "risk_profile");

    const toolDefault = await fetch(`${endpoint}/api/tool-defaults/delete`, {
      method: "POST",
      headers: { ...trustedHeaders, "content-type": "application/json" },
      body: JSON.stringify({ toolName: "get_stock_history", paramPath: "range" }),
    });
    expect(toolDefault.status).toBe(200);
    expect(await toolDefault.json()).toEqual({ ...SNAPSHOT, toolDefaults: [] });
  });

  it("refuses deletes while the session lock belongs to another live process", async () => {
    shouldBlockCoordinatorActionMock.mockReturnValue(true);

    const response = await fetch(`${endpoint}/api/preferences/delete`, {
      method: "POST",
      headers: { ...trustedHeaders, "content-type": "application/json" },
      body: JSON.stringify({ namespace: "global", key: "risk_profile" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "syncing" });
    expect(deleteStoredPreferenceMock).not.toHaveBeenCalled();
  });

  it("refuses deletes from a follower window", async () => {
    role = "follower";

    const response = await fetch(`${endpoint}/api/preferences/delete`, {
      method: "POST",
      headers: { ...trustedHeaders, "content-type": "application/json" },
      body: JSON.stringify({ namespace: "global", key: "risk_profile" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "syncing" });
    expect(deleteStoredPreferenceMock).not.toHaveBeenCalled();
  });
});

function createFakeClient(): WsClient & {
  messages: unknown[];
  messageHandlers: Array<(message: unknown) => void>;
  closeHandlers: Array<() => void>;
} {
  const messages: unknown[] = [];
  const messageHandlers: Array<(message: unknown) => void> = [];
  const closeHandlers: Array<() => void> = [];
  return {
    messages,
    messageHandlers,
    closeHandlers,
    send: (message) => messages.push(message),
    close: vi.fn(),
    onMessage: (handler) => messageHandlers.push(handler),
    onClose: (handler) => closeHandlers.push(handler),
  };
}
