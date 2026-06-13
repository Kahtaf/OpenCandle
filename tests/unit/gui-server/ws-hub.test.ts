import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundQuoteRefreshes } from "../../../gui/server/background-quotes.js";
import type { ToolInvokeController } from "../../../gui/server/invoke-tool.js";
import type { ModelSetupController } from "../../../gui/server/model-setup.js";
import type { SessionActionsController } from "../../../gui/server/session-actions.js";
import type { WsClient } from "../../../gui/server/websocket.js";
import { createWsHub } from "../../../gui/server/ws-hub.js";

describe("GUI WS hub", () => {
  let cwd: string;
  let sessionDir: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "opencandle-ws-hub-cwd-"));
    sessionDir = mkdtempSync(join(tmpdir(), "opencandle-ws-hub-sessions-"));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
    await rm(sessionDir, { recursive: true, force: true });
  });

  it("tracks clients, sends boot payloads, and updates client count on close", async () => {
    const client = createFakeClient();
    const onClientCountChanged = vi.fn();
    const hub = createWsHub({
      ...baseHubOptions(),
      onClientCountChanged,
      acceptWebSocketFn: () => client,
    });

    hub.handleUpgrade({ url: "/ws" } as IncomingMessage, { destroy: vi.fn() } as unknown as Duplex);

    expect(hub.getClientCount()).toBe(1);
    expect(onClientCountChanged).toHaveBeenCalledTimes(1);
    expect(client.messages[0]).toMatchObject({
      type: "boot",
      role: "writer",
      sessionId: "session-1",
      modelSetup: { requirement: "ready" },
    });
    expect(client.messages[1]).toMatchObject({
      type: "state.snapshot",
      sessionId: "session-1",
      entries: [],
    });
    await vi.waitFor(() =>
      expect(client.messages.some((message) => asRecord(message).type === "sessions")).toBe(true),
    );

    client.closeHandlers[0]?.();

    expect(hub.getClientCount()).toBe(0);
    expect(onClientCountChanged).toHaveBeenCalledTimes(2);
  });

  it("rejects untrusted websocket upgrades before accepting the client", () => {
    const acceptWebSocketFn = vi.fn(() => createFakeClient());
    const socket = { destroy: vi.fn() } as unknown as Duplex;
    const hub = createWsHub({
      ...baseHubOptions(),
      isTrustedRequest: () => false,
      acceptWebSocketFn,
    });

    hub.handleUpgrade({ url: "/ws" } as IncomingMessage, socket);

    expect(acceptWebSocketFn).not.toHaveBeenCalled();
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(hub.getClientCount()).toBe(0);
  });

  it("sends dispatch errors back to the client", async () => {
    const client = createFakeClient();
    const hub = createWsHub({
      ...baseHubOptions(),
      role: "follower",
      acceptWebSocketFn: () => client,
    });

    hub.handleUpgrade({ url: "/ws" } as IncomingMessage, { destroy: vi.fn() } as unknown as Duplex);
    client.messageHandlers[0]?.({ type: "tool.enabled", toolName: "get_stock_quote" });

    await vi.waitFor(() =>
      expect(client.messages).toContainEqual({
        type: "error",
        message: "Read-only follower mode",
      }),
    );
  });

  function baseHubOptions() {
    return {
      role: "writer",
      lock: { role: "writer" },
      cwd,
      sessionDir,
      getSession: () =>
        ({
          modelRegistry: { refresh: vi.fn() },
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
    };
  }
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

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
