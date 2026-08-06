import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { ChatEvent, MessageAttachmentChip, MessageContent } from "./chat-events.js";
import { normalizeToolOutput } from "./tool-output.js";

export interface LiveChatEventAdapterOptions {
  runId: string;
  sessionId: string;
  startSeq: number;
  /** Optional shared allocator for interleaving Pi events with runtime events. */
  sequence?: {
    next(): number;
    peek(): number;
  };
  emit: (event: ChatEvent) => void;
  /**
   * The user's words as typed. Workflow transforms can replace the first user
   * message with an expanded prompt; the live view renders this instead.
   */
  originalPrompt?: string;
  /** Prompt sent to Pi before any workflow input transform. */
  dispatchedPrompt?: string;
  originalAttachments?: MessageAttachmentChip[];
}

export interface LiveChatEventAdapter {
  handle(event: AgentSessionEvent): void;
  nextSeq(): number;
}

export function createLiveChatEventAdapter(
  options: LiveChatEventAdapterOptions,
): LiveChatEventAdapter {
  let seq = options.startSeq;
  let userCount = 0;
  let assistantCount = 0;
  let currentAssistantMessageId: string | undefined;
  let lastAssistantMessageId: string | undefined;
  const completedMessageIds = new Set<string>();

  const emit = (event: Omit<ChatEvent, "seq" | "sessionId">) => {
    const eventSeq = options.sequence ? options.sequence.next() : seq++;
    options.emit({ ...event, sessionId: options.sessionId, seq: eventSeq } as ChatEvent);
  };

  const ensureAssistantMessage = (): string => {
    if (currentAssistantMessageId) return currentAssistantMessageId;
    currentAssistantMessageId = `${options.runId}-assistant-${++assistantCount}`;
    lastAssistantMessageId = currentAssistantMessageId;
    emit({
      type: "message.created",
      runId: options.runId,
      messageId: currentAssistantMessageId,
      role: "assistant",
    });
    return currentAssistantMessageId;
  };

  const messageIdForTool = (): string => lastAssistantMessageId ?? ensureAssistantMessage();

  const completeAssistantMessage = (message: AssistantMessage) => {
    const messageId = ensureAssistantMessage();
    if (completedMessageIds.has(messageId)) return;
    completedMessageIds.add(messageId);
    emit({
      type: "message.completed",
      runId: options.runId,
      messageId,
      content: contentToChatContent(message.content),
    });
    currentAssistantMessageId = undefined;
  };

  return {
    handle(event) {
      switch (event.type) {
        case "message_start": {
          const message = event.message as Message;
          if (message.role === "user") {
            const messageId = `${options.runId}-user-${++userCount}`;
            const promptText = messageText(message.content);
            const text =
              userCount === 1 && options.originalPrompt ? options.originalPrompt : promptText;
            const transformedFirstPrompt =
              userCount === 1 &&
              options.dispatchedPrompt !== undefined &&
              promptText.trim() !== options.dispatchedPrompt.trim();
            const workflowStep = transformedFirstPrompt || userCount > 1;
            if (userCount === 1 || !workflowStep) {
              emit({ type: "message.created", runId: options.runId, messageId, role: "user" });
              emit({
                type: "message.completed",
                runId: options.runId,
                messageId,
                content: userMessageContent(message.content, text),
                ...(userCount === 1 &&
                options.originalAttachments &&
                options.originalAttachments.length > 0
                  ? { attachments: options.originalAttachments }
                  : {}),
              });
            }
            if (workflowStep) {
              emit({
                type: "custom.message",
                messageId: `${options.runId}-workflow-step-${userCount}`,
                customType: "opencandle-workflow-step",
                content: [{ type: "text", text: promptText }],
                details: {
                  label: "Workflow step",
                  stage: "workflow",
                  step: userCount,
                },
              });
            }
            return;
          }
          if (message.role === "assistant") {
            ensureAssistantMessage();
          }
          return;
        }

        case "message_update": {
          const update = event.assistantMessageEvent;
          if (update.type === "text_delta") {
            emit({
              type: "message.delta",
              runId: options.runId,
              messageId: ensureAssistantMessage(),
              text: update.delta,
            });
          }
          if (update.type === "thinking_delta") {
            emit({
              type: "thinking.delta",
              runId: options.runId,
              text: update.delta,
            });
          }
          if (update.type === "thinking_end") {
            emit({
              type: "thinking.completed",
              runId: options.runId,
              text: update.content,
            });
          }
          return;
        }

        case "message_end": {
          const message = event.message as Message;
          if (message.role === "assistant") completeAssistantMessage(message);
          return;
        }

        case "tool_execution_start": {
          const messageId = messageIdForTool();
          emit({
            type: "tool.started",
            runId: options.runId,
            toolCallId: event.toolCallId,
            messageId,
            name: event.toolName,
            input: event.args,
          });
          return;
        }

        case "tool_execution_update":
          emit({
            type: "tool.delta",
            runId: options.runId,
            toolCallId: event.toolCallId,
            chunk: event.partialResult,
          });
          return;

        case "tool_execution_end": {
          const result = asRecord(event.result);
          const output = normalizeToolOutput({
            content: result.content,
            details: result.details,
            isError: event.isError,
          });
          if (event.isError) {
            emit({
              type: "tool.failed",
              runId: options.runId,
              toolCallId: event.toolCallId,
              error: {
                message: messageText(output.content),
                details: output.details,
              },
            });
          } else {
            emit({
              type: "tool.completed",
              runId: options.runId,
              toolCallId: event.toolCallId,
              output,
            });
          }
          return;
        }
      }
    },
    nextSeq() {
      return options.sequence ? options.sequence.peek() : seq;
    },
  };
}

function contentToChatContent(content: AssistantMessage["content"]): MessageContent[] {
  return content.flatMap((part): MessageContent[] => {
    if (part.type === "text") return [{ type: "text", text: part.text }];
    if (part.type === "toolCall") return [{ type: "tool", toolCallId: part.id }];
    return [];
  });
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) =>
      typeof part === "object" && part !== null && "text" in part && typeof part.text === "string"
        ? part.text
        : "",
    )
    .join("");
}

function userMessageContent(content: unknown, text: string): MessageContent[] {
  const parts: MessageContent[] = [{ type: "text", text }];
  if (!Array.isArray(content)) return parts;
  for (const part of content) {
    const record = asRecord(part);
    if (record.type !== "image") continue;
    const alt = typeof record.alt === "string" ? record.alt : undefined;
    if (typeof record.url === "string") {
      parts.push({ type: "image", url: record.url, alt });
      continue;
    }
    if (typeof record.data === "string" && typeof record.mimeType === "string") {
      parts.push({
        type: "image",
        url: `data:${record.mimeType};base64,${record.data}`,
        data: record.data,
        mimeType: record.mimeType,
        alt,
      });
    }
  }
  return parts;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
