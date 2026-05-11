import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../../../gui/shared/chat-events.js";
import { createLiveChatEventAdapter } from "../../../gui/server/live-chat-event-adapter.js";

describe("live chat event adapter", () => {
  it("streams text deltas and preserves completed tool outputs for GUI renderers", () => {
    const events: ChatEvent[] = [];
    const adapter = createLiveChatEventAdapter({
      runId: "run-1",
      sessionId: "session-1",
      startSeq: 10,
      emit: (event) => events.push(event),
    });

    adapter.handle(agentEvent({
      type: "message_start",
      message: { role: "user", content: "quote NVDA", timestamp: Date.now() },
    }));
    adapter.handle(agentEvent({
      type: "message_start",
      message: {
        role: "assistant",
        content: [],
        api: "openai-responses",
        provider: "openai",
        model: "test",
        usage: emptyUsage(),
        stopReason: "toolUse",
        timestamp: Date.now(),
      },
    }));
    adapter.handle(agentEvent({
      type: "message_update",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Looking up " }],
        api: "openai-responses",
        provider: "openai",
        model: "test",
        usage: emptyUsage(),
        stopReason: "toolUse",
        timestamp: Date.now(),
      },
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        delta: "Looking up ",
        partial: {
          role: "assistant",
          content: [{ type: "text", text: "Looking up " }],
          api: "openai-responses",
          provider: "openai",
          model: "test",
          usage: emptyUsage(),
          stopReason: "toolUse",
          timestamp: Date.now(),
        },
      },
    }));
    adapter.handle(agentEvent({
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "get_stock_quote",
      args: { symbol: "NVDA" },
    }));
    adapter.handle(agentEvent({
      type: "tool_execution_end",
      toolCallId: "call-1",
      toolName: "get_stock_quote",
      result: {
        content: [{ type: "text", text: "NVDA quote" }],
        details: { symbol: "NVDA", price: 185.25 },
      },
      isError: false,
    }));

    expect(events.map((event) => event.type)).toEqual([
      "message.created",
      "message.completed",
      "message.created",
      "message.delta",
      "tool.started",
      "tool.completed",
    ]);
    expect(events.find((event) => event.type === "message.delta")).toMatchObject({
      messageId: "run-1-assistant-1",
      text: "Looking up ",
    });
    expect(events.find((event) => event.type === "tool.completed")).toMatchObject({
      toolCallId: "call-1",
      output: {
        content: [{ type: "text", text: "NVDA quote" }],
        details: { symbol: "NVDA", price: 185.25 },
        isError: false,
      },
    });
  });
});

function agentEvent(event: AgentSessionEvent): AgentSessionEvent {
  return event;
}

function emptyUsage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
