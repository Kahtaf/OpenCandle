import type { InvokeToolResult } from "./invoke-tool.js";

export interface ToolInvokeAckMessage {
  type: "tool.invoke.result";
  requestId: string;
  ok: boolean;
  toolName: string;
  result?: {
    toolCallId: string;
    content: InvokeToolResult["result"]["content"];
    details: unknown;
    isError: boolean;
  };
  error?: {
    message: string;
  };
}

export function buildToolInvokeAckMessage(
  requestId: string,
  toolName: string,
  invocation: InvokeToolResult,
): ToolInvokeAckMessage {
  const message: ToolInvokeAckMessage = {
    type: "tool.invoke.result",
    requestId,
    ok: !invocation.isError,
    toolName,
    result: {
      toolCallId: invocation.toolCallId,
      content: invocation.result.content,
      details: invocation.result.details,
      isError: invocation.isError,
    },
  };
  if (invocation.isError) {
    message.error = { message: toolResultMessage(invocation) };
  }
  return message;
}

function toolResultMessage(invocation: InvokeToolResult): string {
  for (const item of invocation.result.content) {
    if (item?.type === "text" && typeof item.text === "string" && item.text.trim()) {
      return item.text.trim();
    }
  }
  return `${invocation.toolCallId} failed`;
}
