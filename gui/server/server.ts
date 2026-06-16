import { randomBytes } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthStorage,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createOpenCandleSession } from "../../src/index.js";
import { probeProviderStatus } from "../../src/onboarding/provider-status.js";
import type { ChatEvent } from "../shared/chat-events.js";
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
import { sessionEntriesToChatEvents } from "./chat-event-adapter.js";
import { chatRunSessionConflict } from "./chat-run-session.js";
import { createInitialGuiSessionManager } from "./gui-session-manager.js";
import { createToolInvokeController } from "./invoke-tool.js";
import { createLiveChatEventAdapter } from "./live-chat-event-adapter.js";
import {
  buildMarketStateQuoteSnapshot,
  buildMarketStateSnapshot,
  searchInstrumentCandidates,
} from "./market-state-api.js";
import { buildModelSetupState, createModelSetupController } from "./model-setup.js";
import { isTrustedPrivateApiRequest, privateApiCookieHeader } from "./private-api-access.js";
import { createPromptObservation, observePromptEvent } from "./prompt-observation.js";
import { QuoteSnapshotStore } from "./quote-snapshot-store.js";
import { createSessionActionsController, promptAndSettle } from "./session-actions.js";
import { waitForNewEntryId } from "./session-entry-wait.js";
import { createGracefulShutdown } from "./shutdown.js";
import { acquireWriterLock, refreshWriterLock, releaseWriterLock } from "./writer-lock.js";
import { createWsHub, type WsHub } from "./ws-hub.js";

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

const server = createServer((req, res) => {
  void handleHttpRequest(req, res);
});

async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${host}:${port}`);
  if (url.pathname === "/health") {
    writeJson(res, { ok: true, role: lockResult.role });
    return;
  }

  if (url.pathname === "/api/bootstrap" && req.method === "GET") {
    if (!allowTrustedGuiRequest(req, res, "Bootstrap API")) return;
    writeJson(res, await wsHub.buildBootstrapPayload());
    return;
  }

  if (url.pathname === "/api/session/new" && req.method === "POST") {
    if (!allowTrustedGuiRequest(req, res, "Session API")) return;
    if (lockResult.role !== "writer") {
      writeJson(res, { error: "Read-only follower mode" }, 409);
      return;
    }
    await sessionActionsController.handleNewSession();
    wsHub.broadcastState();
    wsHub.broadcastSessions();
    writeJson(res, await wsHub.buildBootstrapPayload());
    return;
  }

  if (url.pathname === "/api/sessions" && req.method === "GET") {
    if (!allowTrustedGuiRequest(req, res, "Session API")) return;
    writeJson(res, {
      currentSessionId: sessionManager.getSessionId(),
      role: lockResult.role,
      sessions: await SessionManager.list(cwd, sessionDir),
    });
    return;
  }

  if (url.pathname === "/api/session/events" && req.method === "GET") {
    if (!allowTrustedGuiRequest(req, res, "Session API")) return;
    writeJson(res, {
      sessionId: sessionManager.getSessionId(),
      role: lockResult.role,
      events: wsHub.currentChatEvents(),
    });
    return;
  }

  if (url.pathname === "/api/market-state" && req.method === "GET") {
    if (!allowTrustedGuiRequest(req, res, "Market-state API")) return;
    writeJson(res, buildMarketStateSnapshot());
    return;
  }

  if (url.pathname === "/api/market-state/quotes" && req.method === "GET") {
    if (!allowTrustedGuiRequest(req, res, "Market-state API")) return;
    writeJson(res, await quoteSnapshotStore.get());
    return;
  }

  if (url.pathname === "/api/instruments/search" && req.method === "GET") {
    if (!allowTrustedGuiRequest(req, res, "Market-state API")) return;
    writeJson(res, await searchInstrumentCandidates(url.searchParams.get("q") ?? ""));
    return;
  }

  if (url.pathname === "/api/diagnostics/twitter-cli" && req.method === "GET") {
    if (!allowTrustedGuiRequest(req, res, "Diagnostics API")) return;
    const mode = url.searchParams.get("mode") === "session" ? "session" : "install";
    const force = url.searchParams.get("force") === "1";
    writeJson(res, await probeProviderStatus("twitter", { mode, force }));
    return;
  }

  if (url.pathname === "/api/chat/run" && req.method === "POST") {
    if (!allowTrustedGuiRequest(req, res, "Chat run API")) return;
    await handleSseChatRun(req, res);
    return;
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const path = resolve(join(webDist, requested));
  if (!path.startsWith(webDist) || !existsSync(path)) {
    const fallback = resolve(join(webDist, "index.html"));
    if (!extname(requested) && fallback.startsWith(webDist) && existsSync(fallback)) {
      res.writeHead(200, privateGuiHeaders("text/html; charset=utf-8"));
      createReadStream(fallback).pipe(res);
      return;
    }
    res.writeHead(404).end("Not found");
    return;
  }

  const type = contentType(path);
  res.writeHead(200, privateGuiHeaders(type));
  createReadStream(path).pipe(res);
}

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

async function handleSseChatRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (lockResult.role !== "writer") {
    writeJson(res, { error: "Read-only follower mode" }, 409);
    return;
  }

  const body = await readJsonBody(req);
  const prompt = String(asRecord(body).prompt ?? "").trim();
  if (!prompt) {
    writeJson(res, { error: "prompt is required" }, 400);
    return;
  }

  const sessionConflict = chatRunSessionConflict(
    asRecord(body).sessionId,
    sessionManager.getSessionId(),
  );
  if (sessionConflict) {
    writeJson(res, sessionConflict, 409);
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  let seq = 1;
  const runId = `gui-run-${Date.now()}`;
  const runSession = session;
  const runSessionManager = sessionManager;
  const sessionId = runSessionManager.getSessionId();
  // Name new sessions by the user's words before any workflow transform
  // replaces the turn text, so the sidebar shows what the user actually asked.
  if (!prompt.startsWith("/") && !runSessionManager.getSessionName()) {
    runSessionManager.appendSessionInfo(prompt.length > 80 ? `${prompt.slice(0, 77)}...` : prompt);
  }
  const beforeEntries = runSessionManager.getEntries();
  const beforeCount = beforeEntries.length;
  const beforeIds = new Set(beforeEntries.map((entry) => entry.id));
  writeSse(res, { type: "run.started", runId, sessionId, seq: seq++ });
  res.flushHeaders?.();
  const liveStartSeq = seq;
  const liveAdapter = createLiveChatEventAdapter({
    runId,
    sessionId,
    startSeq: seq,
    emit: (event) => writeSse(res, event),
    originalPrompt: prompt,
  });
  const observation = createPromptObservation();
  const unsubscribeLive = runSession.subscribe((event) => {
    liveAdapter.handle(event);
    observePromptEvent(observation, event);
  });

  try {
    const modelSetup = buildModelSetupState(runSession.modelRegistry, runSession.model);
    if (!prompt.startsWith("/") && modelSetup.requirement !== "ready") {
      runSessionManager.appendMessage({ role: "user", content: prompt, timestamp: Date.now() });
      const message =
        modelSetup.requirement === "select_model"
          ? "Choose an available model before chat can run. OpenCandle found configured credentials but no active model."
          : "Connect an AI model before chat can run. Paste a Google Gemini, OpenAI, or Anthropic API key in the setup panel.";
      runSessionManager.appendCustomMessageEntry("opencandle-model-setup", message, true, {
        source: "gui",
        requirement: modelSetup.requirement,
      });
      wsHub.broadcastState();
    } else {
      await promptAndSettle(runSession, prompt, beforeIds, observation);
      wsHub.broadcastState();
    }
    seq = liveAdapter.nextSeq();
    if (seq === liveStartSeq) {
      await waitForNewEntryId(
        () => runSessionManager.getEntries().map((entry) => entry.id),
        beforeIds,
      );
      const newEntries = runSessionManager
        .getEntries()
        .slice(beforeCount)
        .filter((entry) => !beforeIds.has(entry.id));
      const events = sessionEntriesToChatEvents(newEntries, {
        sessionId,
        updatedAt: new Date().toISOString(),
        startSeq: seq,
      });
      for (const event of events) {
        writeSse(res, event);
        seq = event.seq + 1;
      }
    }
    writeSse(res, { type: "run.completed", runId, seq });
  } catch (error) {
    seq = liveAdapter.nextSeq();
    const message = error instanceof Error ? error.message : String(error);
    writeSse(res, { type: "run.failed", runId, error: { message }, seq });
  } finally {
    unsubscribeLive();
    res.end();
  }
}

function writeJson(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function allowTrustedGuiRequest(req: IncomingMessage, res: ServerResponse, label: string): boolean {
  if (
    isTrustedPrivateApiRequest(req.headers, privateApiSessionToken, req.socket.remoteAddress, {
      allowRemote: allowRemotePrivateApi,
    })
  )
    return true;
  res.writeHead(403, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      error: `${label} is only available to trusted GUI browser sessions.`,
    }),
  );
  return false;
}

function privateGuiHeaders(contentTypeValue: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": contentTypeValue };
  if (contentTypeValue.startsWith("text/html")) {
    headers["set-cookie"] = privateApiCookieHeader(privateApiSessionToken);
  }
  return headers;
}

function writeSse(res: ServerResponse, event: ChatEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function contentType(path: string): string {
  switch (extname(path)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
