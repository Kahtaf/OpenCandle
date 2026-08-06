import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message, ToolCall, Usage } from "@earendil-works/pi-ai";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";
import type { AskUserHandler } from "../../src/types/index.js";
import { assertValidToolArguments } from "./tool-argument-validation.js";

export interface InvokeToolResult {
  toolCallId: string;
  result: AgentToolResult<unknown>;
  isError: boolean;
}

/**
 * Runs a user-initiated tool and records the same Pi transcript entries that
 * the model runtime emits for a tool call. Both local and hosted GUI paths use
 * this so direct catalog runs render as durable chat cards.
 */
export async function invokeToolFromUi(
  sessionManager: SessionManager,
  tool: AgentTool<TSchema, unknown>,
  args: Record<string, unknown>,
  source: "ui" | "background" = "ui",
  options: {
    askUserHandler?: AskUserHandler;
    recordTranscript?: boolean;
    onTranscriptStarted?: () => void;
    toolResultDetails?: (result: AgentToolResult<unknown>) => Record<string, unknown>;
  } = {},
): Promise<InvokeToolResult> {
  assertValidToolArguments(tool.parameters, args);

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
    options.onTranscriptStarted?.();
  }

  let result: AgentToolResult<unknown>;
  let isError = false;
  try {
    result = await (
      tool.execute as (
        id: string,
        params: never,
        signal: AbortSignal | undefined,
        onUpdate: undefined,
        ctx: { askUserHandler?: AskUserHandler; hasUI: false },
      ) => ReturnType<typeof tool.execute>
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
        ...options.toolResultDetails?.(result),
      },
      isError,
      timestamp: Date.now(),
    });
  }

  return { toolCallId, result, isError };
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
