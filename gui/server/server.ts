import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  ModelRuntime,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createOpenCandleSession } from "../../src/index.js";
import { assertSupportedNodeVersion } from "../../src/infra/node-version.js";
import { createAskUserBridge } from "./ask-user-bridge.js";
import {
  createLocalAutomationHeartbeat,
  normalizeAutomationHeartbeatMs,
} from "./automation-heartbeat.js";
import {
  type BackgroundQuotePoller,
  BackgroundQuoteRefreshes,
  createBackgroundQuotePoller,
} from "./background-quotes.js";
import { createInitialGuiSessionManager } from "./gui-session-manager.js";
import { createHttpRequestHandler, resolveSessionManagerById } from "./http-routes.js";
import { createToolInvokeController } from "./invoke-tool.js";
import { createLocalSessionCoordinator } from "./local-session-coordinator.js";
import { buildMarketIndicesSnapshot } from "./market-indices-api.js";
import { MarketIndicesSnapshotStore } from "./market-indices-snapshot-store.js";
import { buildMarketStateQuoteSnapshot } from "./market-state-api.js";
import { createModelSetupController } from "./model-setup.js";
import { isTrustedPrivateApiRequest } from "./private-api-access.js";
import { QuoteSnapshotStore } from "./quote-snapshot-store.js";
import { createSessionActionsController } from "./session-actions.js";
import { createGracefulShutdown } from "./shutdown.js";
import {
  acquireWriterLock,
  migrateWriterLockScope,
  refreshWriterLock,
  releaseWriterLock,
  writerLockScopeForSession,
} from "./writer-lock.js";
import { createWsHub, type WsHub } from "./ws-hub.js";

assertSupportedNodeVersion();

const cwd = process.cwd();
const host = process.env.OPENCANDLE_GUI_HOST ?? "127.0.0.1";
const port = Number(process.env.OPENCANDLE_GUI_PORT ?? 14567);
const automationHeartbeatMs = normalizeAutomationHeartbeatMs(
  process.env.OPENCANDLE_AUTOMATION_HEARTBEAT_MS,
);
const allowRemotePrivateApi = process.env.OPENCANDLE_GUI_ALLOW_REMOTE_PRIVATE_API === "1";
const privateApiSessionToken = randomBytes(32).toString("base64url");
const localCoordinatorSecret = randomBytes(32).toString("base64url");
const localCoordinatorEndpoint = `http://${coordinatorEndpointHost(host)}:${port}`;
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const webDist = resolveGuiWebDist(__dirname);

const agentDir = getAgentDir();
const modelRuntime = await ModelRuntime.create({
  authPath: resolve(agentDir, "auth.json"),
  modelsPath: resolve(agentDir, "models.json"),
});
const settingsManager = SettingsManager.create(cwd, agentDir);
const initialSessionManager = createInitialGuiSessionManager(cwd);
let sessionManager = initialSessionManager;
const sessionDir = sessionManager.getSessionDir();
const initialWriterLockScope = writerLockScopeForSession(sessionManager);
const lockResult = await acquireWriterLock(initialWriterLockScope, "gui", {
  coordinatorEndpoint: localCoordinatorEndpoint,
  coordinatorSecret: localCoordinatorSecret,
});
let activeWriterLockScope = initialWriterLockScope;
let currentWriterLockLost = false;
let wsHub: WsHub;
let quotePoller: BackgroundQuotePoller;
const askUserBridge = createAskUserBridge({
  broadcast: (message) => wsHub.broadcast(message),
  getSessionId: () => sessionManager.getSessionId(),
});
const runtime = await createAgentSessionRuntime(
  async (opts) => {
    const services = await createAgentSessionServices({
      cwd: opts.cwd,
      agentDir: opts.agentDir,
      settingsManager,
      modelRuntime,
    });
    const result = await createOpenCandleSession({
      cwd: opts.cwd,
      agentDir: opts.agentDir,
      modelRuntime,
      settingsManager,
      sessionManager: opts.sessionManager,
      askUserHandler: askUserBridge.ask,
    });
    return { ...result, services, diagnostics: services.diagnostics };
  },
  { cwd, agentDir, sessionManager },
);
let session = runtime.session;
function syncCurrentWriterLockScope(): void {
  if (currentWriterLockLost) throw new Error("OpenCandle is reconnecting to this session.");
  if (lockResult.role !== "writer") return;
  const nextScope = writerLockScopeForSession(sessionManager);
  if (nextScope === activeWriterLockScope) return;
  if (migrateWriterLockScope(activeWriterLockScope, nextScope)) {
    activeWriterLockScope = nextScope;
  } else {
    currentWriterLockLost = true;
    throw new Error("OpenCandle is reconnecting to this session.");
  }
}
const heartbeat = setInterval(() => {
  try {
    syncCurrentWriterLockScope();
    refreshWriterLock(activeWriterLockScope);
  } catch {
    clearInterval(heartbeat);
  }
}, 5000);
const backgroundQuoteRefreshes = new BackgroundQuoteRefreshes();
const localSessionCoordinator = createLocalSessionCoordinator();
const quoteSnapshotStore = new QuoteSnapshotStore(() => buildMarketStateQuoteSnapshot());
const indicesSnapshotStore = new MarketIndicesSnapshotStore(() => buildMarketIndicesSnapshot());
quotePoller = createBackgroundQuotePoller({
  getClientCount: () => wsHub.getClientCount(),
  getSessionManager: () => sessionManager,
  refreshes: backgroundQuoteRefreshes,
  broadcastState: () => wsHub.broadcastState(),
});
const localAutomationHeartbeat = createLocalAutomationHeartbeat({
  role: lockResult.role,
  getSessionId: () => sessionManager.getSessionId(),
  intervalMs: automationHeartbeatMs,
});
const modelSetupController = createModelSetupController({
  role: lockResult.role,
  getSession: () => session,
  getSessionManager: () => sessionManager,
  broadcastState: () => wsHub.broadcastState(),
});
const toolInvokeController = createToolInvokeController({
  role: lockResult.role,
  getSessionManager: () => sessionManager,
  broadcastState: () => wsHub.broadcastState(),
  broadcastSessionSnapshot: (targetSessionManager) =>
    wsHub.broadcastSessionSnapshot(targetSessionManager),
  broadcastSessions: () => wsHub.broadcastSessions(),
  onMarketStateChanged: () => quoteSnapshotStore.invalidate(),
  askUserHandler: askUserBridge.ask,
  askUserHandlerForSessionId: (sessionId) => askUserBridge.askForSession(sessionId),
  localCoordinatorEndpoint,
  localCoordinatorSecret,
  localSessionCoordinator,
  syncWriterLockScope: syncCurrentWriterLockScope,
  resolveSessionManager: (sessionId) =>
    resolveSessionManagerById(
      { cwd, sessionDir, getSessionManager: () => sessionManager },
      sessionId,
    ),
});
const sessionActionsController = createSessionActionsController({
  role: lockResult.role,
  cwd,
  sessionDir,
  getSession: () => session,
  getSessionManager: () => sessionManager,
  getModelSetupState: () => modelSetupController.buildCurrentModelSetupState(),
  askUserBridge,
  runtime,
  sendBoot: (client) => wsHub.sendBoot(client),
  broadcastState: () => wsHub.broadcastState(),
  broadcastSessions: () => wsHub.broadcastSessions(),
  localSessionCoordinator,
});
wsHub = createWsHub({
  role: lockResult.role,
  lock: lockResult.lock,
  cwd,
  sessionDir,
  getSession: () => session,
  getSessionManager: () => sessionManager,
  backgroundQuoteRefreshes,
  askUserBridge,
  modelSetupController,
  toolInvokeController,
  sessionActionsController,
  onClientCountChanged: () => quotePoller.updatePoller(),
  isTrustedRequest: (req) =>
    isTrustedPrivateApiRequest(req.headers, privateApiSessionToken, req.socket.remoteAddress, {
      allowRemote: allowRemotePrivateApi,
    }),
});

let unsubscribeSession = wsHub.subscribeToSessionEvents();
runtime.setRebindSession(async (nextSession) => {
  const nextWriterLockScope = writerLockScopeForSession(nextSession.sessionManager);
  if (lockResult.role === "writer" && nextWriterLockScope !== activeWriterLockScope) {
    const nextLockResult = await acquireWriterLock(nextWriterLockScope, "gui", {
      coordinatorEndpoint: localCoordinatorEndpoint,
      coordinatorSecret: localCoordinatorSecret,
    });
    if (nextLockResult.role !== "writer") {
      throw new Error("OpenCandle is reconnecting to this session.");
    }
    releaseWriterLock(activeWriterLockScope);
    activeWriterLockScope = nextWriterLockScope;
  }
  unsubscribeSession();
  session = nextSession;
  sessionManager = nextSession.sessionManager;
  unsubscribeSession = wsHub.subscribeToSessionEvents();
});

const httpRequestHandler = createHttpRequestHandler({
  host,
  port,
  webDist,
  role: lockResult.role,
  cwd,
  agentDir,
  sessionDir,
  privateApiSessionToken,
  localCoordinatorEndpoint,
  localCoordinatorSecret,
  allowRemotePrivateApi,
  syncCurrentWriterLockScope,
  getSession: () => session,
  getSessionManager: () => sessionManager,
  createSessionForManager: async (targetSessionManager) =>
    createOpenCandleSession({
      cwd,
      agentDir,
      modelRuntime,
      settingsManager,
      sessionManager: targetSessionManager,
      askUserHandler: askUserBridge.askForSession(targetSessionManager.getSessionId()),
    }),
  wsHub,
  modelSetupController,
  sessionActionsController,
  toolInvokeController,
  quoteSnapshotStore,
  indicesSnapshotStore,
  localSessionCoordinator,
});

const server = createServer((req, res) => {
  void httpRequestHandler(req, res);
});

server.on("upgrade", (req, socket) => wsHub.handleUpgrade(req, socket));

server.listen(port, host, () => {
  console.log(`OpenCandle GUI listening on http://${host}:${port}`);
  if (host === "0.0.0.0") {
    console.log(`OpenCandle GUI is accepting LAN/Tailscale connections on port ${port}`);
  }
  if (allowRemotePrivateApi) {
    console.log(
      "OpenCandle GUI private market-state API accepts cookie-authenticated remote requests.",
    );
  }
  console.log(`Writer role: ${lockResult.role}`);
  localAutomationHeartbeat.start();
});

const shutdown = createGracefulShutdown({
  server,
  cleanup: async () => {
    clearInterval(heartbeat);
    quotePoller.stop();
    localAutomationHeartbeat.stop();
    wsHub.closeClients();
    unsubscribeSession();
    releaseWriterLock(activeWriterLockScope);
    await runtime.dispose();
  },
  exit: (code) => process.exit(code),
});

function coordinatorEndpointHost(bindHost: string): string {
  if (bindHost === "0.0.0.0") return "127.0.0.1";
  if (bindHost === "::") return "[::1]";
  return bindHost.includes(":") && !bindHost.startsWith("[") ? `[${bindHost}]` : bindHost;
}

function resolveGuiWebDist(serverDir: string): string {
  const candidates = [
    resolve(serverDir, "../web/dist"),
    resolve(serverDir, "../../../gui/web/dist"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
