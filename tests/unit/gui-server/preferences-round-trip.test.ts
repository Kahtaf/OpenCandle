import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { buildMemoryContext } from "../../../src/memory/retrieval.js";
import { initDefaultDatabase } from "../../../src/memory/sqlite.js";
import { MemoryStorage } from "../../../src/memory/storage.js";
import { setDefault } from "../../../src/memory/tool-defaults.js";

// A real store behind the real local commands: seed, list, delete, and prove the
// deletion reaches the prompt-context reader the agent actually uses.
describe("local preferences round trip", () => {
  let home: string;
  let previousHome: string | undefined;
  let cwd: string;
  let sessionDir: string;
  let server: Server | undefined;

  beforeEach(() => {
    previousHome = process.env.OPENCANDLE_HOME;
    home = mkdtempSync(join(tmpdir(), "opencandle-preferences-home-"));
    process.env.OPENCANDLE_HOME = home;
    cwd = mkdtempSync(join(tmpdir(), "opencandle-preferences-cwd-"));
    sessionDir = mkdtempSync(join(tmpdir(), "opencandle-preferences-sessions-"));

    const db = initDefaultDatabase();
    try {
      new MemoryStorage(db).upsertPreference({
        namespace: "global",
        key: "risk_profile",
        valueJson: JSON.stringify("balanced"),
        confidence: "high",
        source: "explicit",
      });
      setDefault("get_stock_history", "range", "6mo", db);
    } finally {
      db.close();
    }
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error) => (error ? reject(error) : resolve()));
      });
      server = undefined;
    }
    if (previousHome === undefined) delete process.env.OPENCANDLE_HOME;
    else process.env.OPENCANDLE_HOME = previousHome;
    await Promise.all([
      rm(home, { recursive: true, force: true }),
      rm(cwd, { recursive: true, force: true }),
      rm(sessionDir, { recursive: true, force: true }),
    ]);
  });

  it("lists the seeded rows, deletes them, and drops the preference from prompt context", async () => {
    const client = connect();

    client.messageHandlers[0]?.({ type: "preferences.list" });
    await vi.waitFor(() => expect(latestPreferences(client)).toBeTruthy());
    expect(latestPreferences(client)).toMatchObject({
      preferences: [{ namespace: "global", key: "risk_profile", value: "balanced" }],
      toolDefaults: [{ toolName: "get_stock_history", paramPath: "range", value: "6mo" }],
    });

    client.messageHandlers[0]?.({
      type: "preferences.delete",
      namespace: "global",
      key: "risk_profile",
    });
    await vi.waitFor(() => expect(latestPreferences(client)?.preferences).toEqual([]));

    client.messageHandlers[0]?.({
      type: "tool_defaults.delete",
      toolName: "get_stock_history",
      paramPath: "range",
    });
    await vi.waitFor(() => expect(latestPreferences(client)?.toolDefaults).toEqual([]));

    const db = initDefaultDatabase();
    try {
      const storage = new MemoryStorage(db);
      expect(storage.listAllPreferences()).toEqual([]);
      expect(buildMemoryContext(storage)).not.toContain("risk_profile");
      expect(storage.getWorkflowPreferences().riskProfile).toBeUndefined();
    } finally {
      db.close();
    }
  });

  it("serves the same live payload over the HTTP fallback route", async () => {
    const privateApiSessionToken = "preferences-round-trip-token";
    const endpoint = await startHttpServer(privateApiSessionToken);

    const response = await fetch(`${endpoint}/api/preferences`, {
      headers: { cookie: privateApiCookieHeader(privateApiSessionToken) },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      preferences: [{ key: "risk_profile", value: "balanced" }],
      toolDefaults: [{ toolName: "get_stock_history", paramPath: "range" }],
    });
  });

  async function startHttpServer(privateApiSessionToken: string): Promise<string> {
    const unavailable = () => {
      throw new Error("not used by preferences round-trip tests");
    };
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
      getSession: unavailable,
      getSessionManager: unavailable,
      createSessionForManager: async () => unavailable(),
      wsHub: { broadcast: vi.fn() } as unknown as WsHub,
      modelSetupController: {} as ModelSetupController,
      sessionActionsController: {} as SessionActionsController,
      toolInvokeController: {} as ToolInvokeController,
      quoteSnapshotStore: {} as QuoteSnapshotStore,
      indicesSnapshotStore: {} as MarketIndicesSnapshotStore,
    });
    const started = createServer((req, res) => {
      void handler(req, res);
    });
    server = started;
    await new Promise<void>((resolve, reject) => {
      started.once("error", reject);
      started.listen(0, "127.0.0.1", () => resolve());
    });
    return `http://127.0.0.1:${(started.address() as AddressInfo).port}`;
  }

  function connect() {
    const client = createFakeClient();
    const hub = createWsHub({
      role: "writer",
      lock: { role: "writer" },
      cwd,
      sessionDir,
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
          // The delete guard resolves the real writer-lock scope; an
          // unlocked path means no live lock and the delete proceeds.
          getSessionFile: () => join(sessionDir, "session-1.jsonl"),
          getSessionDir: () => sessionDir,
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
    return client;
  }
});

function latestPreferences(client: { messages: unknown[] }) {
  return client.messages.findLast(
    (message) => (message as { type?: string }).type === "preferences",
  ) as { preferences?: unknown[]; toolDefaults?: unknown[] } | undefined;
}

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
