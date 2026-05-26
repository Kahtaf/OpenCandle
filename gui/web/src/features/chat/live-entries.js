import { reduceChatEvents } from "../../../../shared/event-reducer.ts";
import { textContent } from "../../rendering/text.js";

export function eventsToLiveEntries(events) {
  if (!events?.length) return [];
  const state = reduceChatEvents(events);
  const toolsByMessage = groupToolsByMessage([...state.tools.values()]);
  const entries = [];

  for (const message of state.messages) {
    const tools = toolsByMessage.get(message.id) || [];
    entries.push({
      type: "message",
      id: `live-message-${message.id}`,
      message: {
        role: message.role,
        content: contentForMessage(message, tools),
      },
    });

    for (const tool of tools) {
      if (tool.output || tool.error) {
        entries.push({
          type: "message",
          id: `live-tool-${tool.id}`,
          message: toolResultMessage(tool),
        });
      }
    }
  }

  return entries;
}

function contentForMessage(message, tools) {
  const content = (message.content || []).map((part) => {
    if (part.type === "tool") {
      const tool = tools.find((candidate) => candidate.id === part.toolCallId);
      return {
        type: "toolCall",
        id: part.toolCallId,
        name: tool?.name || "tool",
        arguments: tool?.input || {},
      };
    }
    return part;
  });

  const contentToolIds = new Set(content.filter((part) => part.type === "toolCall").map((part) => part.id));
  for (const tool of tools) {
    if (!contentToolIds.has(tool.id)) {
      content.push({
        type: "toolCall",
        id: tool.id,
        name: tool.name,
        arguments: tool.input || {},
      });
    }
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
    };
  }

  return {
    role: "toolResult",
    toolCallId: tool.id,
    toolName: tool.name,
    content: [{ type: "text", text: tool.error?.message || "Tool failed" }],
    details: tool.error?.details,
    isError: true,
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

export function compactDuplicateUserMessages(entries) {
  const compacted = [];
  for (const entry of entries) {
    const previous = compacted[compacted.length - 1];
    if (
      entry.type === "message"
      && previous?.type === "message"
      && entry.message?.role === "user"
      && previous.message?.role === "user"
      && textContent(entry.message.content) === textContent(previous.message.content)
    ) {
      continue;
    }
    compacted.push(entry);
  }
  return compacted;
}
