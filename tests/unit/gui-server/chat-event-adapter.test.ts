import { describe, expect, it } from "vitest";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import { sessionEntriesToChatEvents } from "../../../gui/server/chat-event-adapter.js";

describe("sessionEntriesToChatEvents", () => {
  it("converts messages and paired tool calls into canonical events", () => {
    const events = sessionEntriesToChatEvents([
      messageEntry("u1", { role: "user", content: "quote NVDA", timestamp: Date.now() } as Message),
      messageEntry("a1", {
        role: "assistant",
        content: [{ type: "toolCall", id: "call-1", name: "get_stock_quote", arguments: { symbol: "NVDA" } }],
        api: "openai-responses",
        provider: "openai",
        model: "test",
        usage: usage(),
        stopReason: "tool_calls",
        timestamp: Date.now(),
      } as Message),
      messageEntry("t1", {
        role: "toolResult",
        toolCallId: "call-1",
        toolName: "get_stock_quote",
        content: [{ type: "text", text: "NVDA quote" }],
        details: { source: "ui", args: { symbol: "NVDA" }, value: { symbol: "NVDA", price: 185 } },
        isError: false,
        timestamp: Date.now(),
      } as Message),
    ], { sessionId: "s1", startSeq: 1 });

    expect(events.map((event) => event.type)).toEqual([
      "session.updated",
      "message.created",
      "message.completed",
      "message.created",
      "tool.started",
      "message.completed",
      "tool.completed",
    ]);
    expect(events.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(events.find((event) => event.type === "tool.completed")).toMatchObject({
      toolCallId: "call-1",
      output: { source: "ui" },
    });
  });

  it("creates synthetic tool start events for orphan UI tool results", () => {
    const events = sessionEntriesToChatEvents([
      messageEntry("t1", {
        role: "toolResult",
        toolCallId: "ui-call-1",
        toolName: "get_option_chain",
        content: [{ type: "text", text: "chain" }],
        details: { source: "ui", args: { symbol: "NVDA" } },
        isError: false,
        timestamp: Date.now(),
      } as Message),
    ], { sessionId: "s1" });

    expect(events.map((event) => event.type)).toEqual([
      "session.updated",
      "tool.started",
      "tool.completed",
    ]);
    expect(events[1]).toMatchObject({
      type: "tool.started",
      name: "get_option_chain",
      input: { symbol: "NVDA" },
    });
  });
});

function messageEntry(id: string, message: Message): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message,
  } as SessionEntry;
}

function usage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}
