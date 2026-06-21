import { createReadStream, existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { type AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import { probeProviderStatus } from "../../src/onboarding/provider-status.js";
import type { ChatEvent } from "../shared/chat-events.js";
import { sessionEntriesToChatEvents } from "./chat-event-adapter.js";
import { chatRunSessionConflict } from "./chat-run-session.js";
import { createLiveChatEventAdapter } from "./live-chat-event-adapter.js";
import { buildMarketStateSnapshot, searchInstrumentCandidates } from "./market-state-api.js";
import { buildModelSetupState, type ModelSetupController } from "./model-setup.js";
import { isTrustedPrivateApiRequest, privateApiCookieHeader } from "./private-api-access.js";
import { createPromptObservation, observePromptEvent } from "./prompt-observation.js";
import type { QuoteSnapshotStore } from "./quote-snapshot-store.js";
import { promptAndSettle, type SessionActionsController } from "./session-actions.js";
import { waitForNewEntryId } from "./session-entry-wait.js";
import { buildCatalog } from "./tool-metadata.js";
import type { WsHub } from "./ws-hub.js";

interface GuiHttpRouteOptions {
  host: string;
  port: number;
  webDist: string;
  role: string;
  cwd: string;
  sessionDir: string;
  privateApiSessionToken: string;
  allowRemotePrivateApi: boolean;
  getSession: () => AgentSession;
  getSessionManager: () => SessionManager;
  wsHub: WsHub;
  modelSetupController: ModelSetupController;
  sessionActionsController: SessionActionsController;
  quoteSnapshotStore: QuoteSnapshotStore;
}

export function createHttpRequestHandler(options: GuiHttpRouteOptions) {
  return async function handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${options.host}:${options.port}`);
    if (url.pathname === "/health") {
      writeJson(res, { ok: true, role: options.role });
      return;
    }

    if (url.pathname === "/api/bootstrap" && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Bootstrap API", options)) return;
      writeJson(res, await options.wsHub.buildBootstrapPayload());
      return;
    }

    if (url.pathname === "/api/session/new" && req.method === "POST") {
      if (!allowTrustedGuiRequest(req, res, "Session API", options)) return;
      if (options.role !== "writer") {
        writeJson(res, { error: "Read-only follower mode" }, 409);
        return;
      }
      await options.sessionActionsController.handleNewSession();
      options.wsHub.broadcastState();
      options.wsHub.broadcastSessions();
      writeJson(res, await options.wsHub.buildBootstrapPayload());
      return;
    }

    if (url.pathname === "/api/sessions" && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Session API", options)) return;
      writeJson(res, {
        currentSessionId: options.getSessionManager().getSessionId(),
        role: options.role,
        sessions: await SessionManager.list(options.cwd, options.sessionDir),
      });
      return;
    }

    if (url.pathname === "/api/session/events" && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Session API", options)) return;
      writeJson(res, {
        sessionId: options.getSessionManager().getSessionId(),
        role: options.role,
        events: options.wsHub.currentChatEvents(),
      });
      return;
    }

    if (url.pathname === "/api/model-setup/refresh" && req.method === "POST") {
      if (!allowTrustedGuiRequest(req, res, "Model setup API", options)) return;
      options.getSession().modelRegistry.refresh();
      options.wsHub.broadcastModelSetup();
      writeJson(res, await options.wsHub.buildBootstrapPayload());
      return;
    }

    if (url.pathname === "/api/model-setup/api-key" && req.method === "POST") {
      if (!allowTrustedGuiRequest(req, res, "Model setup API", options)) return;
      await handleTrustedGuiMutation(req, res, options, async (body) => {
        await options.modelSetupController.handleSaveModelApiKey(
          String(body.provider ?? ""),
          String(body.apiKey ?? ""),
        );
        options.wsHub.broadcastModelSetup();
      });
      return;
    }

    if (url.pathname === "/api/model-setup/model" && req.method === "POST") {
      if (!allowTrustedGuiRequest(req, res, "Model setup API", options)) return;
      await handleTrustedGuiMutation(req, res, options, async (body) => {
        await options.modelSetupController.handleSelectModel(
          String(body.provider ?? ""),
          String(body.modelId ?? ""),
        );
        options.wsHub.broadcastModelSetup();
      });
      return;
    }

    if (url.pathname === "/api/provider-setup/api-key" && req.method === "POST") {
      if (!allowTrustedGuiRequest(req, res, "Provider setup API", options)) return;
      await handleTrustedGuiMutation(req, res, options, async (body) => {
        await options.modelSetupController.handleSaveProviderApiKey(
          String(body.providerId ?? ""),
          String(body.apiKey ?? ""),
        );
        options.wsHub.broadcast({ type: "catalog", catalog: buildCatalog() });
      });
      return;
    }

    if (url.pathname === "/api/market-state" && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Market-state API", options)) return;
      writeJson(res, buildMarketStateSnapshot());
      return;
    }

    if (url.pathname === "/api/market-state/quotes" && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Market-state API", options)) return;
      writeJson(res, await options.quoteSnapshotStore.get());
      return;
    }

    if (url.pathname === "/api/instruments/search" && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Market-state API", options)) return;
      writeJson(res, await searchInstrumentCandidates(url.searchParams.get("q") ?? ""));
      return;
    }

    if (url.pathname === "/api/diagnostics/twitter-cli" && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Diagnostics API", options)) return;
      const mode = url.searchParams.get("mode") === "session" ? "session" : "install";
      const force = url.searchParams.get("force") === "1";
      writeJson(res, await probeProviderStatus("twitter", { mode, force }));
      return;
    }

    if (url.pathname === "/api/diagnostics/reddit-cli" && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Diagnostics API", options)) return;
      const mode = url.searchParams.get("mode") === "session" ? "session" : "install";
      const force = url.searchParams.get("force") === "1";
      writeJson(res, await probeProviderStatus("reddit", { mode, force }));
      return;
    }

    if (url.pathname === "/api/chat/run" && req.method === "POST") {
      if (!allowTrustedGuiRequest(req, res, "Chat run API", options)) return;
      await handleSseChatRun(req, res, options);
      return;
    }

    serveStaticAsset(url.pathname, res, options);
  };
}

async function handleSseChatRun(
  req: IncomingMessage,
  res: ServerResponse,
  options: GuiHttpRouteOptions,
): Promise<void> {
  if (options.role !== "writer") {
    writeJson(res, { error: "Read-only follower mode" }, 409);
    return;
  }

  const body = await readJsonBody(req);
  const prompt = String(asRecord(body).prompt ?? "").trim();
  if (!prompt) {
    writeJson(res, { error: "prompt is required" }, 400);
    return;
  }

  const sessionManager = options.getSessionManager();
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
  const runSession = options.getSession();
  const runSessionManager = options.getSessionManager();
  const sessionId = runSessionManager.getSessionId();
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
      options.wsHub.broadcastState();
    } else {
      await promptAndSettle(runSession, prompt, beforeIds, observation);
      options.wsHub.broadcastState();
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

async function handleTrustedGuiMutation(
  req: IncomingMessage,
  res: ServerResponse,
  options: GuiHttpRouteOptions,
  action: (body: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  try {
    await action(asRecord(await readJsonBody(req)));
    writeJson(res, await options.wsHub.buildBootstrapPayload());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(res, { error: message }, message === "Read-only follower mode" ? 409 : 400);
  }
}

function serveStaticAsset(
  pathname: string,
  res: ServerResponse,
  options: GuiHttpRouteOptions,
): void {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const path = resolve(join(options.webDist, requested));
  if (!path.startsWith(options.webDist) || !existsSync(path)) {
    const fallback = resolve(join(options.webDist, "index.html"));
    if (!extname(requested) && fallback.startsWith(options.webDist) && existsSync(fallback)) {
      res.writeHead(200, privateGuiHeaders("text/html; charset=utf-8", options));
      createReadStream(fallback).pipe(res);
      return;
    }
    res.writeHead(404).end("Not found");
    return;
  }

  const type = contentType(path);
  res.writeHead(200, privateGuiHeaders(type, options));
  createReadStream(path).pipe(res);
}

function writeJson(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function allowTrustedGuiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  label: string,
  options: GuiHttpRouteOptions,
): boolean {
  if (
    isTrustedPrivateApiRequest(
      req.headers,
      options.privateApiSessionToken,
      req.socket.remoteAddress,
      {
        allowRemote: options.allowRemotePrivateApi,
      },
    )
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

function privateGuiHeaders(
  contentTypeValue: string,
  options: GuiHttpRouteOptions,
): Record<string, string> {
  const headers: Record<string, string> = { "content-type": contentTypeValue };
  if (contentTypeValue.startsWith("text/html")) {
    headers["set-cookie"] = privateApiCookieHeader(options.privateApiSessionToken);
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
