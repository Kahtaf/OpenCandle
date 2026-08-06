import { reduceChatEvents } from "../../../../shared/event-reducer.ts";
import { textContent } from "../../rendering/text.js";

export function chatRowsFromEvents(events = [], liveEvents = [], defaultSessionId = "") {
  const state = reduceChatEvents(mergeChatEvents(events, liveEvents));
  const toolsByMessage = groupToolsByMessage([...state.tools.values()]);
  const rows = [];

  for (const message of state.messages) {
    const tools = toolsByMessage.get(message.id) || [];
    const sessionId = message.sessionId || defaultSessionId || "";
    if (message.customType) {
      rows.push({
        type: "custom_message",
        id: `message-${message.id}`,
        messageId: message.id,
        sessionId,
        customType: message.customType,
        content: message.content,
        details: message.details,
      });
      continue;
    }

    if (message.role === "user") {
      rows.push({
        type: "user_message",
        id: `message-${message.id}`,
        messageId: message.id,
        sessionId,
        content: message.content,
        attachments: message.attachments || [],
        delivery: isOptimisticMessageId(message.id) ? "queued" : "sent",
      });
      continue;
    }

    if (message.role === "assistant") {
      const content = contentForMessage(message, tools, sessionId);
      if (content.length > 0 && !isBackgroundAssistantMessage(content)) {
        rows.push({
          type: "assistant_message",
          id: `message-${message.id}`,
          sessionId,
          content,
          messageId: message.id,
        });
      }
    }

    for (const tool of tools) {
      if (!tool.output && !tool.error) continue;
      if (isBackgroundTool(tool)) continue;
      rows.push({
        type: "tool_result",
        id: `tool-${tool.id}`,
        sessionId: tool.sessionId || sessionId,
        message: toolResultMessage(tool),
      });
    }
  }

  return compactDuplicateUserRows(rows);
}

export function mergeChatEvents(events = [], liveEvents = []) {
  if (!liveEvents.length) return events;
  const maxSeq = events.reduce((max, event) => Math.max(max, Number(event.seq) || 0), 0);
  const normalizedLive = liveEvents.map((event, index) => ({
    ...event,
    seq: maxSeq + index + 1,
  }));
  return [...events, ...normalizedLive];
}

function contentForMessage(message, tools, sessionId = "") {
  const content = (message.content || []).map((part) => {
    if (part.type === "tool") {
      const tool = tools.find((candidate) => candidate.id === part.toolCallId);
      return {
        type: "toolCall",
        id: part.toolCallId,
        name: tool?.name || "tool",
        arguments: tool?.input || {},
        sessionId: tool?.sessionId || sessionId,
      };
    }
    return part;
  });

  const contentToolIds = new Set(
    content.filter((part) => part.type === "toolCall").map((part) => part.id),
  );
  for (const tool of tools) {
    if (contentToolIds.has(tool.id) || isBackgroundTool(tool)) continue;
    content.push({
      type: "toolCall",
      id: tool.id,
      name: tool.name,
      arguments: tool.input || {},
      sessionId: tool.sessionId || sessionId,
    });
  }
  return content;
}

function toolResultMessage(tool) {
  if (tool.output) {
    return {
      role: "toolResult",
      toolCallId: tool.id,
      toolName: tool.name,
      content: tool.output.content || [],
      details: tool.output.details,
      isError: Boolean(tool.output.isError),
      sessionId: tool.sessionId || "",
    };
  }

  return {
    role: "toolResult",
    toolCallId: tool.id,
    toolName: tool.name,
    content: [{ type: "text", text: tool.error?.message || "Tool failed" }],
    details: tool.error?.details,
    isError: true,
    sessionId: tool.sessionId || "",
  };
}

function groupToolsByMessage(tools) {
  const grouped = new Map();
  for (const tool of tools) {
    const group = grouped.get(tool.messageId) || [];
    group.push(tool);
    grouped.set(tool.messageId, group);
  }
  return grouped;
}

export function compactDuplicateUserRows(rows) {
  const compacted = [];
  for (const row of rows) {
    const previous = compacted[compacted.length - 1];
    if (
      row.type === "user_message" &&
      previous?.type === "user_message" &&
      userRowSignature(row) === userRowSignature(previous)
    ) {
      // The local receipt appears first, then the canonical event arrives
      // through the runtime stream. Prefer that canonical row so the queued
      // badge clears as soon as the writer acknowledges the prompt.
      if (previous.delivery === "queued" && row.delivery !== "queued") {
        compacted[compacted.length - 1] = row;
      }
      continue;
    }
    compacted.push(row);
  }
  return compacted;
}

function userRowSignature(row) {
  return JSON.stringify({
    text: textContent(row.content),
    attachments: (row.attachments || []).map((attachment) => ({
      kind: String(attachment?.kind || ""),
      label: String(attachment?.label || ""),
    })),
  });
}

function isOptimisticMessageId(messageId) {
  return String(messageId || "").startsWith("optimistic-user-");
}

function isBackgroundTool(tool) {
  return (
    String(tool.id || "").startsWith("background-") ||
    tool.output?.source === "background" ||
    tool.output?.details?.source === "background"
  );
}

function isBackgroundAssistantMessage(content) {
  return content.some(
    (part) => part.type === "toolCall" && String(part.id || "").startsWith("background-"),
  );
}
