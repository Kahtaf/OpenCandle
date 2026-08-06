import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";
import { getDefaults } from "../../src/memory/tool-defaults.js";
import {
  clearPendingSessionAction,
  hasAcceptedSessionAction,
  hasPendingSessionAction,
  recordAcceptedSessionAction,
  recordPendingSessionAction,
} from "../../src/pi/session-action-dedupe.js";
import { wrapWithDefaults } from "../../src/runtime/tool-defaults-wrapper.js";
import { getAllTools } from "../../src/tools/index.js";
import type { AskUserHandler } from "../../src/types/index.js";
import {
  type InvokeToolResult,
  invokeToolFromUi as invokeToolFromUiShared,
} from "../shared/invoke-tool-from-ui.js";
import type { LocalSessionCoordinator } from "./local-session-coordinator.js";
import { buildToolInvokeAckMessage } from "./tool-invoke-ack.js";
import {
  acquireWriterLock,
  readWriterLock,
  refreshWriterLock,
  releaseWriterLock,
  shouldBlockFailedCoordinatorAction,
  writerLockScopeForSession,
} from "./writer-lock.js";

export type { InvokeToolResult } from "../shared/invoke-tool-from-ui.js";

interface ToolInvokeClient {
  send(message: unknown): void;
}

export interface ToolInvokeController {
  handleToolInvoke(
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string,
    options?: { actionId?: string; allowProxy?: boolean; recordTranscript?: boolean },
  ): Promise<InvokeToolResult>;
  handleToolInvokeMessage(client: ToolInvokeClient, data: Record<string, unknown>): Promise<void>;
}

export interface ToolInvokeControllerOptions {
  role: string;
  getSessionManager: () => SessionManager;
  broadcastState: () => void;
  onMarketStateChanged?: () => void;
  getTools?: typeof getAllTools;
  invokeTool?: typeof invokeToolFromUi;
  askUserHandler?: AskUserHandler;
  askUserHandlerForSessionId?: (sessionId: string) => AskUserHandler;
  resolveSessionManager?: (sessionId: string) => Promise<SessionManager | null>;
  broadcastSessionSnapshot?: (sessionManager: SessionManager) => void;
  broadcastSessions?: () => void;
  localSessionCoordinator?: LocalSessionCoordinator;
  localCoordinatorEndpoint?: string;
  localCoordinatorSecret?: string;
  syncWriterLockScope?: () => void;
}

export function createToolInvokeController({
  role,
  getSessionManager,
  broadcastState,
  onMarketStateChanged,
  getTools = getAllTools,
  invokeTool = invokeToolFromUi,
  askUserHandler,
  askUserHandlerForSessionId,
  resolveSessionManager,
  broadcastSessionSnapshot,
  broadcastSessions,
  localSessionCoordinator,
  localCoordinatorEndpoint,
  localCoordinatorSecret,
  syncWriterLockScope,
}: ToolInvokeControllerOptions): ToolInvokeController {
  async function handleToolInvoke(
    toolName: string,
    args: Record<string, unknown>,
    sessionId = "",
    options: { actionId?: string; allowProxy?: boolean; recordTranscript?: boolean } = {},
  ): Promise<InvokeToolResult> {
    const tool = getTools().find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`Unknown tool: ${toolName}`);

    const currentSessionManager = getSessionManager();
    const runSessionManager = await resolveToolInvokeSessionManager(
      currentSessionManager,
      sessionId,
      resolveSessionManager,
    );
    const useCurrentSession = sameSessionStorage(currentSessionManager, runSessionManager);
    const allowProxy = options.allowProxy !== false;
    const shouldProxyToolInvoke =
      allowProxy &&
      (role !== "writer" || !useCurrentSession) &&
      canProxyToolInvokeToCoordinator(runSessionManager);
    if (shouldProxyToolInvoke) {
      const proxied = await proxyToolInvokeToCoordinator(
        runSessionManager,
        toolName,
        args,
        options.actionId,
        options.recordTranscript,
      );
      if (proxied) return proxied;
      if (options.actionId && hasAcceptedSessionAction(runSessionManager, options.actionId)) {
        throw new Error("OpenCandle already accepted this action in the active session.");
      }
      if (options.actionId && hasPendingSessionAction(runSessionManager, options.actionId)) {
        throw new Error("OpenCandle is reconnecting to this session.");
      }
      if (options.actionId && shouldBlockFailedCoordinatorAction(runSessionManager)) {
        throw new Error("OpenCandle is reconnecting to this session.");
      }
    }
    if (options.actionId && hasAcceptedSessionAction(runSessionManager, options.actionId)) {
      throw new Error("OpenCandle already accepted this action in the active session.");
    }
    if (options.actionId && hasPendingSessionAction(runSessionManager, options.actionId)) {
      throw new Error("OpenCandle is reconnecting to this session.");
    }
    let acquiredLockScope = "";
    let lockHeartbeat: ReturnType<typeof setInterval> | undefined;
    const needsWriterLock = !useCurrentSession || role !== "writer";
    // The writer fast path must fail closed like chat runs when this process
    // lost its lock scope migration, or it can double-write to a session
    // another process now owns.
    if (!needsWriterLock) syncWriterLockScope?.();
    if (needsWriterLock) {
      const lockScope = writerLockScopeForSession(runSessionManager);
      const lockResult = await acquireWriterLock(lockScope, "gui", {
        coordinatorEndpoint: localCoordinatorEndpoint,
        coordinatorSecret: localCoordinatorSecret,
      });
      if (lockResult.role !== "writer") {
        throw new Error("OpenCandle is reconnecting to this session.");
      }
      acquiredLockScope = lockScope;
      lockHeartbeat = setInterval(() => refreshWriterLock(lockScope), 5000);
    }

    try {
      const runSessionId = safeSessionId(runSessionManager);
      recordPendingSessionAction(runSessionManager, options.actionId ?? "");
      let actionAccepted = false;
      const recordAcceptedAction = () => {
        if (actionAccepted) return;
        recordAcceptedSessionAction(runSessionManager, options.actionId ?? "");
        actionAccepted = true;
      };
      let result: InvokeToolResult;
      try {
        result = await invokeTool(runSessionManager, tool, args, "ui", {
          askUserHandler:
            runSessionId && askUserHandlerForSessionId
              ? askUserHandlerForSessionId(runSessionId)
              : askUserHandler,
          onTranscriptStarted: recordAcceptedAction,
          recordTranscript: options.recordTranscript,
        });
      } catch (error) {
        if (!actionAccepted) clearPendingSessionAction(runSessionManager, options.actionId ?? "");
        throw error;
      }
      recordAcceptedAction();
      if (!result.isError && marketStateToolMapping(toolName, args) != null) {
        onMarketStateChanged?.();
      }
      if (useCurrentSession) {
        broadcastState();
      } else {
        broadcastSessionSnapshot?.(runSessionManager);
        broadcastSessions?.();
      }
      return result;
    } finally {
      if (lockHeartbeat) clearInterval(lockHeartbeat);
      if (acquiredLockScope) releaseWriterLock(acquiredLockScope);
    }
  }

  async function handleToolInvokeMessage(
    client: ToolInvokeClient,
    data: Record<string, unknown>,
  ): Promise<void> {
    const requestId = typeof data.requestId === "string" ? data.requestId : "";
    const actionId = typeof data.actionId === "string" ? data.actionId : "";
    const toolName = String(data.toolName ?? "");
    const sessionId = typeof data.sessionId === "string" ? data.sessionId : "";
    const allowProxy = data.allowProxy !== false;
    try {
      if (!sessionId.trim()) throw new Error("sessionId is required");
      if (!actionId.trim()) throw new Error("actionId is required");
      const recordTranscript = data.recordTranscript === false ? false : undefined;
      const invoke = () =>
        handleToolInvoke(toolName, requestArgs(data.args), sessionId, {
          actionId,
          allowProxy,
          recordTranscript,
        });
      const actionResult = localSessionCoordinator
        ? await localSessionCoordinator.runSessionAction(
            {
              sessionId,
              actionId,
              actionType: "tool.invoke",
              payload: {
                toolName,
                args: requestArgs(data.args),
                ...(recordTranscript === false ? { recordTranscript: false } : {}),
              },
              source: "browser",
            },
            invoke,
          )
        : await invoke().then((result) => ({ ok: true as const, duplicate: false, result }));
      if (!actionResult.ok) throw new Error(actionResult.message);
      const result = actionResult.result;
      if (requestId) {
        client.send(buildToolInvokeAckMessage(requestId, toolName, result));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (requestId) {
        client.send({
          type: "tool.invoke.result",
          requestId,
          ok: false,
          toolName,
          error: { message },
        });
        return;
      }
      throw error;
    }
  }

  return { handleToolInvoke, handleToolInvokeMessage };
}

export function canProxyToolInvokeToCoordinator(runSessionManager: SessionManager): boolean {
  let lockScope: string;
  try {
    lockScope = writerLockScopeForSession(runSessionManager);
  } catch {
    return false;
  }
  const lock = readWriterLock(lockScope);
  return Boolean(
    lock?.processKind === "gui" &&
      lock.coordinatorEndpoint &&
      lock.coordinatorSecret &&
      lock.pid !== process.pid,
  );
}

async function proxyToolInvokeToCoordinator(
  runSessionManager: SessionManager,
  toolName: string,
  args: Record<string, unknown>,
  actionId = "",
  recordTranscript: boolean | undefined = undefined,
): Promise<InvokeToolResult | null> {
  const lock = readWriterLock(writerLockScopeForSession(runSessionManager));
  if (!lock?.coordinatorEndpoint || !lock.coordinatorSecret) return null;
  const endpoint = new URL("/api/local-coordinator/tool-invoke", lock.coordinatorEndpoint);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-opencandle-coordinator-secret": lock.coordinatorSecret,
      },
      body: JSON.stringify({
        sessionId: safeSessionId(runSessionManager),
        actionId,
        toolName,
        args,
        ...(recordTranscript === false ? { recordTranscript: false } : {}),
      }),
    });
  } catch {
    return null;
  }
  const body = asRecord(await response.json());
  const ackResult = asRecord(body.result);
  if (!response.ok || !ackResult.toolCallId) {
    throw new Error(String(body.error ?? "OpenCandle is reconnecting to this session."));
  }
  return {
    toolCallId: String(ackResult.toolCallId),
    result: {
      content: Array.isArray(ackResult.content) ? ackResult.content : [],
      details: ackResult.details,
    },
    isError: Boolean(ackResult.isError),
  };
}

function sameSessionStorage(current: SessionManager, target: SessionManager): boolean {
  if (current === target) return true;
  const currentFile = safeSessionFile(current);
  const targetFile = safeSessionFile(target);
  return Boolean(currentFile && targetFile && currentFile === targetFile);
}

function safeSessionFile(sessionManager: SessionManager): string {
  try {
    return sessionManager.getSessionFile() ?? "";
  } catch {
    return "";
  }
}

function safeSessionId(sessionManager: SessionManager): string {
  try {
    return sessionManager.getSessionId();
  } catch {
    return "";
  }
}

async function resolveToolInvokeSessionManager(
  currentSessionManager: SessionManager,
  sessionId: string,
  resolveSessionManager: ((sessionId: string) => Promise<SessionManager | null>) | undefined,
): Promise<SessionManager> {
  const targetSessionId = sessionId.trim();
  if (!targetSessionId || targetSessionId === safeSessionId(currentSessionManager)) {
    return currentSessionManager;
  }
  const resolved = await resolveSessionManager?.(targetSessionId);
  if (!resolved) throw new Error("Unknown saved session");
  return resolved;
}

function requestArgs(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export async function invokeToolFromUi(
  sessionManager: SessionManager,
  tool: AgentTool<TSchema, unknown>,
  args: Record<string, unknown>,
  source: "ui" | "background" = "ui",
  options: {
    askUserHandler?: AskUserHandler;
    recordTranscript?: boolean;
    onTranscriptStarted?: () => void;
  } = {},
): Promise<InvokeToolResult> {
  return invokeToolFromUiShared(
    sessionManager,
    wrapWithDefaults(tool, getDefaults(tool.name)),
    args,
    source,
    {
      ...options,
      toolResultDetails: (result) => stateChangeDetails(tool.name, args, result.details, source),
    },
  );
}

function stateChangeDetails(
  toolName: string,
  args: Record<string, unknown>,
  value: unknown,
  source: "ui" | "background",
): { stateChange: Record<string, unknown> } | Record<string, never> {
  const mapping = marketStateToolMapping(toolName, args);
  if (mapping == null) return {};

  const valueRecord = asRecord(value);
  return {
    stateChange: {
      source,
      domain: mapping.domain,
      action: typeof args.action === "string" ? args.action : "invoke",
      targetType: mapping.targetType,
      targetId: numericField(valueRecord, "id"),
      targetIds: numericArrayField(valueRecord, "removedLotIds"),
      instrumentId: numericField(valueRecord, "instrumentId"),
      instrumentIds: numericArrayField(valueRecord, "instrumentIds"),
      toolName,
    },
  };
}

function marketStateToolMapping(
  toolName: string,
  args: Record<string, unknown>,
): { domain: string; targetType: string } | null {
  switch (toolName) {
    case "manage_watchlist":
      if (args.action === "create" || args.action === "rename") {
        return { domain: "watchlist", targetType: "watchlist" };
      }
      return { domain: "watchlist", targetType: "watchlist_item" };
    case "track_portfolio":
      if (args.action === "create" || args.action === "rename") {
        return { domain: "portfolio", targetType: "portfolio" };
      }
      return { domain: "portfolio", targetType: "portfolio_lot" };
    case "manage_alerts":
      return { domain: "alerts", targetType: "alert_rule" };
    case "daily_watchlist_report":
      return { domain: "reports", targetType: "report_run" };
    default:
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function numericField(record: Record<string, unknown> | null, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
}

function numericArrayField(
  record: Record<string, unknown> | null,
  key: string,
): number[] | undefined {
  const value = record?.[key];
  if (!Array.isArray(value)) return undefined;
  const numbers = value.filter((item): item is number => typeof item === "number");
  return numbers.length > 0 ? numbers : undefined;
}
