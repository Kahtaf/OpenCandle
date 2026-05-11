import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { ChatEvent, MessageContent, ToolOutput } from "../shared/chat-events.js";

export interface LiveChatEventAdapterOptions {
  runId: string;
  sessionId: string;
  startSeq: number;
  emit: (event: ChatEvent) => void;
}

export interface LiveChatEventAdapter {
  handle(event: AgentSessionEvent): void;
  nextSeq(): number;
}

export function createLiveChatEventAdapter(options: LiveChatEventAdapterOptions): LiveChatEventAdapter {
  let seq = options.startSeq;
  let userCount = 0;
  let assistantCount = 0;
  let currentAssistantMessageId: string | undefined;
  let lastAssistantMessageId: string | undefined;
  const completedMessageIds = new Set<string>();

  const emit = (event: Omit<ChatEvent, "seq">) => {
    options.emit({ ...event, seq: seq++ } as ChatEvent);
  };

  const ensureAssistantMessage = (): string => {
    if (currentAssistantMessageId) return currentAssistantMessageId;
    currentAssistantMessageId = `${options.runId}-assistant-${++assistantCount}`;
    lastAssistantMessageId = currentAssistantMessageId;
    emit({ type: "message.created", messageId: currentAssistantMessageId, role: "assistant" });
    return currentAssistantMessageId;
  };

  const messageIdForTool = (): string => lastAssistantMessageId ?? ensureAssistantMessage();

  const completeAssistantMessage = (message: AssistantMessage) => {
    const messageId = ensureAssistantMessage();
    if (completedMessageIds.has(messageId)) return;
    completedMessageIds.add(messageId);
    emit({
      type: "message.completed",
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
            emit({ type: "message.created", messageId, role: "user" });
            emit({
              type: "message.completed",
              messageId,
              content: [{ type: "text", text: messageText(message.content) }],
            });
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
              messageId: ensureAssistantMessage(),
              text: update.delta,
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
            toolCallId: event.toolCallId,
            chunk: event.partialResult,
          });
          return;

        case "tool_execution_end": {
          const output = toolOutput(event.result, event.isError);
          if (event.isError) {
            emit({
              type: "tool.failed",
              toolCallId: event.toolCallId,
              error: {
                message: messageText(output.content),
                details: output.details,
              },
            });
          } else {
            emit({
              type: "tool.completed",
              toolCallId: event.toolCallId,
              output,
            });
          }
          return;
        }
      }
    },
    nextSeq() {
      return seq;
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
    .map((part) => typeof part === "object" && part !== null && "text" in part && typeof part.text === "string" ? part.text : "")
    .join("");
}

function toolOutput(result: unknown, isError: boolean): ToolOutput {
  const record = asRecord(result);
  return {
    content: Array.isArray(record.content) ? record.content as ToolOutput["content"] : [],
    details: record.details,
    isError,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
