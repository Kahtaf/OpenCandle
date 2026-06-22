import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthStorage,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  ModelRegistry,
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
import { createHttpRequestHandler } from "./http-routes.js";
import { createToolInvokeController } from "./invoke-tool.js";
import { buildMarketStateQuoteSnapshot } from "./market-state-api.js";
import { createModelSetupController } from "./model-setup.js";
import { isTrustedPrivateApiRequest } from "./private-api-access.js";
import { QuoteSnapshotStore } from "./quote-snapshot-store.js";
import { createSessionActionsController } from "./session-actions.js";
import { createGracefulShutdown } from "./shutdown.js";
import { acquireWriterLock, refreshWriterLock, releaseWriterLock } from "./writer-lock.js";
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
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const webDist = resolve(__dirname, "../web/dist");

const agentDir = getAgentDir();
const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const settingsManager = SettingsManager.create(cwd, agentDir);
const initialSessionManager = createInitialGuiSessionManager(cwd);
let sessionManager = initialSessionManager;
const sessionDir = sessionManager.getSessionDir();
const lockResult = await acquireWriterLock(sessionDir, "gui");
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
      authStorage,
      settingsManager,
      modelRegistry,
    });
    const result = await createOpenCandleSession({
      cwd: opts.cwd,
      agentDir: opts.agentDir,
      authStorage,
      modelRegistry,
      settingsManager,
      sessionManager: opts.sessionManager,
      askUserHandler: askUserBridge.ask,
    });
    return { ...result, services, diagnostics: services.diagnostics };
  },
  { cwd, agentDir, sessionManager },
);
let session = runtime.session;
const heartbeat = setInterval(() => refreshWriterLock(sessionDir), 5000);
const backgroundQuoteRefreshes = new BackgroundQuoteRefreshes();
const quoteSnapshotStore = new QuoteSnapshotStore(() => buildMarketStateQuoteSnapshot());
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
  onMarketStateChanged: () => quoteSnapshotStore.invalidate(),
  askUserHandler: askUserBridge.ask,
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
  allowRemotePrivateApi,
  getSession: () => session,
  getSessionManager: () => sessionManager,
  wsHub,
  modelSetupController,
  sessionActionsController,
  quoteSnapshotStore,
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
    releaseWriterLock(sessionDir);
    await runtime.dispose();
  },
  exit: (code) => process.exit(code),
});

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
