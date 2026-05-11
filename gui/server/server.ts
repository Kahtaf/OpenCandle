import { createReadStream, existsSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createOpenCandleSession, getOpenCandleToolDefinitions } from "../../src/index.js";
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
import { parseGuiPromptIntent } from "./prompt-intent.js";
import { buildCatalog, setToolEnabled } from "./tool-metadata.js";
import { acquireWriterLock, refreshWriterLock, releaseWriterLock } from "./writer-lock.js";
import { sessionEntriesToChatEvents } from "./chat-event-adapter.js";
import { createLiveChatEventAdapter } from "./live-chat-event-adapter.js";
import type { ChatEvent } from "../shared/chat-events.js";

const cwd = process.cwd();
const host = process.env.OPENCANDLE_GUI_HOST ?? "127.0.0.1";
const port = Number(process.env.OPENCANDLE_GUI_PORT ?? 14567);
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const webDist = resolve(__dirname, "../web/dist");

const sessionManager = SessionManager.continueRecent(cwd);
const sessionDir = sessionManager.getSessionDir();
const lockResult = await acquireWriterLock(sessionDir, "gui");
const { session } = await createOpenCandleSession({ cwd, sessionManager });
const clients = new Set<WsClient>();
const heartbeat = setInterval(() => refreshWriterLock(sessionDir), 5000);
let poller: NodeJS.Timeout | null = null;

session.subscribe((event) => {
  broadcast({ type: "session.event", event });
  broadcastState();
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

  if (url.pathname === "/api/sessions" && req.method === "GET") {
    writeJson(res, {
      currentSessionId: sessionManager.getSessionId(),
      role: lockResult.role,
      sessions: await SessionManager.list(cwd),
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

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function handleClientMessage(client: WsClient, message: unknown): Promise<void> {
  const data = asRecord(message);
  try {
    switch (data.type) {
      case "chat.prompt":
        await handlePrompt(String(data.prompt ?? ""));
        break;
      case "tool.invoke":
        await handleToolInvoke(String(data.toolName ?? ""), asRecord(data.args));
        break;
      case "tool.enabled":
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
        sessionManager.newSession();
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
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sessionManager.appendCustomMessageEntry(
      "opencandle-gui-error",
      `GUI agent error: ${message}`,
      true,
      { source: "gui", message },
    );
    broadcastState();
    client.send({
      type: "error",
      message,
    });
  }
}

async function handlePrompt(prompt: string): Promise<void> {
  if (lockResult.role !== "writer") throw new Error("Read-only follower mode");

  const modelSetup = buildCurrentModelSetupState();
  if (modelSetup.requirement !== "ready") {
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

  const promptIntent = parseGuiPromptIntent(prompt);
  if (promptIntent.type === "stock_quote" || promptIntent.type === "stock_quote_compare") {
    sessionManager.appendMessage({ role: "user", content: prompt, timestamp: Date.now() });
    broadcastState();
    const tool = getAllTools().find((candidate) => candidate.name === "get_stock_quote");
    if (!tool) throw new Error("Stock quote tool is not available");
    if (promptIntent.type === "stock_quote") {
      await invokeToolFromUi(sessionManager, tool, { symbol: promptIntent.symbol }, "ui");
    } else {
      const quotes = [];
      for (const symbol of promptIntent.symbols) {
        const result = await invokeToolFromUi(sessionManager, tool, { symbol }, "ui");
        const quote = asStockQuote(result.result.details);
        if (quote) quotes.push(quote);
      }
      if (quotes.length >= 2) appendQuoteComparison(quotes);
    }
  } else if (promptIntent.type === "tool_prompt") {
    sessionManager.appendMessage({ role: "user", content: prompt, timestamp: Date.now() });
    broadcastState();
    const tool = getAllTools().find((candidate) => candidate.name === promptIntent.toolName);
    if (!tool) throw new Error(`Tool is not available: ${promptIntent.toolName}`);
    await invokeToolFromUi(sessionManager, tool, promptIntent.args, "ui");
  } else if (prompt.trim().startsWith("/analyze")) {
    sessionManager.appendMessage({ role: "user", content: prompt, timestamp: Date.now() });
    broadcastState();
    const symbol = prompt.trim().split(/\s+/)[1]?.toUpperCase() ?? "NVDA";
    sessionManager.appendCustomEntry("opencandle-workflow", {
      workflow: "comprehensive_analysis",
      resolvedSlots: { symbol },
      analystsTotal: 3,
    });
    await sleep(150);
    sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: `Started local analysis workflow for ${symbol}.` }],
      api: "openai-responses",
      provider: "openai",
      model: "gui-local",
      usage: emptyUsage(),
      stopReason: "stop",
      timestamp: Date.now(),
    });
  } else {
    await session.sendUserMessage(prompt);
  }
  broadcastState();
}

async function handleOpenSession(path: string): Promise<void> {
  const sessions = await SessionManager.list(cwd);
  const match = sessions.find((candidate) => candidate.path === path);
  if (!match) throw new Error("Unknown saved session");
  sessionManager.setSessionFile(match.path);
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
  });
  client.send({
    type: "state.snapshot",
    ...snapshot,
  });
  void SessionManager.list(cwd).then((sessions) => client.send({ type: "sessions", sessions }));
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
  const sessionId = sessionManager.getSessionId();
  const beforeEntries = sessionManager.getEntries();
  const beforeCount = beforeEntries.length;
  writeSse(res, { type: "run.started", runId, sessionId, seq: seq++ });
  res.flushHeaders?.();
  const liveStartSeq = seq;
  const liveAdapter = createLiveChatEventAdapter({
    runId,
    sessionId,
    startSeq: seq,
    emit: (event) => writeSse(res, event),
  });
  const unsubscribeLive = session.subscribe((event) => liveAdapter.handle(event));

  try {
    await handlePrompt(prompt);
    seq = liveAdapter.nextSeq();
    if (seq === liveStartSeq) {
      const newEntries = sessionManager.getEntries().slice(beforeCount);
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
    state: projectDashboard(entries, sessionId),
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
  void SessionManager.list(cwd).then((sessions) => broadcast({ type: "sessions", sessions }));
}

function buildCurrentModelSetupState() {
  return buildModelSetupState(session.modelRegistry, session.model);
}

function broadcast(message: unknown): void {
  for (const client of clients) client.send(message);
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
    sessionManager.appendCustomEntry("opencandle-quote-refresh", {
      symbol: row.symbol,
      toolName: tool.name,
      args: { symbol: row.symbol },
      value: result.result.details,
      content: result.result.content,
      isError: result.isError,
    });
  }
  broadcastState();
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
    default:
      return "application/octet-stream";
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asStockQuote(value: unknown): { symbol: string; price: number; changePercent: number; volume: number } | undefined {
  const record = asRecord(value);
  if (
    typeof record.symbol !== "string" ||
    typeof record.price !== "number" ||
    typeof record.changePercent !== "number" ||
    typeof record.volume !== "number"
  ) {
    return undefined;
  }
  return {
    symbol: record.symbol,
    price: record.price,
    changePercent: record.changePercent,
    volume: record.volume,
  };
}

function appendQuoteComparison(quotes: Array<{ symbol: string; price: number; changePercent: number; volume: number }>): void {
  const strongest = [...quotes].sort((a, b) => b.changePercent - a.changePercent)[0];
  const lines = [
    "| Symbol | Price | Day Change | Volume |",
    "| --- | ---: | ---: | ---: |",
    ...quotes.map((quote) => `| ${quote.symbol} | $${quote.price.toFixed(2)} | ${formatSignedPercent(quote.changePercent)} | ${quote.volume.toLocaleString()} |`),
    "",
    `Strongest day move: ${strongest.symbol} at ${formatSignedPercent(strongest.changePercent)}.`,
    "Key risk: quote-only comparisons are short-term snapshots; use full analysis before making a trade.",
  ];
  sessionManager.appendMessage({
    role: "assistant",
    content: [{ type: "text", text: lines.join("\n") }],
    api: "openai-responses",
    provider: "opencandle",
    model: "gui-local",
    usage: emptyUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  });
}

function formatSignedPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shutdown(): void {
  clearInterval(heartbeat);
  if (poller) clearInterval(poller);
  releaseWriterLock(sessionDir);
  session.dispose();
  server.close(() => process.exit(0));
}
