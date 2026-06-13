import {
  type ChatEvent,
  type ChatRenderState,
  createChatRenderState,
  type MessageContent,
  type RenderMessage,
} from "./chat-events.js";

export function reduceChatEvents(events: ChatEvent[]): ChatRenderState {
  return [...events]
    .sort((a, b) => a.seq - b.seq)
    .reduce((state, event) => applyChatEvent(state, event), createChatRenderState());
}

export function applyChatEvent(state: ChatRenderState, event: ChatEvent): ChatRenderState {
  if (state.seenSeq.has(event.seq)) return state;

  const next = cloneState(state);
  if (event.seq > next.lastSeq + 1 && next.lastSeq !== 0) {
    next.gaps.push({ expected: next.lastSeq + 1, received: event.seq });
  }
  next.seenSeq.add(event.seq);
  next.lastSeq = Math.max(next.lastSeq, event.seq);

  switch (event.type) {
    case "run.started":
      next.runs.set(event.runId, {
        id: event.runId,
        sessionId: event.sessionId,
        status: "running",
      });
      next.session = { ...next.session, id: event.sessionId };
      break;

    case "thinking.delta": {
      const thinking = ensureThinking(next, event.runId);
      thinking.status = "streaming";
      thinking.text += event.text;
      break;
    }

    case "thinking.completed": {
      const thinking = ensureThinking(next, event.runId);
      thinking.status = "completed";
      if (event.text !== undefined) thinking.text = event.text;
      break;
    }

    case "message.created":
      ensureMessage(next, event.messageId, event.role);
      break;

    case "message.delta": {
      const message = ensureMessage(next, event.messageId, "assistant");
      message.status = "streaming";
      message.text += event.text;
      message.content = [{ type: "text", text: message.text }];
      break;
    }

    case "message.completed": {
      const message = ensureMessage(next, event.messageId, "assistant");
      message.status = "completed";
      message.content = event.content;
      message.text = contentText(event.content);
      break;
    }

    case "custom.message": {
      const message = ensureMessage(next, event.messageId, "assistant");
      message.status = "completed";
      message.content = event.content;
      message.text = contentText(event.content);
      message.customType = event.customType;
      break;
    }

    case "tool.started":
      ensureMessage(next, event.messageId, "assistant");
      next.tools.set(event.toolCallId, {
        id: event.toolCallId,
        messageId: event.messageId,
        name: event.name,
        input: event.input,
        status: "running",
        chunks: [],
      });
      break;

    case "tool.delta": {
      const tool = next.tools.get(event.toolCallId);
      if (tool) tool.chunks.push(event.chunk);
      break;
    }

    case "tool.completed": {
      const tool = next.tools.get(event.toolCallId);
      if (tool) {
        tool.status = event.output.isError ? "failed" : "completed";
        tool.output = event.output;
      }
      break;
    }

    case "tool.failed": {
      const tool = next.tools.get(event.toolCallId);
      if (tool) {
        tool.status = "failed";
        tool.error = event.error;
      }
      break;
    }

    case "run.completed": {
      const run = next.runs.get(event.runId);
      if (run) {
        run.status = "completed";
        run.usage = event.usage;
      }
      break;
    }

    case "run.failed": {
      const run = next.runs.get(event.runId);
      if (run) {
        run.status = "failed";
        run.error = event.error;
      }
      break;
    }

    case "session.updated":
      next.session = {
        id: event.sessionId,
        title: event.title,
        updatedAt: event.updatedAt,
      };
      break;
  }

  return next;
}

function ensureMessage(
  state: ChatRenderState,
  id: string,
  role: RenderMessage["role"],
): RenderMessage {
  const existing = state.messageById.get(id);
  if (existing) return existing;

  const message: RenderMessage = {
    id,
    role,
    status: "streaming",
    content: [],
    text: "",
  };
  state.messageById.set(id, message);
  state.messages.push(message);
  return message;
}

function cloneState(state: ChatRenderState): ChatRenderState {
  const messages = state.messages.map((message) => ({
    ...message,
    content: [...message.content],
  }));
  const messageById = new Map(messages.map((message) => [message.id, message]));
  return {
    ...state,
    seenSeq: new Set(state.seenSeq),
    messages,
    messageById,
    tools: new Map(
      [...state.tools].map(([id, tool]) => [
        id,
        {
          ...tool,
          chunks: [...tool.chunks],
        },
      ]),
    ),
    runs: new Map([...state.runs].map(([id, run]) => [id, { ...run }])),
    thinking: new Map([...state.thinking].map(([id, thinking]) => [id, { ...thinking }])),
    session: state.session ? { ...state.session } : undefined,
    gaps: [...state.gaps],
  };
}

function ensureThinking(state: ChatRenderState, runId: string) {
  const existing = state.thinking.get(runId);
  if (existing) return existing;
  const thinking = { runId, status: "streaming" as const, text: "" };
  state.thinking.set(runId, thinking);
  return thinking;
}

function contentText(content: MessageContent[]): string {
  return content
    .filter((part): part is Extract<MessageContent, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("");
}
