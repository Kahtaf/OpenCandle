import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message, ToolCall, Usage } from "@earendil-works/pi-ai";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { getDefaults } from "../../src/memory/tool-defaults.js";
import { wrapWithDefaults } from "../../src/runtime/tool-defaults-wrapper.js";
import { getAllTools } from "../../src/tools/index.js";
import type { AskUserHandler } from "../../src/types/index.js";
import type { LocalSessionCoordinator } from "./local-session-coordinator.js";
import { buildToolInvokeAckMessage } from "./tool-invoke-ack.js";
import {
  acquireWriterLock,
  refreshWriterLock,
  releaseWriterLock,
  writerLockScopeForSession,
} from "./writer-lock.js";

export interface InvokeToolResult {
  toolCallId: string;
  result: AgentToolResult<unknown>;
  isError: boolean;
}

interface ToolInvokeClient {
  send(message: unknown): void;
}

export interface ToolInvokeController {
  handleToolInvoke(
    toolName: string,
    args: Record<string, unknown>,
    sessionId?: string,
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
}: ToolInvokeControllerOptions): ToolInvokeController {
  async function handleToolInvoke(
    toolName: string,
    args: Record<string, unknown>,
    sessionId = "",
  ): Promise<InvokeToolResult> {
    if (role !== "writer") throw new Error("Read-only follower mode");
    const tool = getTools().find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`Unknown tool: ${toolName}`);

    const currentSessionManager = getSessionManager();
    const runSessionManager = await resolveToolInvokeSessionManager(
      currentSessionManager,
      sessionId,
      resolveSessionManager,
    );
    const useCurrentSession = sameSessionStorage(currentSessionManager, runSessionManager);
    let acquiredLockScope = "";
    let lockHeartbeat: ReturnType<typeof setInterval> | undefined;
    if (!useCurrentSession) {
      const lockScope = writerLockScopeForSession(runSessionManager);
      const lockResult = await acquireWriterLock(lockScope, "gui");
      if (lockResult.role !== "writer") {
        throw new Error(
          `Session is currently being written by ${lockResult.lock.processKind} (pid ${lockResult.lock.pid}).`,
        );
      }
      acquiredLockScope = lockScope;
      lockHeartbeat = setInterval(() => refreshWriterLock(lockScope), 5000);
    }

    try {
      const runSessionId = safeSessionId(runSessionManager);
      const result = await invokeTool(runSessionManager, tool, args, "ui", {
        askUserHandler:
          runSessionId && askUserHandlerForSessionId
            ? askUserHandlerForSessionId(runSessionId)
            : askUserHandler,
      });
      if (!result.isError && marketStateToolMapping(toolName) != null) {
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
    try {
      const invoke = () => handleToolInvoke(toolName, requestArgs(data.args), sessionId);
      const actionResult =
        localSessionCoordinator && actionId
          ? await localSessionCoordinator.runSessionAction(
              {
                sessionId: sessionId || safeSessionId(getSessionManager()),
                actionId,
                actionType: "tool.invoke",
                payload: { toolName, args: requestArgs(data.args) },
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
  options: { askUserHandler?: AskUserHandler; recordTranscript?: boolean } = {},
): Promise<InvokeToolResult> {
  if (!Value.Check(tool.parameters, args)) {
    const errors = [...Value.Errors(tool.parameters, args)]
      .map((error) => `${error.path || "/"} ${error.message}`)
      .join("; ");
    throw new Error(errors || "Invalid tool arguments");
  }

  const toolCallId = `${source}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const call: ToolCall = {
    type: "toolCall",
    id: toolCallId,
    name: tool.name,
    arguments: args,
  };
  const assistant = {
    role: "assistant",
    content: [call],
    api: "openai-responses",
    provider: "openai",
    model: "ui-direct",
    usage: emptyUsage(),
    stopReason: "toolUse",
    timestamp: Date.now(),
  } satisfies Message;

  const recordTranscript = options.recordTranscript ?? true;
  if (recordTranscript) {
    sessionManager.appendMessage(assistant);
  }

  const wrapped = wrapWithDefaults(tool, getDefaults(tool.name));
  let result: AgentToolResult<unknown>;
  let isError = false;
  try {
    result = await (
      wrapped.execute as (
        id: string,
        params: never,
        signal: AbortSignal | undefined,
        onUpdate: undefined,
        ctx: { askUserHandler?: AskUserHandler; hasUI: false },
      ) => ReturnType<typeof wrapped.execute>
    )(toolCallId, args as never, undefined, undefined, {
      askUserHandler: options.askUserHandler,
      hasUI: false,
    });
  } catch (error) {
    isError = true;
    result = {
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      details: null,
    };
  }

  if (recordTranscript) {
    sessionManager.appendMessage({
      role: "toolResult",
      toolCallId,
      toolName: tool.name,
      content: result.content,
      details: {
        source,
        args,
        value: result.details,
        ...stateChangeDetails(tool.name, args, result.details, source),
      },
      isError,
      timestamp: Date.now(),
    });
  }

  return { toolCallId, result, isError };
}

function stateChangeDetails(
  toolName: string,
  args: Record<string, unknown>,
  value: unknown,
  source: "ui" | "background",
): { stateChange: Record<string, unknown> } | Record<string, never> {
  const mapping = marketStateToolMapping(toolName);
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

function marketStateToolMapping(toolName: string): { domain: string; targetType: string } | null {
  switch (toolName) {
    case "manage_watchlist":
      return { domain: "watchlist", targetType: "watchlist_item" };
    case "track_portfolio":
      return { domain: "portfolio", targetType: "portfolio_lot" };
    case "track_prediction":
      return { domain: "predictions", targetType: "prediction" };
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

function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
