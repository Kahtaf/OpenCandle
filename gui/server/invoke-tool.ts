import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { Message, ToolCall, Usage } from "@earendil-works/pi-ai";
import type { SessionManager } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { getDefaults } from "../../src/memory/tool-defaults.js";
import { wrapWithDefaults } from "../../src/runtime/tool-defaults-wrapper.js";

export interface InvokeToolResult {
  toolCallId: string;
  result: AgentToolResult<unknown>;
  isError: boolean;
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
      details: { source, args, value: result.details },
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
