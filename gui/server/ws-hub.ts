import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import {
  type AgentSession,
  type SessionEntry,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { ChatEvent } from "../shared/chat-events.js";
import { getProvider, type ProviderId } from "../../src/onboarding/providers.js";
import { probeProviderStatus } from "../../src/onboarding/provider-status.js";
import type { BackgroundQuoteRefreshes } from "./background-quotes.js";
import { sessionEntriesToChatEvents } from "./chat-event-adapter.js";
import type { ToolInvokeController } from "./invoke-tool.js";
import type { ModelSetupController } from "./model-setup.js";
import { projectDashboard } from "./projector.js";
import type { SessionActionsController } from "./session-actions.js";
import { buildCatalog, setToolEnabled } from "./tool-metadata.js";
import { acceptWebSocket, type WsClient } from "./websocket.js";

interface AskUserBridge {
  getPrompts(): unknown[];
}

export interface WsHub {
  handleUpgrade(req: IncomingMessage, socket: Duplex): void;
  getClientCount(): number;
  closeClients(): void;
  sendBoot(client: WsClient): void;
  buildBootstrapPayload(): Promise<Record<string, unknown>>;
  broadcast(message: unknown): void;
  broadcastModelSetup(): void;
  broadcastState(): void;
  broadcastSessions(): void;
  buildStateSnapshot(): {
    sessionId: string;
    state: unknown;
    entries: SessionEntry[];
    events: ChatEvent[];
  };
  currentChatEvents(entries?: SessionEntry[]): ChatEvent[];
  subscribeToSessionEvents(): () => void;
}

export interface WsHubOptions {
  role: string;
  lock: unknown;
  cwd: string;
  sessionDir: string;
  getSession: () => AgentSession;
  getSessionManager: () => SessionManager;
  backgroundQuoteRefreshes: BackgroundQuoteRefreshes;
  askUserBridge: AskUserBridge;
  modelSetupController: ModelSetupController;
  toolInvokeController: ToolInvokeController;
  sessionActionsController: SessionActionsController;
  onClientCountChanged: () => void;
  isTrustedRequest?: (req: IncomingMessage) => boolean;
  acceptWebSocketFn?: typeof acceptWebSocket;
}

export function createWsHub({
  role,
  lock,
  cwd,
  sessionDir,
  getSession,
  getSessionManager,
  backgroundQuoteRefreshes,
  askUserBridge,
  modelSetupController,
  toolInvokeController,
  sessionActionsController,
  onClientCountChanged,
  isTrustedRequest = () => true,
  acceptWebSocketFn = acceptWebSocket,
}: WsHubOptions): WsHub {
  const clients = new Set<WsClient>();

  function handleUpgrade(req: IncomingMessage, socket: Duplex): void {
    if (req.url !== "/ws") {
      socket.destroy();
      return;
    }
    if (!isTrustedRequest(req)) {
      socket.destroy();
      return;
    }

    const client = acceptWebSocketFn(req, socket);
    clients.add(client);
    client.onClose(() => {
      clients.delete(client);
      onClientCountChanged();
    });
    client.onMessage((message) => void handleClientMessage(client, message));
    sendBoot(client);
    onClientCountChanged();
  }

  async function handleClientMessage(client: WsClient, message: unknown): Promise<void> {
    const data = asRecord(message);
    try {
      switch (data.type) {
        case "chat.prompt":
          await sessionActionsController.handlePrompt(String(data.prompt ?? ""));
          break;
        case "ask_user.answer":
          await sessionActionsController.handleAskUserAnswer(String(data.id ?? ""), data.answer);
          break;
        case "ask_user.cancel":
          await sessionActionsController.handleAskUserCancel(String(data.id ?? ""));
          break;
        case "tool.invoke":
          await toolInvokeController.handleToolInvokeMessage(client, data);
          break;
        case "tool.enabled":
          if (role !== "writer") throw new Error("Read-only follower mode");
          setToolEnabled(String(data.toolName), Boolean(data.enabled));
          broadcast({ type: "catalog", catalog: buildCatalog(), restartRequired: true });
          break;
        case "catalog.refresh":
          client.send({ type: "catalog", catalog: buildCatalog() });
          break;
        case "model.setup.refresh":
          getSession().modelRegistry.refresh();
          broadcastModelSetup();
          break;
        case "model.setup.save_api_key":
          await modelSetupController.handleSaveModelApiKey(
            String(data.provider ?? ""),
            String(data.apiKey ?? ""),
          );
          broadcastModelSetup();
          break;
        case "model.setup.select_model":
          await modelSetupController.handleSelectModel(
            String(data.provider ?? ""),
            String(data.modelId ?? ""),
          );
          broadcastModelSetup();
          break;
        case "provider.save_api_key":
          await modelSetupController.handleSaveProviderApiKey(
            String(data.providerId ?? ""),
            String(data.apiKey ?? ""),
          );
          broadcast({ type: "catalog", catalog: buildCatalog() });
          break;
        case "provider.status.check": {
          const providerId = String(data.providerId ?? "") as ProviderId;
          getProvider(providerId);
          const mode = data.mode === "session" ? "session" : "install";
          const status = await probeProviderStatus(providerId, { mode, force: true });
          client.send({ type: "provider.status", providerId, status });
          break;
        }
        case "session.new":
          await sessionActionsController.handleNewSession();
          sendBoot(client);
          broadcastState();
          broadcastSessions();
          break;
        case "session.open":
          await sessionActionsController.handleOpenSession(String(data.path ?? ""));
          sendBoot(client);
          broadcastState();
          broadcastSessions();
          break;
        case "session.rename":
          await sessionActionsController.handleRenameSession(
            String(data.path ?? ""),
            String(data.name ?? ""),
          );
          broadcastState();
          broadcastSessions();
          break;
        case "session.delete":
          await sessionActionsController.handleDeleteSession(client, String(data.path ?? ""));
          break;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      client.send({
        type: "error",
        message: errorMessage,
      });
    }
  }

  function getClientCount(): number {
    return clients.size;
  }

  function closeClients(): void {
    for (const client of clients) client.close();
    clients.clear();
  }

  function sendBoot(client: WsClient): void {
    const snapshot = buildStateSnapshot();
    client.send({
      type: "boot",
      role,
      lock,
      sessionId: getSessionManager().getSessionId(),
      catalog: buildCatalog(),
      modelSetup: modelSetupController.buildCurrentModelSetupState(),
      askUserPrompts: askUserBridge.getPrompts(),
    });
    client.send({
      type: "state.snapshot",
      ...snapshot,
    });
    void SessionManager.list(cwd, sessionDir).then((sessions) =>
      client.send({ type: "sessions", sessions }),
    );
  }

  async function buildBootstrapPayload(): Promise<Record<string, unknown>> {
    return {
      role,
      sessionId: getSessionManager().getSessionId(),
      catalog: buildCatalog(),
      modelSetup: modelSetupController.buildCurrentModelSetupState(),
      askUserPrompts: askUserBridge.getPrompts(),
      sessions: await SessionManager.list(cwd, sessionDir),
      snapshot: buildStateSnapshot(),
    };
  }

  function broadcastModelSetup(): void {
    broadcast({
      type: "model.setup",
      modelSetup: modelSetupController.buildCurrentModelSetupState(),
    });
  }

  function broadcastState(): void {
    broadcast({
      type: "state.snapshot",
      ...buildStateSnapshot(),
    });
  }

  function buildStateSnapshot() {
    const sessionManager = getSessionManager();
    const sessionId = sessionManager.getSessionId();
    const entries = sessionManager.getEntries();
    return {
      sessionId,
      state: projectDashboard(backgroundQuoteRefreshes.withEntries(entries), sessionId),
      entries,
      events: currentChatEvents(entries),
    };
  }

  function currentChatEvents(entries = getSessionManager().getEntries()): ChatEvent[] {
    const sessionManager = getSessionManager();
    return sessionEntriesToChatEvents(entries, {
      sessionId: sessionManager.getSessionId(),
      title: sessionManager.getSessionName(),
    });
  }

  function broadcastSessions(): void {
    void SessionManager.list(cwd, sessionDir).then((sessions) =>
      broadcast({ type: "sessions", sessions }),
    );
  }

  function broadcast(message: unknown): void {
    for (const client of clients) client.send(message);
  }

  function subscribeToSessionEvents(): () => void {
    return getSession().subscribe((event) => {
      broadcast({ type: "session.event", event });
      broadcastState();
    });
  }

  return {
    handleUpgrade,
    getClientCount,
    closeClients,
    sendBoot,
    buildBootstrapPayload,
    broadcast,
    broadcastModelSetup,
    broadcastState,
    broadcastSessions,
    buildStateSnapshot,
    currentChatEvents,
    subscribeToSessionEvents,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
