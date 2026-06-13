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
import type { ChatEvent } from "../shared/chat-events.js";
import { createAskUserBridge } from "./ask-user-bridge.js";
import {
  createLocalAutomationHeartbeat,
  normalizeAutomationHeartbeatMs,
} from "./automation-heartbeat.js";
import { BackgroundQuoteRefreshes, createBackgroundQuotePoller } from "./background-quotes.js";
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
import { projectDashboard } from "./projector.js";
import { createPromptObservation, observePromptEvent } from "./prompt-observation.js";
import { QuoteSnapshotStore } from "./quote-snapshot-store.js";
import { createSessionActionsController, promptAndSettle } from "./session-actions.js";
import { waitForNewEntryId } from "./session-entry-wait.js";
import { createGracefulShutdown } from "./shutdown.js";
import { buildCatalog, setToolEnabled } from "./tool-metadata.js";
import { acceptWebSocket, type WsClient } from "./websocket.js";
import { acquireWriterLock, refreshWriterLock, releaseWriterLock } from "./writer-lock.js";

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
const askUserBridge = createAskUserBridge({
  broadcast,
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
const clients = new Set<WsClient>();
const heartbeat = setInterval(() => refreshWriterLock(sessionDir), 5000);
const backgroundQuoteRefreshes = new BackgroundQuoteRefreshes();
const quoteSnapshotStore = new QuoteSnapshotStore(() => buildMarketStateQuoteSnapshot());
const quotePoller = createBackgroundQuotePoller({
  getClientCount: () => clients.size,
  getSessionManager: () => sessionManager,
  refreshes: backgroundQuoteRefreshes,
  broadcastState,
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
  broadcastState,
});
const toolInvokeController = createToolInvokeController({
  role: lockResult.role,
  getSessionManager: () => sessionManager,
  broadcastState,
});
const sessionActionsController = createSessionActionsController({
  role: lockResult.role,
  cwd,
  sessionDir,
  getSession: () => session,
  getSessionManager: () => sessionManager,
  getModelSetupState: () => buildCurrentModelSetupState(),
  askUserBridge,
  runtime,
  sendBoot,
  broadcastState,
  broadcastSessions,
});

let unsubscribeSession = subscribeToSessionEvents();
runtime.setRebindSession(async (nextSession) => {
  unsubscribeSession();
  session = nextSession;
  sessionManager = nextSession.sessionManager;
  unsubscribeSession = subscribeToSessionEvents();
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
    writeJson(res, await buildBootstrapPayload());
    return;
  }

  if (url.pathname === "/api/session/new" && req.method === "POST") {
    if (lockResult.role !== "writer") {
      writeJson(res, { error: "Read-only follower mode" }, 409);
      return;
    }
    await sessionActionsController.handleNewSession();
    broadcastState();
    broadcastSessions();
    writeJson(res, await buildBootstrapPayload());
    return;
  }

  if (url.pathname === "/api/sessions" && req.method === "GET") {
    writeJson(res, {
      currentSessionId: sessionManager.getSessionId(),
      role: lockResult.role,
      sessions: await SessionManager.list(cwd, sessionDir),
    });
    return;
  }

  if (url.pathname === "/api/session/events" && req.method === "GET") {
    writeJson(res, {
      sessionId: sessionManager.getSessionId(),
      role: lockResult.role,
      events: currentChatEvents(),
    });
    return;
  }

  if (url.pathname === "/api/market-state" && req.method === "GET") {
    if (!allowPrivateMarketStateApi(req, res)) return;
    writeJson(res, buildMarketStateSnapshot());
    return;
  }

  if (url.pathname === "/api/market-state/quotes" && req.method === "GET") {
    if (!allowPrivateMarketStateApi(req, res)) return;
    writeJson(res, await quoteSnapshotStore.get());
    return;
  }

  if (url.pathname === "/api/instruments/search" && req.method === "GET") {
    if (!allowPrivateMarketStateApi(req, res)) return;
    writeJson(res, await searchInstrumentCandidates(url.searchParams.get("q") ?? ""));
    return;
  }

  if (url.pathname === "/api/chat/run" && req.method === "POST") {
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

server.on("upgrade", (req, socket) => {
  if (req.url !== "/ws") {
    socket.destroy();
    return;
  }

  const client = acceptWebSocket(req, socket);
  clients.add(client);
  client.onClose(() => {
    clients.delete(client);
    quotePoller.updatePoller();
  });
  client.onMessage((message) => void handleClientMessage(client, message));
  sendBoot(client);
  quotePoller.updatePoller();
});

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
    for (const client of clients) client.close();
    clients.clear();
    unsubscribeSession();
    releaseWriterLock(sessionDir);
    await runtime.dispose();
  },
  exit: (code) => process.exit(code),
});

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

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
        if (lockResult.role !== "writer") throw new Error("Read-only follower mode");
        setToolEnabled(String(data.toolName), Boolean(data.enabled));
        broadcast({ type: "catalog", catalog: buildCatalog(), restartRequired: true });
        break;
      case "catalog.refresh":
        client.send({ type: "catalog", catalog: buildCatalog() });
        break;
      case "model.setup.refresh":
        session.modelRegistry.refresh();
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
      case "session.new":
        if (lockResult.role !== "writer") throw new Error("Read-only follower mode");
        await sessionActionsController.handleNewSession();
        sendBoot(client);
        broadcastState();
        broadcastSessions();
        break;
      case "session.open":
        if (lockResult.role !== "writer") throw new Error("Read-only follower mode");
        await sessionActionsController.handleOpenSession(String(data.path ?? ""));
        sendBoot(client);
        broadcastState();
        broadcastSessions();
        break;
      case "session.rename":
        if (lockResult.role !== "writer") throw new Error("Read-only follower mode");
        await sessionActionsController.handleRenameSession(
          String(data.path ?? ""),
          String(data.name ?? ""),
        );
        broadcastState();
        broadcastSessions();
        break;
      case "session.delete":
        if (lockResult.role !== "writer") throw new Error("Read-only follower mode");
        await sessionActionsController.handleDeleteSession(client, String(data.path ?? ""));
        break;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    client.send({
      type: "error",
      message,
    });
  }
}

async function buildBootstrapPayload(): Promise<Record<string, unknown>> {
  return {
    role: lockResult.role,
    sessionId: sessionManager.getSessionId(),
    catalog: buildCatalog(),
    modelSetup: buildCurrentModelSetupState(),
    askUserPrompts: askUserBridge.getPrompts(),
    sessions: await SessionManager.list(cwd, sessionDir),
    snapshot: buildStateSnapshot(),
  };
}

function sendBoot(client: WsClient): void {
  const snapshot = buildStateSnapshot();
  client.send({
    type: "boot",
    role: lockResult.role,
    lock: lockResult.lock,
    sessionId: sessionManager.getSessionId(),
    catalog: buildCatalog(),
    modelSetup: buildCurrentModelSetupState(),
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

function broadcastModelSetup(): void {
  broadcast({ type: "model.setup", modelSetup: buildCurrentModelSetupState() });
}

function broadcastState(): void {
  broadcast({
    type: "state.snapshot",
    ...buildStateSnapshot(),
  });
}

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
      broadcastState();
    } else {
      await promptAndSettle(runSession, prompt, beforeIds, observation);
      broadcastState();
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

function buildStateSnapshot() {
  const sessionId = sessionManager.getSessionId();
  const entries = sessionManager.getEntries();
  return {
    sessionId,
    state: projectDashboard(backgroundQuoteRefreshes.withEntries(entries), sessionId),
    entries,
    events: currentChatEvents(entries),
  };
}

function currentChatEvents(entries = sessionManager.getEntries()): ChatEvent[] {
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

function buildCurrentModelSetupState() {
  return modelSetupController.buildCurrentModelSetupState();
}

function broadcast(message: unknown): void {
  for (const client of clients) client.send(message);
}

function subscribeToSessionEvents(): () => void {
  return session.subscribe((event) => {
    broadcast({ type: "session.event", event });
    broadcastState();
  });
}

function writeJson(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function allowPrivateMarketStateApi(req: IncomingMessage, res: ServerResponse): boolean {
  if (
    isTrustedPrivateApiRequest(req.headers, privateApiSessionToken, req.socket.remoteAddress, {
      allowRemote: allowRemotePrivateApi,
    })
  )
    return true;
  res.writeHead(403, { "content-type": "application/json" });
  res.end(
    JSON.stringify({
      error: "Market-state API is only available to trusted GUI browser sessions.",
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
