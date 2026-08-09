import { createReadStream, existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { type AgentSession, ModelRegistry, SessionManager } from "@earendil-works/pi-coding-agent";
import { buildDoctorReport } from "../../src/doctor/report.js";
import { MarketStateService } from "../../src/market-state/service.js";
import { initDefaultDatabase } from "../../src/memory/sqlite.js";
import { probeProviderStatus } from "../../src/onboarding/provider-status.js";
import {
  clearPendingSessionAction,
  hasAcceptedSessionAction,
  hasPendingSessionAction,
  recordAcceptedSessionAction,
  recordPendingSessionAction,
} from "../../src/pi/session-action-dedupe.js";
import type { ChatEvent } from "../shared/chat-events.js";
import {
  buildDispatchedPromptFromState,
  chatRunAttachmentLabel,
  type ParsedChatRunBody,
  parseChatRunBody,
  shouldPersistOriginalInputMarker,
} from "../shared/chat-run-input.js";

export {
  type ChatRunAttachmentInput,
  type ChatRunImageInput,
  type ParsedChatRunBody,
  parseChatRunBody,
} from "../shared/chat-run-input.js";

import { createLiveChatEventAdapter } from "../shared/live-chat-event-adapter.js";
import { sessionEntriesToChatEvents } from "./chat-event-adapter.js";
import type { ToolInvokeController } from "./invoke-tool.js";
import type {
  LocalSessionCoordinator,
  SessionActionEnvelope,
  SessionActionResult,
} from "./local-session-coordinator.js";
import type { MarketIndicesSnapshotStore } from "./market-indices-snapshot-store.js";
import {
  buildMarketStateSnapshot,
  getInstrumentHistorySnapshot,
  getInstrumentOverviewSnapshot,
  getInstrumentQuoteSnapshot,
  getSavedMarketStateSymbols,
  searchInstrumentCandidates,
} from "./market-state-api.js";
import { buildModelSetupState, type ModelSetupController } from "./model-setup.js";
import {
  deleteStoredPreference,
  deleteStoredToolDefault,
  getPreferencesSnapshot,
  type PreferencesSnapshot,
} from "./preferences-api.js";
import { isTrustedPrivateApiRequest, privateApiCookieHeader } from "./private-api-access.js";
import { projectDashboard } from "./projector.js";
import { createPromptObservation, observePromptEvent } from "./prompt-observation.js";
import type { QuoteSnapshotStore } from "./quote-snapshot-store.js";
import { promptAndSettle, type SessionActionsController } from "./session-actions.js";
import { waitForNewEntryId } from "./session-entry-wait.js";
import { listDisplaySessions } from "./session-list.js";
import { fetchTickerLineSparkline } from "./ticker-line-sparkline.js";
import { buildCatalog } from "./tool-metadata.js";
import {
  acquireWriterLock,
  isCoordinatorOwnerAlive,
  readWriterLock,
  refreshWriterLock,
  releaseWriterLock,
  shouldBlockFailedCoordinatorAction as shouldBlockFailedCoordinatorLockAction,
  writerLockScopeForSession,
} from "./writer-lock.js";
import type { WsHub } from "./ws-hub.js";

interface GuiHttpRouteOptions {
  host: string;
  port: number;
  webDist: string;
  role: string;
  cwd: string;
  agentDir: string;
  sessionDir: string;
  privateApiSessionToken: string;
  localCoordinatorEndpoint: string;
  localCoordinatorSecret: string;
  allowRemotePrivateApi: boolean;
  syncCurrentWriterLockScope?: () => void;
  getSession: () => AgentSession;
  getSessionManager: () => SessionManager;
  createSessionForManager: (sessionManager: SessionManager) => Promise<{ session: AgentSession }>;
  wsHub: WsHub;
  modelSetupController: ModelSetupController;
  sessionActionsController: SessionActionsController;
  toolInvokeController: ToolInvokeController;
  quoteSnapshotStore: QuoteSnapshotStore;
  indicesSnapshotStore: MarketIndicesSnapshotStore;
  localSessionCoordinator?: LocalSessionCoordinator;
}

export function createHttpRequestHandler(options: GuiHttpRouteOptions) {
  const activeRunSessionIds = new Set<string>();

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
        writeJson(
          res,
          { error: "OpenCandle is reconnecting to this session.", code: "syncing" },
          409,
        );
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
        sessions: await listDisplaySessions(options.cwd, options.sessionDir),
      });
      return;
    }

    const sessionBootstrapId = sessionIdFromRoute(url.pathname, "bootstrap");
    if (sessionBootstrapId && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Session API", options)) return;
      const sessionManager = await resolveSessionManagerById(options, sessionBootstrapId);
      if (!sessionManager) {
        writeJson(res, { error: "Unknown saved session" }, 404);
        return;
      }
      writeJson(res, await buildSessionBootstrapPayload(options, sessionManager));
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
      await handleTrustedGuiMutation(req, res, options, async () => {
        await options.getSession().modelRuntime.refresh();
        options.wsHub.broadcastModelSetup();
      });
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

    if (url.pathname === "/api/model-setup/thinking" && req.method === "POST") {
      if (!allowTrustedGuiRequest(req, res, "Model setup API", options)) return;
      await handleTrustedGuiMutation(req, res, options, async (body) => {
        await options.modelSetupController.handleSetThinkingLevel?.(String(body.level ?? ""));
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

    if (url.pathname === "/api/preferences" && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Preferences API", options)) return;
      writeJson(res, getPreferencesSnapshot());
      return;
    }

    if (url.pathname === "/api/preferences/delete" && req.method === "POST") {
      if (!allowTrustedGuiRequest(req, res, "Preferences API", options)) return;
      await handleTrustedPreferencesMutation(req, res, options, (body) =>
        deleteStoredPreference(String(body.namespace ?? ""), String(body.key ?? "")),
      );
      return;
    }

    if (url.pathname === "/api/tool-defaults/delete" && req.method === "POST") {
      if (!allowTrustedGuiRequest(req, res, "Preferences API", options)) return;
      await handleTrustedPreferencesMutation(req, res, options, (body) =>
        deleteStoredToolDefault(String(body.toolName ?? ""), String(body.paramPath ?? "")),
      );
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

    if (url.pathname === "/api/market-state/indices" && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Market-state API", options)) return;
      writeJson(res, await options.indicesSnapshotStore.get());
      return;
    }

    if (url.pathname === "/api/market-state/sparkline" && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Market-state API", options)) return;
      const result = await fetchTickerLineSparkline(
        url.searchParams.get("symbol") ?? "",
        url.searchParams.get("assetType") ?? "",
      );
      if (result.status !== "ok") {
        writeJson(res, { error: result.reason }, result.status === "invalid_request" ? 400 : 502);
        return;
      }
      if (url.searchParams.get("metadata") === "1") {
        if (!result.dataAsOf) {
          writeJson(res, { error: "Ticker Line did not provide an as-of timestamp" }, 502);
          return;
        }
        writeJson(res, { source: "Ticker Line", dataAsOf: result.dataAsOf });
        return;
      }
      res.writeHead(200, {
        "cache-control": "private, max-age=300",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "content-type": "image/svg+xml",
        "x-content-type-options": "nosniff",
        ...(result.dataAsOf ? { "x-data-as-of": result.dataAsOf } : {}),
      });
      res.end(result.svg);
      return;
    }

    if (url.pathname === "/api/doctor" && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Diagnostics API", options)) return;
      const session = options.getSession();
      writeJson(
        res,
        await buildDoctorReport({
          cwd: options.cwd,
          agentDir: options.agentDir,
          includeSessions: url.searchParams.get("sessions") === "1",
          gui: {
            host: options.host,
            port: options.port,
            role: options.role,
            reachable: true,
            healthEndpoint: `http://${options.host}:${options.port}/health`,
          },
          modelSetup: buildModelSetupState(new ModelRegistry(session.modelRuntime), session.model),
        }),
      );
      return;
    }

    if (url.pathname === "/api/instruments/search" && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Market-state API", options)) return;
      writeJson(res, await searchInstrumentCandidates(url.searchParams.get("q") ?? ""));
      return;
    }

    if (url.pathname === "/api/instruments/quote" && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Market-state API", options)) return;
      writeJson(res, await getInstrumentQuoteSnapshot(url.searchParams.get("symbol") ?? ""));
      return;
    }

    if (url.pathname === "/api/instruments/overview" && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Market-state API", options)) return;
      writeJson(res, await getInstrumentOverviewSnapshot(url.searchParams.get("symbol") ?? ""));
      return;
    }

    if (url.pathname === "/api/instruments/history" && req.method === "GET") {
      if (!allowTrustedGuiRequest(req, res, "Market-state API", options)) return;
      const snapshot = await getInstrumentHistorySnapshot(
        url.searchParams.get("symbol") ?? "",
        url.searchParams.get("range") ?? "1D",
        url.searchParams.get("interval") ?? undefined,
      );
      if (snapshot.status === "invalid_request") {
        writeJson(res, snapshot, 400);
        return;
      }
      writeJson(res, snapshot);
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
      writeJson(
        res,
        {
          error: "Legacy active-session chat runs are no longer supported.",
          code: "legacy_route_removed",
        },
        410,
      );
      return;
    }

    if (url.pathname === "/api/local-coordinator/chat-run" && req.method === "POST") {
      if (!allowLocalCoordinatorRequest(req, res, options)) return;
      const body = asRecord(await readJsonBody(req));
      if (!requireSessionActionFields(res, body)) return;
      const sessionManager = await resolveSessionManagerById(options, String(body.sessionId));
      if (!sessionManager) {
        writeJson(res, { error: "Unknown saved session" }, 404);
        return;
      }
      // allowProxy: false — this endpoint is the proxy target; re-proxying loops.
      await handleSseChatRun(req, res, options, activeRunSessionIds, sessionManager, body, false);
      return;
    }

    if (url.pathname === "/api/tool-invoke" && req.method === "POST") {
      if (!allowTrustedGuiRequest(req, res, "Tool invoke API", options)) return;
      const body = asRecord(await readJsonBody(req));
      if (!requireSessionActionFields(res, body)) return;
      let ack: unknown;
      await options.toolInvokeController.handleToolInvokeMessage(
        { send: (message) => (ack = message) },
        {
          requestId: "http-tool",
          actionId: String(body.actionId ?? ""),
          sessionId: String(body.sessionId ?? ""),
          toolName: String(body.toolName ?? ""),
          args: asRecord(body.args),
          ...(body.recordTranscript === false ? { recordTranscript: false } : {}),
        },
      );
      const message = asRecord(ack);
      const result = asRecord(message.result);
      if (message.ok === true && result.toolCallId) {
        writeJson(res, { result });
      } else {
        writeJson(
          res,
          { error: String(asRecord(message.error).message ?? "Tool invocation failed") },
          409,
        );
      }
      return;
    }

    if (url.pathname === "/api/local-coordinator/tool-invoke" && req.method === "POST") {
      if (!allowLocalCoordinatorRequest(req, res, options)) return;
      const body = asRecord(await readJsonBody(req));
      if (!requireSessionActionFields(res, body)) return;
      let ack: unknown;
      await options.toolInvokeController.handleToolInvokeMessage(
        { send: (message) => (ack = message) },
        {
          requestId: "local-coordinator-tool",
          actionId: String(body.actionId ?? ""),
          sessionId: String(body.sessionId ?? ""),
          toolName: String(body.toolName ?? ""),
          args: asRecord(body.args),
          allowProxy: false,
          ...(body.recordTranscript === false ? { recordTranscript: false } : {}),
        },
      );
      const message = asRecord(ack);
      const result = asRecord(message.result);
      if (message.ok === true && result.toolCallId) {
        writeJson(res, { result });
      } else {
        writeJson(
          res,
          { error: String(asRecord(message.error).message ?? "Tool invocation failed") },
          409,
        );
      }
      return;
    }

    if (url.pathname === "/api/local-coordinator/ask-user" && req.method === "POST") {
      if (!allowLocalCoordinatorRequest(req, res, options)) return;
      const body = asRecord(await readJsonBody(req));
      if (!requireSessionActionFields(res, body)) return;
      const payload = asRecord(body.payload);
      try {
        const action = {
          actionId: String(body.actionId ?? ""),
          sessionId: String(body.sessionId ?? ""),
          source: "browser" as const,
          allowProxy: false,
        };
        if (body.actionType === "ask_user.answer") {
          await options.sessionActionsController.handleAskUserAnswer(
            String(payload.id ?? ""),
            payload.answer,
            action,
          );
        } else if (body.actionType === "ask_user.cancel") {
          await options.sessionActionsController.handleAskUserCancel(
            String(payload.id ?? ""),
            action,
          );
        } else {
          writeJson(res, { error: "Unknown ask_user action" }, 400);
          return;
        }
        writeJson(res, { ok: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        writeJson(res, { error: message }, 409);
      }
      return;
    }

    const runSessionId = sessionIdFromRoute(url.pathname, "runs");
    if (runSessionId && req.method === "POST") {
      if (!allowTrustedGuiRequest(req, res, "Chat run API", options)) return;
      const body = asRecord(await readJsonBody(req));
      if (!requireSessionActionFields(res, { ...body, sessionId: runSessionId }, false)) return;
      const sessionManager = await resolveSessionManagerById(options, runSessionId);
      if (!sessionManager) {
        writeJson(res, { error: "Unknown saved session" }, 404);
        return;
      }
      // allowProxy: true — forward to a live coordinator owned by another
      // process (0.11.0 authenticated local forwarding).
      await handleSseChatRun(req, res, options, activeRunSessionIds, sessionManager, body, true);
      return;
    }

    serveStaticAsset(url.pathname, res, options);
  };
}

async function handleSseChatRun(
  req: IncomingMessage,
  res: ServerResponse,
  options: GuiHttpRouteOptions,
  activeRunSessionIds: Set<string>,
  targetSessionManager: SessionManager | undefined,
  bodyOverride: Record<string, unknown> | undefined,
  // Explicit because both remaining callers pass a body: the browser-facing
  // runs route must forward to a live coordinator owned by another process,
  // while the local-coordinator endpoint IS the proxy target and re-proxying
  // there would loop.
  allowProxy: boolean,
): Promise<void> {
  const body = bodyOverride ?? asRecord(await readJsonBody(req));
  const parsed = parseChatRunBody(body);
  if (!parsed.ok) {
    writeJson(res, { error: parsed.error }, 400);
    return;
  }
  const currentSessionManager = options.getSessionManager();
  const bodyRecord = asRecord(body);
  const requestedSessionId = String(bodyRecord.sessionId ?? "").trim();
  const runSessionManager = targetSessionManager ?? currentSessionManager;
  const sessionId = runSessionManager.getSessionId();
  if (requestedSessionId && requestedSessionId !== sessionId) {
    writeJson(
      res,
      { error: "Session route and request body disagree", code: "session_changed" },
      409,
    );
    return;
  }

  const actionId = String(bodyRecord.actionId ?? "").trim();
  const shouldProxyChatRun = allowProxy && canProxyChatRunToCoordinator(runSessionManager);
  if (shouldProxyChatRun) {
    if (await proxyChatRunToCoordinator(res, runSessionManager, bodyRecord)) {
      const useCurrentSession =
        !targetSessionManager ||
        currentSessionManager.getSessionFile() === runSessionManager.getSessionFile();
      await broadcastFreshRunSessionSnapshot(options, runSessionManager, useCurrentSession);
      return;
    }
    if (actionId && hasAcceptedSessionAction(runSessionManager, actionId)) {
      writeJson(res, { ok: true, duplicate: true });
      return;
    }
    if (actionId && hasPendingSessionAction(runSessionManager, actionId)) {
      writeJson(
        res,
        { error: "OpenCandle is reconnecting to this session.", code: "syncing" },
        409,
      );
      return;
    }
    if (shouldBlockFailedCoordinatorAction(runSessionManager, bodyRecord)) {
      writeJson(
        res,
        { error: "OpenCandle is reconnecting to this session.", code: "syncing" },
        409,
      );
      return;
    }
  }
  if (actionId && hasAcceptedSessionAction(runSessionManager, actionId)) {
    writeJson(res, { ok: true, duplicate: true });
    return;
  }
  if (actionId && hasPendingSessionAction(runSessionManager, actionId)) {
    writeJson(res, { error: "OpenCandle is reconnecting to this session.", code: "syncing" }, 409);
    return;
  }

  if (options.localSessionCoordinator) {
    const action = buildChatRunActionEnvelope(bodyRecord, sessionId);
    let result: SessionActionResult<{ streamed: boolean }>;
    try {
      result = await options.localSessionCoordinator.runSessionAction(action, async () => {
        const admitted = await streamAcceptedSseChatRun({
          res,
          options,
          activeRunSessionIds,
          targetSessionManager,
          currentSessionManager,
          runSessionManager,
          sessionId,
          parsedRun: parsed.value,
          actionId: action.actionId,
        });
        if (!admitted) throw new SessionActionNotAdmitted();
        return { streamed: true };
      });
    } catch (error) {
      if (error instanceof SessionActionNotAdmitted) return;
      throw error;
    }
    if (!result.ok) {
      writeJson(res, { error: result.message, code: result.code }, 409);
      return;
    }
    if (result.duplicate && !res.headersSent) {
      writeJson(res, { ok: true, duplicate: true });
    }
    return;
  }

  await streamAcceptedSseChatRun({
    res,
    options,
    activeRunSessionIds,
    targetSessionManager,
    currentSessionManager,
    runSessionManager,
    sessionId,
    parsedRun: parsed.value,
    actionId,
  });
}

export function canProxyChatRunToCoordinator(runSessionManager: SessionManager): boolean {
  const lock = readWriterLock(writerLockScopeForSession(runSessionManager));
  return hasLiveCoordinatorLock(lock);
}

async function proxyChatRunToCoordinator(
  res: ServerResponse,
  runSessionManager: SessionManager,
  body: Record<string, unknown>,
): Promise<boolean> {
  const lock = readWriterLock(writerLockScopeForSession(runSessionManager));
  if (!hasLiveCoordinatorLock(lock)) return false;
  const endpoint = new URL("/api/local-coordinator/chat-run", lock.coordinatorEndpoint);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencandle-coordinator-secret": lock.coordinatorSecret,
      },
      body: JSON.stringify({ ...body, sessionId: runSessionManager.getSessionId() }),
    });
  } catch {
    return false;
  }
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) {
    for await (const chunk of response.body) {
      res.write(chunk);
    }
  }
  res.end();
  return true;
}

function hasLiveCoordinatorLock(
  lock: ReturnType<typeof readWriterLock>,
  staleGraceMs = 15_000,
): lock is NonNullable<ReturnType<typeof readWriterLock>> & {
  coordinatorEndpoint: string;
  coordinatorSecret: string;
} {
  if (!lock?.coordinatorEndpoint || !lock.coordinatorSecret || lock.pid === process.pid) {
    return false;
  }
  const heartbeat = Date.parse(lock.lastHeartbeat);
  const hasFreshHeartbeat = Number.isFinite(heartbeat) && Date.now() - heartbeat <= staleGraceMs;
  return hasFreshHeartbeat && isCoordinatorOwnerAlive(lock.pid);
}

async function streamAcceptedSseChatRun({
  res,
  options,
  activeRunSessionIds,
  targetSessionManager,
  currentSessionManager,
  runSessionManager,
  sessionId,
  parsedRun,
  actionId,
}: {
  res: ServerResponse;
  options: GuiHttpRouteOptions;
  activeRunSessionIds: Set<string>;
  targetSessionManager?: SessionManager;
  currentSessionManager: SessionManager;
  runSessionManager: SessionManager;
  sessionId: string;
  parsedRun: ParsedChatRunBody;
  actionId: string;
}): Promise<boolean> {
  const prompt = parsedRun.prompt;
  if (activeRunSessionIds.has(sessionId)) {
    writeJson(res, { error: "Session already has an active run", code: "session_busy" }, 409);
    return false;
  }
  let dispatchedPrompt: string;
  try {
    dispatchedPrompt = await buildDispatchedPrompt(parsedRun);
  } catch (error) {
    writeJson(res, { error: error instanceof Error ? error.message : String(error) }, 400);
    return false;
  }
  const promptImages = parsedRun.images.map((image) => ({
    type: "image" as const,
    data: image.data,
    mimeType: image.mimeType,
  }));
  const attachmentLabels = parsedRun.attachments.map((attachment) => ({
    kind: attachment.kind,
    label: chatRunAttachmentLabel(attachment),
  }));
  const inputAttachmentLabels = [
    ...promptImages.map((image, index) => ({
      kind: "image",
      label: `${image.mimeType || "image"} #${index + 1}`,
    })),
    ...attachmentLabels,
  ];

  const currentSessionFile = currentSessionManager.getSessionFile();
  const targetSessionFile = runSessionManager.getSessionFile();
  const useCurrentSession = !targetSessionManager || currentSessionFile === targetSessionFile;
  let acquiredLockScope = "";
  let lockHeartbeat: ReturnType<typeof setInterval> | undefined;
  const needsWriterLock = !useCurrentSession || options.role !== "writer";
  if (needsWriterLock) {
    const lockScope = writerLockScopeForSession(runSessionManager);
    const lockResult = await acquireWriterLock(lockScope, "gui", {
      coordinatorEndpoint: options.localCoordinatorEndpoint,
      coordinatorSecret: options.localCoordinatorSecret,
    });
    if (lockResult.role !== "writer") {
      writeJson(
        res,
        { error: "OpenCandle is reconnecting to this session.", code: "syncing" },
        409,
      );
      return false;
    }
    acquiredLockScope = lockScope;
    lockHeartbeat = setInterval(() => refreshWriterLock(lockScope), 5000);
  }

  activeRunSessionIds.add(sessionId);
  let createdSession: { session: AgentSession } | null = null;
  try {
    createdSession = useCurrentSession
      ? null
      : await options.createSessionForManager(runSessionManager);
  } catch (error) {
    activeRunSessionIds.delete(sessionId);
    if (lockHeartbeat) clearInterval(lockHeartbeat);
    if (acquiredLockScope) releaseWriterLock(acquiredLockScope);
    const message = error instanceof Error ? error.message : String(error);
    writeJson(res, { error: message }, 500);
    return false;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  let seq = 1;
  const runId = `gui-run-${Date.now()}`;
  const runSession = createdSession?.session ?? options.getSession();
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
    dispatchedPrompt,
    originalAttachments: inputAttachmentLabels,
  });
  const observation = createPromptObservation();
  let originalInputMarkerAppended = false;
  const appendOriginalInputMarker = () => {
    if (
      !shouldPersistOriginalInputMarker(prompt, inputAttachmentLabels) ||
      originalInputMarkerAppended
    ) {
      return;
    }
    runSessionManager.appendCustomEntry("opencandle-user-input", {
      original: prompt,
      attachments: inputAttachmentLabels,
    });
    originalInputMarkerAppended = true;
  };
  let actionAccepted = false;
  const recordAcceptedAction = () => {
    if (actionAccepted) return;
    appendOriginalInputMarker();
    recordAcceptedSessionAction(runSessionManager, actionId);
    if (useCurrentSession) options.syncCurrentWriterLockScope?.();
    actionAccepted = true;
  };

  const unsubscribeLive = runSession.subscribe((event) => {
    liveAdapter.handle(event);
    observePromptEvent(observation, event);
    if (
      !prompt.startsWith("/") &&
      !actionAccepted &&
      observation.userTexts.some((text) => text.trim() === dispatchedPrompt.trim())
    ) {
      recordAcceptedAction();
    }
  });

  try {
    recordPendingSessionAction(runSessionManager, actionId);
    if (shouldPersistOriginalInputMarker(prompt, inputAttachmentLabels)) {
      appendOriginalInputMarker();
    }
    const modelSetup = buildModelSetupState(
      new ModelRegistry(runSession.modelRuntime),
      runSession.model,
    );
    if (!prompt.startsWith("/") && modelSetup.requirement !== "ready") {
      runSessionManager.appendMessage({ role: "user", content: prompt, timestamp: Date.now() });
      recordAcceptedAction();
      const message =
        modelSetup.requirement === "select_model"
          ? "Choose an available model before chat can run. OpenCandle found configured credentials but no active model."
          : "Connect an AI model before chat can run. Paste a Google Gemini, OpenAI, or Anthropic API key in the setup panel.";
      runSessionManager.appendCustomMessageEntry("opencandle-model-setup", message, true, {
        source: "gui",
        requirement: modelSetup.requirement,
      });
      await broadcastRunSessionSnapshot(options, runSessionManager, useCurrentSession);
    } else {
      await promptAndSettle(
        runSession,
        dispatchedPrompt,
        beforeIds,
        observation,
        promptImages.length > 0 ? { images: promptImages } : undefined,
      );
      recordAcceptedAction();
      await broadcastRunSessionSnapshot(options, runSessionManager, useCurrentSession);
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
    writeSse(res, { type: "run.completed", runId, sessionId, seq });
  } catch (error) {
    if (!actionAccepted) clearPendingSessionAction(runSessionManager, actionId);
    seq = liveAdapter.nextSeq();
    const message = error instanceof Error ? error.message : String(error);
    if (isModelAuthenticationFailure(error)) {
      runSessionManager.appendCustomMessageEntry(
        "opencandle-model-run-failed",
        `Chat could not authenticate the configured model key. ${message}`,
        true,
        // prompt lets the failure card's Retry re-send this run's prompt even
        // after later prompts change the session's most-recent input.
        { source: "gui", reason: "model_auth", prompt },
      );
      const failureEntry = runSessionManager.getEntries().at(-1);
      if (failureEntry) {
        const failureEvents = sessionEntriesToChatEvents([failureEntry], {
          sessionId,
          updatedAt: new Date().toISOString(),
          startSeq: seq,
        });
        for (const failureEvent of failureEvents) {
          writeSse(res, failureEvent);
          seq = failureEvent.seq + 1;
        }
      }
      await broadcastRunSessionSnapshot(options, runSessionManager, useCurrentSession);
    }
    writeSse(res, { type: "run.failed", runId, sessionId, error: { message }, seq });
  } finally {
    activeRunSessionIds.delete(sessionId);
    unsubscribeLive();
    createdSession?.session.dispose();
    if (lockHeartbeat) clearInterval(lockHeartbeat);
    if (acquiredLockScope) releaseWriterLock(acquiredLockScope);
    res.end();
  }
  return actionAccepted;
}

class SessionActionNotAdmitted extends Error {}

export function isModelAuthenticationFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:401|403|unauthorized|forbidden|authentication|invalid[_ -]?api[_ -]?key|api[_ -]?key[_ -]?invalid|api key not valid)\b/i.test(
    message,
  );
}

async function broadcastRunSessionSnapshot(
  options: GuiHttpRouteOptions,
  sessionManager: SessionManager,
  useCurrentSession: boolean,
): Promise<void> {
  if (useCurrentSession) {
    options.syncCurrentWriterLockScope?.();
    options.wsHub.broadcastState();
  } else {
    options.wsHub.broadcastSessionSnapshot(sessionManager);
    options.wsHub.broadcastSessions();
  }
}

async function broadcastFreshRunSessionSnapshot(
  options: GuiHttpRouteOptions,
  sessionManager: SessionManager,
  useCurrentSession: boolean,
): Promise<void> {
  const freshSessionManager = await reloadSessionManager(sessionManager, options);
  if (useCurrentSession) {
    options.syncCurrentWriterLockScope?.();
    options.wsHub.broadcast({
      type: "state.snapshot",
      ...buildSnapshotPayload(freshSessionManager),
    });
  } else {
    options.wsHub.broadcast({
      type: "session.snapshot",
      ...buildSnapshotPayload(freshSessionManager),
    });
    options.wsHub.broadcastSessions();
  }
}

async function reloadSessionManager(
  sessionManager: SessionManager,
  options: Pick<GuiHttpRouteOptions, "sessionDir" | "cwd">,
): Promise<SessionManager> {
  const sessionFile = sessionManager.getSessionFile();
  return sessionFile
    ? SessionManager.open(sessionFile, options.sessionDir, options.cwd)
    : sessionManager;
}

function buildSnapshotPayload(sessionManager: SessionManager): Record<string, unknown> {
  const sessionId = sessionManager.getSessionId();
  const entries = sessionManager.getEntries();
  return {
    sessionId,
    state: projectDashboard(entries, sessionId, getSavedMarketStateSymbols()),
    entries,
    events: sessionEntriesToChatEvents(entries, {
      sessionId,
      title: sessionManager.getSessionName(),
    }),
  };
}

export async function buildSessionBootstrapPayload(
  options: Pick<
    GuiHttpRouteOptions,
    "cwd" | "sessionDir" | "role" | "modelSetupController" | "getSessionManager" | "wsHub"
  >,
  sessionManager: SessionManager,
): Promise<Record<string, unknown>> {
  const sessionId = sessionManager.getSessionId();
  const entries = sessionManager.getEntries();
  const bootstrap = await options.wsHub.buildBootstrapPayload();
  return {
    role: roleForSessionBootstrap(options, sessionManager),
    sessionId,
    sessionPersisted: isSessionPersisted(sessionManager),
    coordination: {
      sessionId,
      status: roleForSessionBootstrap(options, sessionManager) === "writer" ? "ready" : "syncing",
      ownerKind: ownerKindForSessionBootstrap(options, sessionManager),
    },
    catalog: buildCatalog(),
    modelSetup: options.modelSetupController.buildCurrentModelSetupState(),
    askUserPrompts: Array.isArray(bootstrap.askUserPrompts) ? bootstrap.askUserPrompts : [],
    sessions: await listDisplaySessions(options.cwd, options.sessionDir),
    snapshot: {
      sessionId,
      state: projectDashboard(entries, sessionId, getSavedMarketStateSymbols()),
      entries,
      events: sessionEntriesToChatEvents(entries, {
        sessionId,
        title: sessionManager.getSessionName(),
      }),
    },
  };
}

function isSessionPersisted(sessionManager: SessionManager): boolean {
  const sessionFile = sessionManager.getSessionFile();
  return Boolean(sessionFile && existsSync(sessionFile));
}

function ownerKindForSessionBootstrap(
  options: Pick<GuiHttpRouteOptions, "getSessionManager" | "role">,
  sessionManager: SessionManager,
): string | undefined {
  if (roleForSessionBootstrap(options, sessionManager) === "writer") return "gui";
  return readWriterLock(writerLockScopeForSession(sessionManager))?.processKind;
}

function roleForSessionBootstrap(
  options: Pick<GuiHttpRouteOptions, "role" | "getSessionManager">,
  sessionManager: SessionManager,
): string {
  if (options.role !== "writer") return options.role;
  const currentSessionManager = options.getSessionManager();
  if (currentSessionManager.getSessionFile() === sessionManager.getSessionFile()) return "writer";
  const lock = readWriterLock(writerLockScopeForSession(sessionManager));
  return lock && lock.pid !== process.pid ? "follower" : "writer";
}

export async function resolveSessionManagerById(
  options: Pick<GuiHttpRouteOptions, "cwd" | "sessionDir" | "getSessionManager">,
  sessionId: string,
): Promise<SessionManager | null> {
  const currentSessionManager = options.getSessionManager();
  if (currentSessionManager.getSessionId() === sessionId) return currentSessionManager;
  const sessions = await SessionManager.list(options.cwd, options.sessionDir);
  const match = sessions.find((candidate) => candidate.id === sessionId);
  return match ? SessionManager.open(match.path, options.sessionDir, options.cwd) : null;
}

export function sessionIdFromRoute(pathname: string, action: "bootstrap" | "runs"): string {
  const match = pathname.match(new RegExp(`^/api/sessions/([^/]+)/${action}$`));
  if (!match) return "";
  try {
    return decodeURIComponent(match[1] ?? "");
  } catch {
    return "";
  }
}

export function buildChatRunActionEnvelope(
  body: Record<string, unknown>,
  sessionId: string,
): SessionActionEnvelope {
  const actionId = String(body.actionId ?? "").trim();
  const parsed = parseChatRunBody(body);
  const attachments = parsed.ok ? parsed.value.attachments : [];
  const images = parsed.ok ? parsed.value.images : [];
  return {
    sessionId,
    actionId,
    actionType: "chat.prompt",
    payload: {
      prompt: String(body.prompt ?? ""),
      ...(images.length > 0 ? { imageCount: images.length } : {}),
      ...(attachments.length > 0
        ? { attachments: attachments.map((attachment) => ({ kind: attachment.kind })) }
        : {}),
    },
    source: "browser",
  };
}

export async function buildDispatchedPrompt(parsed: ParsedChatRunBody): Promise<string> {
  const db = initDefaultDatabase();
  try {
    return buildDispatchedPromptFromState(parsed, new MarketStateService(db));
  } finally {
    db.close();
  }
}

function hasClientActionId(body: Record<string, unknown>): boolean {
  return typeof body.actionId === "string" && body.actionId.trim().length > 0;
}

function requireSessionActionFields(
  res: ServerResponse,
  body: Record<string, unknown>,
  requireSessionId = true,
): boolean {
  if (requireSessionId && !String(body.sessionId ?? "").trim()) {
    writeJson(res, { error: "sessionId is required" }, 400);
    return false;
  }
  if (!String(body.actionId ?? "").trim()) {
    writeJson(res, { error: "actionId is required" }, 400);
    return false;
  }
  return true;
}

function shouldBlockFailedCoordinatorAction(
  runSessionManager: SessionManager,
  body: Record<string, unknown>,
): boolean {
  return hasClientActionId(body) && shouldBlockFailedCoordinatorLockAction(runSessionManager);
}

/**
 * Socket-unavailable fallback for the preference deletes. It mirrors the WS
 * commands: writer-only, and it answers with the refreshed list rather than a
 * bootstrap payload, so the caller renders the result of its own mutation.
 */
function preferenceMutationLockBlocked(options: GuiHttpRouteOptions): boolean {
  try {
    return shouldBlockFailedCoordinatorLockAction(options.getSessionManager());
  } catch {
    // Fail closed: an unresolvable session lock state is not permission to
    // delete durable prompt-context data.
    return true;
  }
}

async function handleTrustedPreferencesMutation(
  req: IncomingMessage,
  res: ServerResponse,
  options: GuiHttpRouteOptions,
  mutate: (body: Record<string, unknown>) => PreferencesSnapshot,
): Promise<void> {
  // A stale server role is not enough: the current session's live writer
  // lock can belong to a TUI, and durable prompt-context data must not be
  // deleted out from under it.
  if (options.role !== "writer" || preferenceMutationLockBlocked(options)) {
    writeJson(res, { error: "OpenCandle is reconnecting to this session.", code: "syncing" }, 409);
    return;
  }
  try {
    const snapshot = mutate(asRecord(await readJsonBody(req)));
    options.wsHub.broadcast({ type: "preferences", ...snapshot });
    writeJson(res, snapshot);
  } catch (error) {
    writeJson(res, { error: error instanceof Error ? error.message : String(error) }, 400);
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
    const coordinationError = message === "Read-only follower mode";
    writeJson(
      res,
      {
        error: coordinationError ? "OpenCandle is reconnecting to this session." : message,
        ...(coordinationError ? { code: "syncing" } : {}),
      },
      coordinationError ? 409 : 400,
    );
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

function allowLocalCoordinatorRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: GuiHttpRouteOptions,
): boolean {
  if (req.headers["x-opencandle-coordinator-secret"] === options.localCoordinatorSecret) {
    return true;
  }
  res.writeHead(403, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "Local coordinator request was not authorized." }));
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
