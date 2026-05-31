import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AuthStorage,
  createAgentSessionRuntime,
  createAgentSessionServices,
  type AgentSession,
  getAgentDir,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { createOpenCandleSession } from "../../src/index.js";
import { getAllTools } from "../../src/tools/index.js";
import { persistProviderCredential } from "../../src/onboarding/connect.js";
import {
  getCredentialSource,
  PROVIDERS,
  type ProviderId,
} from "../../src/onboarding/providers.js";
import { validateCredential } from "../../src/onboarding/validation.js";
import { buildModelSetupState, findPreferredModel, modelSetupProviders } from "./model-setup.js";
import { projectDashboard } from "./projector.js";
import { acceptWebSocket, type WsClient } from "./websocket.js";
import { invokeToolFromUi } from "./invoke-tool.js";
import { buildCatalog, setToolEnabled } from "./tool-metadata.js";
import { deleteSessionFile, renameSessionFile } from "./session-actions.js";
import { acquireWriterLock, refreshWriterLock, releaseWriterLock } from "./writer-lock.js";
import { sessionEntriesToChatEvents } from "./chat-event-adapter.js";
import { createLiveChatEventAdapter } from "./live-chat-event-adapter.js";
import { waitForNewEntryId, waitForSessionTurnSettlement } from "./session-entry-wait.js";
import {
  createPromptObservation,
  observePromptEvent,
  selectReplayPrompt,
  type PromptObservation,
} from "./prompt-observation.js";
import { BackgroundQuoteRefreshes } from "./background-quotes.js";
import { createAskUserBridge } from "./ask-user-bridge.js";
import { createInitialGuiSessionManager } from "./gui-session-manager.js";
import { createGracefulShutdown } from "./shutdown.js";
import { buildMarketStateQuoteSnapshot, buildMarketStateSnapshot, searchInstrumentCandidates } from "./market-state-api.js";
import type { ChatEvent } from "../shared/chat-events.js";

const cwd = process.cwd();
const host = process.env.OPENCANDLE_GUI_HOST ?? "127.0.0.1";
const port = Number(process.env.OPENCANDLE_GUI_PORT ?? 14567);
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
let poller: NodeJS.Timeout | null = null;
let quotePollInFlight = false;

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
    writeJson(res, {
      role: lockResult.role,
      sessionId: sessionManager.getSessionId(),
      catalog: buildCatalog(),
      modelSetup: buildCurrentModelSetupState(),
      askUserPrompts: askUserBridge.getPrompts(),
      sessions: await SessionManager.list(cwd, sessionDir),
      snapshot: buildStateSnapshot(),
    });
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
    writeJson(res, buildMarketStateSnapshot());
    return;
  }

  if (url.pathname === "/api/market-state/quotes" && req.method === "GET") {
    writeJson(res, await buildMarketStateQuoteSnapshot());
    return;
  }

  if (url.pathname === "/api/instruments/search" && req.method === "GET") {
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
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      createReadStream(fallback).pipe(res);
      return;
    }
    res.writeHead(404).end("Not found");
    return;
  }

  res.writeHead(200, { "content-type": contentType(path) });
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
    updatePoller();
  });
  client.onMessage((message) => void handleClientMessage(client, message));
  sendBoot(client);
  updatePoller();
});

server.listen(port, host, () => {
  console.log(`OpenCandle GUI listening on http://${host}:${port}`);
  if (host === "0.0.0.0") {
    console.log(`OpenCandle GUI is accepting LAN/Tailscale connections on port ${port}`);
  }
  console.log(`Writer role: ${lockResult.role}`);
});

const shutdown = createGracefulShutdown({
  server,
  cleanup: async () => {
    clearInterval(heartbeat);
    if (poller) {
      clearInterval(poller);
      poller = null;
    }
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
        await handlePrompt(String(data.prompt ?? ""));
        break;
      case "ask_user.answer":
        await handleAskUserAnswer(String(data.id ?? ""), data.answer);
        break;
      case "ask_user.cancel":
        await handleAskUserCancel(String(data.id ?? ""));
        break;
      case "tool.invoke":
        await handleToolInvoke(String(data.toolName ?? ""), asRecord(data.args));
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
        await handleSaveModelApiKey(String(data.provider ?? ""), String(data.apiKey ?? ""));
        broadcastModelSetup();
        break;
      case "model.setup.select_model":
        await handleSelectModel(String(data.provider ?? ""), String(data.modelId ?? ""));
        broadcastModelSetup();
        break;
      case "provider.save_api_key":
        await handleSaveProviderApiKey(String(data.providerId ?? ""), String(data.apiKey ?? ""));
        broadcast({ type: "catalog", catalog: buildCatalog() });
        break;
      case "session.new":
        if (lockResult.role !== "writer") throw new Error("Read-only follower mode");
        await handleNewSession();
        sendBoot(client);
        broadcastState();
        broadcastSessions();
        break;
      case "session.open":
        if (lockResult.role !== "writer") throw new Error("Read-only follower mode");
        await handleOpenSession(String(data.path ?? ""));
        sendBoot(client);
        broadcastState();
        broadcastSessions();
        break;
      case "session.rename":
        if (lockResult.role !== "writer") throw new Error("Read-only follower mode");
        await handleRenameSession(String(data.path ?? ""), String(data.name ?? ""));
        broadcastState();
        broadcastSessions();
        break;
      case "session.delete":
        if (lockResult.role !== "writer") throw new Error("Read-only follower mode");
        await handleDeleteSession(client, String(data.path ?? ""));
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

async function handlePrompt(prompt: string): Promise<void> {
  if (lockResult.role !== "writer") throw new Error("Read-only follower mode");

  const modelSetup = buildCurrentModelSetupState();
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt.startsWith("/") && modelSetup.requirement !== "ready") {
    sessionManager.appendMessage({ role: "user", content: prompt, timestamp: Date.now() });
    broadcastState();
    const message =
      modelSetup.requirement === "select_model"
        ? "Choose an available model before chat can run. OpenCandle found configured credentials but no active model."
        : "Connect an AI model before chat can run. Paste a Google Gemini, OpenAI, or Anthropic API key in the setup panel.";
    sessionManager.appendCustomMessageEntry(
      "opencandle-model-setup",
      message,
      true,
      { source: "gui", requirement: modelSetup.requirement },
    );
    broadcastState();
    return;
  }

  const beforeIds = new Set(sessionManager.getEntries().map((entry) => entry.id));
  await promptAndSettle(session, prompt, beforeIds);
  broadcastState();
}

async function handleAskUserAnswer(id: string, value: unknown): Promise<void> {
  if (lockResult.role !== "writer") throw new Error("Read-only follower mode");
  const answer = String(value ?? "").trim();
  if (!answer) throw new Error("Answer cannot be empty");
  if (!askUserBridge.answer(id, answer)) throw new Error("Unknown or resolved question");
}

async function handleAskUserCancel(id: string): Promise<void> {
  if (lockResult.role !== "writer") throw new Error("Read-only follower mode");
  if (!askUserBridge.cancel(id)) throw new Error("Unknown or resolved question");
}

async function handleNewSession(): Promise<void> {
  const result = await runtime.newSession();
  if (result.cancelled) throw new Error("Session switch cancelled");
}

async function handleOpenSession(path: string): Promise<void> {
  const sessions = await SessionManager.list(cwd, sessionDir);
  const match = sessions.find((candidate) => candidate.path === path);
  if (!match) throw new Error("Unknown saved session");
  const result = await runtime.switchSession(match.path);
  if (result.cancelled) throw new Error("Session switch cancelled");
}

async function handleRenameSession(path: string, name: string): Promise<void> {
  const nextName = name.trim();
  if (!nextName) throw new Error("Session name cannot be empty");
  if (sessionManager.getSessionFile() === path) {
    sessionManager.appendSessionInfo(nextName);
    return;
  }
  await renameSessionFile(cwd, sessionDir, path, nextName);
}

async function handleDeleteSession(client: WsClient, path: string): Promise<void> {
  const deletingCurrent = sessionManager.getSessionFile() === path;
  await deleteSessionFile(cwd, sessionDir, path);
  if (deletingCurrent) {
    await handleNewSession();
    sendBoot(client);
    broadcastState();
  }
  broadcastSessions();
}

async function handleSaveModelApiKey(providerId: string, apiKey: string): Promise<void> {
  if (lockResult.role !== "writer") throw new Error("Read-only follower mode");

  const provider = modelSetupProviders.find((candidate) => candidate.id === providerId);
  if (!provider) throw new Error(`Unknown model provider: ${providerId}`);

  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error(`Paste a ${provider.label} API key first.`);

  session.modelRegistry.authStorage.set(provider.id, { type: "api_key", key: trimmed });
  session.modelRegistry.refresh();

  const model = findPreferredModel(session.modelRegistry, provider);
  if (!model) {
    throw new Error(`Saved the ${provider.label} key, but no ${provider.label} models are available yet.`);
  }

  await session.setModel(model);
  await session.settingsManager.flush();
  sessionManager.appendCustomMessageEntry(
    "opencandle-model-setup",
    `Connected ${provider.label} and selected ${model.provider}/${model.id}.`,
    true,
    { source: "gui", provider: provider.id, model: `${model.provider}/${model.id}` },
  );
  broadcastState();
}

async function handleSaveProviderApiKey(providerId: string, apiKey: string): Promise<void> {
  if (lockResult.role !== "writer") throw new Error("Read-only follower mode");

  const descriptor = PROVIDERS.find((candidate) => candidate.id === providerId);
  if (!descriptor) throw new Error(`Unknown provider: ${providerId}`);

  if (getCredentialSource(descriptor.id) === "env") {
    throw new Error(
      `${descriptor.displayName} is set via the ${descriptor.envVar} environment variable. Unset it to override here.`,
    );
  }

  const trimmed = apiKey.trim();
  if (!trimmed) throw new Error(`Paste a ${descriptor.displayName} API key first.`);

  const validation = await validateCredential(descriptor.id as ProviderId, trimmed);
  if (validation.status === "invalid") {
    const statusHint = validation.httpStatus !== undefined ? ` (HTTP ${validation.httpStatus})` : "";
    const messageHint = validation.message ? ` — ${validation.message}` : "";
    throw new Error(
      `${descriptor.displayName} rejected the key${statusHint}${messageHint}. The existing configuration was not changed.`,
    );
  }

  persistProviderCredential(descriptor.id as ProviderId, trimmed);

  const verifiedNote =
    validation.status === "transient"
      ? `Saved ${descriptor.displayName} key but couldn't verify it (${validation.reason}). The next request will surface any issue.`
      : `Connected ${descriptor.displayName}. Key saved to ~/.opencandle/config.json.`;

  sessionManager.appendCustomMessageEntry(
    "opencandle-provider-setup",
    verifiedNote,
    true,
    { source: "gui", provider: descriptor.id, status: validation.status },
  );
  broadcastState();
}

async function handleSelectModel(provider: string, modelId: string): Promise<void> {
  if (lockResult.role !== "writer") throw new Error("Read-only follower mode");
  session.modelRegistry.refresh();
  const model = session.modelRegistry.find(provider, modelId);
  if (!model) throw new Error(`Unknown model: ${provider}/${modelId}`);
  await session.setModel(model);
  await session.settingsManager.flush();
}

async function handleToolInvoke(toolName: string, args: Record<string, unknown>): Promise<void> {
  if (lockResult.role !== "writer") throw new Error("Read-only follower mode");
  const tool = getAllTools().find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error(`Unknown tool: ${toolName}`);
  await invokeToolFromUi(sessionManager, tool, args, "ui");
  broadcastState();
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
  void SessionManager.list(cwd, sessionDir).then((sessions) => client.send({ type: "sessions", sessions }));
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
      runSessionManager.appendCustomMessageEntry(
        "opencandle-model-setup",
        message,
        true,
        { source: "gui", requirement: modelSetup.requirement },
      );
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
      const newEntries = runSessionManager.getEntries()
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

async function promptAndSettle(
  runSession: AgentSession,
  prompt: string,
  beforeIds: Set<string>,
  observation?: PromptObservation,
): Promise<void> {
  await runSession.prompt(prompt);
  await waitForSessionTurnSettlement(() => ({
    isStreaming: runSession.isStreaming,
    pendingMessageCount: runSession.pendingMessageCount,
  }));
  await waitForNewEntryId(() => runSession.sessionManager.getEntries().map((entry) => entry.id), beforeIds);
  await replayObservedWorkflowPromptIfNeeded(runSession, prompt, observation);
}

async function replayObservedWorkflowPromptIfNeeded(
  runSession: AgentSession,
  originalPrompt: string,
  observation?: PromptObservation,
): Promise<void> {
  if (!observation) return;
  const replayPrompt = selectReplayPrompt(observation, originalPrompt);
  if (!replayPrompt) return;

  await runSession.prompt(replayPrompt, {
    expandPromptTemplates: false,
    source: "extension",
  });
  await waitForSessionTurnSettlement(() => ({
    isStreaming: runSession.isStreaming,
    pendingMessageCount: runSession.pendingMessageCount,
  }));
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
  void SessionManager.list(cwd, sessionDir).then((sessions) => broadcast({ type: "sessions", sessions }));
}

function buildCurrentModelSetupState() {
  return buildModelSetupState(session.modelRegistry, session.model);
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

function updatePoller(): void {
  if (clients.size > 0 && !poller) {
    poller = setInterval(() => void pollVisibleQuotes(), 30000);
  }
  if (clients.size === 0 && poller) {
    clearInterval(poller);
    poller = null;
  }
}

async function pollVisibleQuotes(): Promise<void> {
  if (quotePollInFlight) return;
  quotePollInFlight = true;
  try {
    const state = projectDashboard(sessionManager.getEntries(), sessionManager.getSessionId());
    const tool = getAllTools().find((candidate) => candidate.name === "get_stock_quote");
    if (!tool) return;
    for (const row of state.watchlist.filter((item) => item.pinned || item.quote)) {
      const result = await invokeToolFromUi(
        sessionManager,
        tool,
        { symbol: row.symbol },
        "background",
        { recordTranscript: false },
      );
      backgroundQuoteRefreshes.upsert({
        symbol: row.symbol,
        toolName: tool.name,
        args: { symbol: row.symbol },
        value: result.result.details,
        content: result.result.content,
        isError: result.isError,
      });
    }
    broadcastState();
  } catch (error) {
    console.warn(`Background quote refresh failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    quotePollInFlight = false;
  }
}

function writeJson(res: ServerResponse, value: unknown): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
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
    ? value as Record<string, unknown>
    : {};
}
