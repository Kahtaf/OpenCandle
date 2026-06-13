import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message, ToolCall, Usage } from "@earendil-works/pi-ai";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { getDefaults } from "../../src/memory/tool-defaults.js";
import { wrapWithDefaults } from "../../src/runtime/tool-defaults-wrapper.js";
import { getAllTools } from "../../src/tools/index.js";
import { buildToolInvokeAckMessage } from "./tool-invoke-ack.js";

export interface InvokeToolResult {
  toolCallId: string;
  result: AgentToolResult<unknown>;
  isError: boolean;
}

interface ToolInvokeClient {
  send(message: unknown): void;
}

export interface ToolInvokeController {
  handleToolInvoke(toolName: string, args: Record<string, unknown>): Promise<InvokeToolResult>;
  handleToolInvokeMessage(client: ToolInvokeClient, data: Record<string, unknown>): Promise<void>;
}

export interface ToolInvokeControllerOptions {
  role: string;
  getSessionManager: () => SessionManager;
  broadcastState: () => void;
  getTools?: typeof getAllTools;
  invokeTool?: typeof invokeToolFromUi;
}

export function createToolInvokeController({
  role,
  getSessionManager,
  broadcastState,
  getTools = getAllTools,
  invokeTool = invokeToolFromUi,
}: ToolInvokeControllerOptions): ToolInvokeController {
  async function handleToolInvoke(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<InvokeToolResult> {
    if (role !== "writer") throw new Error("Read-only follower mode");
    const tool = getTools().find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`Unknown tool: ${toolName}`);
    const result = await invokeTool(getSessionManager(), tool, args, "ui");
    broadcastState();
    return result;
  }

  async function handleToolInvokeMessage(
    client: ToolInvokeClient,
    data: Record<string, unknown>,
  ): Promise<void> {
    const requestId = typeof data.requestId === "string" ? data.requestId : "";
    const toolName = String(data.toolName ?? "");
    try {
      const result = await handleToolInvoke(toolName, requestArgs(data.args));
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

function requestArgs(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export async function invokeToolFromUi(
  sessionManager: SessionManager,
  tool: AgentTool<TSchema, unknown>,
  args: Record<string, unknown>,
  source: "ui" | "background" = "ui",
  options: { recordTranscript?: boolean } = {},
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
    result = await wrapped.execute(toolCallId, args as never);
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
