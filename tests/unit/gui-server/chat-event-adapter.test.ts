import type { Message } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { sessionEntriesToChatEvents } from "../../../gui/server/chat-event-adapter.js";

describe("sessionEntriesToChatEvents", () => {
  it("converts messages and paired tool calls into canonical events", () => {
    const events = sessionEntriesToChatEvents(
      [
        messageEntry("u1", {
          role: "user",
          content: "quote NVDA",
          timestamp: Date.now(),
        } as Message),
        messageEntry("a1", {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "get_stock_quote",
              arguments: { symbol: "NVDA" },
            },
          ],
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
          details: {
            source: "ui",
            args: { symbol: "NVDA" },
            value: { symbol: "NVDA", price: 185 },
          },
          isError: false,
          timestamp: Date.now(),
        } as Message),
      ],
      { sessionId: "s1", startSeq: 1 },
    );

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

  it("renders the original user text for workflow-transformed turns", () => {
    const events = sessionEntriesToChatEvents(
      [
        {
          type: "custom",
          id: "c1",
          parentId: null,
          timestamp: new Date().toISOString(),
          customType: "opencandle-user-input",
          data: { original: "I own 200 ASTS shares. Worth selling covered calls?" },
        } as unknown as SessionEntry,
        messageEntry("u1", {
          role: "user",
          content: "Current date: 2026-06-12 Screen and rank options contracts for ASTS: ...",
          timestamp: Date.now(),
        } as Message),
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    const completed = events.find((event) => event.type === "message.completed");
    expect(completed).toMatchObject({
      content: [{ type: "text", text: "I own 200 ASTS shares. Worth selling covered calls?" }],
    });
    // The marker entry itself must not render as a separate message.
    expect(events.filter((event) => event.type === "message.created")).toHaveLength(1);
  });

  it("preserves visible custom messages as custom chat events", () => {
    const events = sessionEntriesToChatEvents(
      [
        {
          type: "custom_message",
          id: "setup-1",
          parentId: null,
          timestamp: new Date().toISOString(),
          customType: "opencandle-model-setup",
          content: "Connect a model before chat can run.",
        } as unknown as SessionEntry,
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    expect(events).toContainEqual({
      type: "custom.message",
      messageId: "setup-1",
      customType: "opencandle-model-setup",
      content: [{ type: "text", text: "Connect a model before chat can run." }],
      seq: 2,
    });
    expect(events.some((event) => event.type === "message.created")).toBe(false);
  });

  it("preserves final assistant prose after a normal Pi tool turn", () => {
    const events = sessionEntriesToChatEvents(
      [
        messageEntry("u1", {
          role: "user",
          content: "Show options chain for AAPL",
          timestamp: Date.now(),
        } as Message),
        messageEntry("a1", {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "get_option_chain",
              arguments: { symbol: "AAPL" },
            },
          ],
          api: "google-generative-ai",
          provider: "google",
          model: "test",
          usage: usage(),
          stopReason: "toolUse",
          timestamp: Date.now(),
        } as Message),
        messageEntry("t1", {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "get_option_chain",
          content: [{ type: "text", text: "AAPL options chain" }],
          details: {
            symbol: "AAPL",
            underlyingPrice: 293.32,
            calls: [],
            puts: [],
          },
          isError: false,
          timestamp: Date.now(),
        } as Message),
        messageEntry("a2", {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "AAPL has near-dated options available around the current spot price.",
            },
          ],
          api: "google-generative-ai",
          provider: "google",
          model: "test",
          usage: usage(),
          stopReason: "stop",
          timestamp: Date.now(),
        } as Message),
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    expect(events.map((event) => event.type)).toEqual([
      "session.updated",
      "message.created",
      "message.completed",
      "message.created",
      "tool.started",
      "message.completed",
      "tool.completed",
      "message.created",
      "message.completed",
    ]);
    expect(events.find((event) => event.type === "tool.completed")).toMatchObject({
      toolCallId: "call-1",
      output: {
        details: {
          symbol: "AAPL",
          underlyingPrice: 293.32,
        },
      },
    });
    expect(events.at(-1)).toMatchObject({
      type: "message.completed",
      content: [
        {
          type: "text",
          text: "AAPL has near-dated options available around the current spot price.",
        },
      ],
    });
  });

  it("creates synthetic tool start events for orphan UI tool results", () => {
    const events = sessionEntriesToChatEvents(
      [
        messageEntry("t1", {
          role: "toolResult",
          toolCallId: "ui-call-1",
          toolName: "get_option_chain",
          content: [{ type: "text", text: "chain" }],
          details: { source: "ui", args: { symbol: "NVDA" } },
          isError: false,
          timestamp: Date.now(),
        } as Message),
      ],
      { sessionId: "s1" },
    );

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

  it("marks assistant tool calls without persisted results as interrupted", () => {
    const events = sessionEntriesToChatEvents(
      [
        messageEntry("u1", {
          role: "user",
          content: "quote BTC",
          timestamp: Date.now(),
        } as Message),
        messageEntry("a1", {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "get_crypto_price",
              arguments: { id: "bitcoin" },
            },
          ],
          api: "google-generative-ai",
          provider: "google",
          model: "test",
          usage: usage(),
          stopReason: "toolUse",
          timestamp: Date.now(),
        } as Message),
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    expect(events.map((event) => event.type)).toEqual([
      "session.updated",
      "message.created",
      "message.completed",
      "message.created",
      "tool.started",
      "message.completed",
      "tool.failed",
    ]);
    expect(events.at(-1)).toMatchObject({
      type: "tool.failed",
      toolCallId: "call-1",
      error: {
        message:
          "Tool call did not finish. The run may have been interrupted before OpenCandle received a tool result.",
      },
    });
  });

  it("can preserve unresolved tool calls while a live run is active", () => {
    const events = sessionEntriesToChatEvents(
      [
        messageEntry("a1", {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call-1",
              name: "get_crypto_price",
              arguments: { id: "bitcoin" },
            },
          ],
          api: "google-generative-ai",
          provider: "google",
          model: "test",
          usage: usage(),
          stopReason: "toolUse",
          timestamp: Date.now(),
        } as Message),
      ],
      { sessionId: "s1", markUnresolvedToolCalls: false },
    );

    expect(events.map((event) => event.type)).toEqual([
      "session.updated",
      "message.created",
      "tool.started",
      "message.completed",
    ]);
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
