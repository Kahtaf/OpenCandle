import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ChatEvent, MessageContent, ToolOutput } from "../shared/chat-events.js";

export interface SessionEventOptions {
  sessionId: string;
  title?: string;
  updatedAt?: string;
  startSeq?: number;
  markUnresolvedToolCalls?: boolean;
}

export function sessionEntriesToChatEvents(
  entries: SessionEntry[],
  options: SessionEventOptions,
): ChatEvent[] {
  let seq = options.startSeq ?? 1;
  const events: ChatEvent[] = [];
  const seenToolCalls = new Set<string>();
  const resolvedToolCalls = new Set<string>();
  const pendingToolCalls = new Map<string, { name: string }>();
  // Set by an opencandle-user-input marker: the user's words before a workflow
  // transform expanded the turn. The next user message renders this instead.
  let pendingOriginalInput: string | null = null;
  let pendingOriginalAttachments: Array<{ kind: string; label: string }> = [];
  let lastEntryWasUserMessage = false;
  let lastUserCompletedEventIndex: number | null = null;
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
      const originalInput = originalInputText(entry);
      const originalAttachments = originalInputAttachments(entry);
      if (lastEntryWasUserMessage && lastUserCompletedEventIndex != null) {
        applyOriginalInput(events[lastUserCompletedEventIndex], originalInput, originalAttachments);
      } else {
        pendingOriginalInput = originalInput;
        pendingOriginalAttachments = originalAttachments;
      }
      lastEntryWasUserMessage = false;
      continue;
    }

    if (entry.type === "custom_message") {
      lastEntryWasUserMessage = false;
      const messageId = entry.id;
      events.push({
        type: "custom.message",
        sessionId: options.sessionId,
        messageId,
        customType: String((entry as { customType?: unknown }).customType || "custom"),
        content: [{ type: "text", text: customMessageText(entry.content) }],
        details: (entry as { details?: unknown }).details,
        seq: seq++,
      });
      continue;
    }

    if (entry.type !== "message") {
      lastEntryWasUserMessage = false;
      continue;
    }
    const message = entry.message as Message;
    const messageId = entry.id;

    if (message.role === "user") {
      events.push({
        type: "message.created",
        sessionId: options.sessionId,
        messageId,
        role: "user",
        seq: seq++,
      });
      const completedEvent: ChatEvent = {
        type: "message.completed",
        sessionId: options.sessionId,
        messageId,
        content: userMessageContent(message.content, pendingOriginalInput),
        ...(pendingOriginalAttachments.length > 0
          ? { attachments: pendingOriginalAttachments }
          : {}),
        seq: seq++,
      };
      events.push(completedEvent);
      lastUserCompletedEventIndex = events.length - 1;
      lastEntryWasUserMessage = true;
      pendingOriginalInput = null;
      pendingOriginalAttachments = [];
      continue;
    }

    if (message.role === "assistant") {
      lastEntryWasUserMessage = false;
      events.push({
        type: "message.created",
        sessionId: options.sessionId,
        messageId,
        role: "assistant",
        seq: seq++,
      });
      const content: MessageContent[] = [];
      for (const part of Array.isArray(message.content) ? message.content : []) {
        if (part.type === "text") {
          content.push({ type: "text", text: part.text });
          continue;
        }
        if (part.type === "toolCall") {
          seenToolCalls.add(part.id);
          pendingToolCalls.set(part.id, { name: part.name });
          content.push({ type: "tool", toolCallId: part.id });
          events.push({
            type: "tool.started",
            sessionId: options.sessionId,
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
      events.push({
        type: "message.completed",
        sessionId: options.sessionId,
        messageId,
        content,
        seq: seq++,
      });
      continue;
    }

    if (message.role === "toolResult") {
      lastEntryWasUserMessage = false;
      const tool = message as ToolResultMessage;
      const toolCallId = tool.toolCallId || `tool-${entry.id}`;
      resolvedToolCalls.add(toolCallId);
      pendingToolCalls.delete(toolCallId);
      if (!seenToolCalls.has(toolCallId)) {
        events.push({
          type: "tool.started",
          sessionId: options.sessionId,
          toolCallId,
          messageId,
          name: tool.toolName || "tool",
          input: inputFromDetails(tool.details),
          seq: seq++,
        });
      }
      events.push({
        type: tool.isError ? "tool.failed" : "tool.completed",
        sessionId: options.sessionId,
        toolCallId,
        ...(tool.isError
          ? { error: { message: messageText(tool.content), details: tool.details } }
          : { output: toolOutput(tool) }),
        seq: seq++,
      } as ChatEvent);
    }
  }

  if (options.markUnresolvedToolCalls !== false) {
    for (const [toolCallId, tool] of pendingToolCalls) {
      if (resolvedToolCalls.has(toolCallId)) continue;
      events.push({
        type: "tool.failed",
        sessionId: options.sessionId,
        toolCallId,
        error: {
          message:
            "Tool call did not finish. The run may have been interrupted before OpenCandle received a tool result.",
          details: { toolName: tool.name, reason: "missing_tool_result" },
        },
        seq: seq++,
      });
    }
  }

  return events;
}

function applyOriginalInput(
  event: ChatEvent | undefined,
  originalInput: string | null,
  attachments: Array<{ kind: string; label: string }>,
): void {
  if (event?.type !== "message.completed") return;
  if (originalInput) {
    event.content = userMessageContent(event.content, originalInput);
  }
  if (attachments.length > 0) {
    event.attachments = attachments;
  }
}

export function isOriginalInputEntry(entry: SessionEntry): boolean {
  return (
    entry.type === "custom" &&
    (entry as { customType?: unknown }).customType === "opencandle-user-input"
  );
}

export function originalInputText(entry: SessionEntry): string | null {
  const data = (entry as { data?: { original?: unknown } }).data;
  return typeof data?.original === "string" && data.original.trim().length > 0
    ? data.original
    : null;
}

export function originalInputAttachments(
  entry: SessionEntry,
): Array<{ kind: string; label: string }> {
  const data = (entry as { data?: { attachments?: unknown } }).data;
  if (!Array.isArray(data?.attachments)) return [];
  return data.attachments
    .map((attachment) => {
      if (typeof attachment !== "object" || attachment === null) return null;
      const kind = String((attachment as { kind?: unknown }).kind ?? "").trim();
      const label = String((attachment as { label?: unknown }).label ?? "").trim();
      return kind && label ? { kind, label } : null;
    })
    .filter((attachment): attachment is { kind: string; label: string } => attachment != null);
}

function customMessageText(content: unknown): string {
  if (typeof content === "string") return content;
  return messageText(content);
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => (typeof part.text === "string" ? part.text : "")).join("");
}

function userMessageContent(content: unknown, originalText: string | null): MessageContent[] {
  const parts: MessageContent[] = [{ type: "text", text: originalText ?? messageText(content) }];
  if (!Array.isArray(content)) return parts;
  for (const part of content) {
    if (part?.type !== "image") continue;
    if (typeof part.url === "string") {
      parts.push({ type: "image", url: part.url, alt: imageAlt(part) });
      continue;
    }
    if (typeof part.data === "string" && typeof part.mimeType === "string") {
      parts.push({
        type: "image",
        url: `data:${part.mimeType};base64,${part.data}`,
        data: part.data,
        mimeType: part.mimeType,
        alt: imageAlt(part),
      });
    }
  }
  return parts;
}

function imageAlt(part: unknown): string | undefined {
  return typeof part === "object" &&
    part !== null &&
    "alt" in part &&
    typeof (part as { alt?: unknown }).alt === "string"
    ? (part as { alt: string }).alt
    : undefined;
}

function toolOutput(message: ToolResultMessage): ToolOutput {
  const details = message.details;
  const source =
    typeof details === "object" && details !== null && "source" in details
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
