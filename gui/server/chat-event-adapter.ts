import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import type { ChatEvent, MessageContent, ToolOutput } from "../shared/chat-events.js";

export interface SessionEventOptions {
  sessionId: string;
  title?: string;
  updatedAt?: string;
  startSeq?: number;
}

export function sessionEntriesToChatEvents(
  entries: SessionEntry[],
  options: SessionEventOptions,
): ChatEvent[] {
  let seq = options.startSeq ?? 1;
  const events: ChatEvent[] = [];
  const seenToolCalls = new Set<string>();
  // Set by an opencandle-user-input marker: the user's words before a workflow
  // transform expanded the turn. The next user message renders this instead.
  let pendingOriginalInput: string | null = null;
  const updatedAt = options.updatedAt ?? entries.at(-1)?.timestamp ?? new Date().toISOString();

  events.push({
    type: "session.updated",
    sessionId: options.sessionId,
    title: options.title,
    updatedAt,
    seq: seq++,
  });

  for (const entry of entries) {
    if (isOriginalInputEntry(entry)) {
      pendingOriginalInput = originalInputText(entry);
      continue;
    }

    if (entry.type === "custom_message") {
      const messageId = entry.id;
      events.push({
        type: "custom.message",
        messageId,
        customType: String((entry as { customType?: unknown }).customType || "custom"),
        content: [{ type: "text", text: customMessageText(entry.content) }],
        seq: seq++,
      });
      continue;
    }

    if (entry.type !== "message") continue;
    const message = entry.message as Message;
    const messageId = entry.id;

    if (message.role === "user") {
      events.push({ type: "message.created", messageId, role: "user", seq: seq++ });
      events.push({
        type: "message.completed",
        messageId,
        content: [{ type: "text", text: pendingOriginalInput ?? messageText(message.content) }],
        seq: seq++,
      });
      pendingOriginalInput = null;
      continue;
    }

    if (message.role === "assistant") {
      events.push({ type: "message.created", messageId, role: "assistant", seq: seq++ });
      const content: MessageContent[] = [];
      for (const part of Array.isArray(message.content) ? message.content : []) {
        if (part.type === "text") {
          content.push({ type: "text", text: part.text });
          continue;
        }
        if (part.type === "toolCall") {
          seenToolCalls.add(part.id);
          content.push({ type: "tool", toolCallId: part.id });
          events.push({
            type: "tool.started",
            toolCallId: part.id,
            messageId,
            name: part.name,
            input: part.arguments,
            seq: seq++,
          });
        }
        if (part.type === "image") {
          content.push({ type: "image", url: part.url });
        }
      }
      events.push({ type: "message.completed", messageId, content, seq: seq++ });
      continue;
    }

    if (message.role === "toolResult") {
      const tool = message as ToolResultMessage;
      const toolCallId = tool.toolCallId || `tool-${entry.id}`;
      if (!seenToolCalls.has(toolCallId)) {
        events.push({
          type: "tool.started",
          toolCallId,
          messageId,
          name: tool.toolName || "tool",
          input: inputFromDetails(tool.details),
          seq: seq++,
        });
      }
      events.push({
        type: tool.isError ? "tool.failed" : "tool.completed",
        toolCallId,
        ...(tool.isError
          ? { error: { message: messageText(tool.content), details: tool.details } }
          : { output: toolOutput(tool) }),
        seq: seq++,
      } as ChatEvent);
    }
  }

  return events;
}

export function isOriginalInputEntry(entry: SessionEntry): boolean {
  return entry.type === "custom" &&
    (entry as { customType?: unknown }).customType === "opencandle-user-input";
}

export function originalInputText(entry: SessionEntry): string | null {
  const data = (entry as { data?: { original?: unknown } }).data;
  return typeof data?.original === "string" && data.original.trim().length > 0 ? data.original : null;
}

function customMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  return messageText(content);
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => typeof part.text === "string" ? part.text : "")
    .join("");
}

function toolOutput(message: ToolResultMessage): ToolOutput {
  const details = message.details;
  const source = typeof details === "object" && details !== null && "source" in details
    ? String((details as { source?: unknown }).source ?? "")
    : undefined;
  return {
    content: message.content,
    details,
    isError: message.isError,
    source,
  };
}

function inputFromDetails(details: unknown): unknown {
  if (typeof details !== "object" || details === null) return undefined;
  if ("args" in details) return (details as { args?: unknown }).args;
  return undefined;
}
