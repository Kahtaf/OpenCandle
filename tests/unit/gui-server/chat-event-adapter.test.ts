import type { Message } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { sessionEntriesToChatEvents } from "../../../gui/server/chat-event-adapter.js";
import { reduceChatEvents } from "../../../gui/shared/event-reducer.js";

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

  it("surfaces original-input attachments beside the typed user text", () => {
    const events = sessionEntriesToChatEvents(
      [
        {
          type: "custom",
          id: "c1",
          parentId: null,
          timestamp: new Date().toISOString(),
          customType: "opencandle-user-input",
          data: {
            original: "am I too concentrated?",
            attachments: [{ kind: "portfolio", label: "Portfolio" }],
          },
        } as unknown as SessionEntry,
        messageEntry("u1", {
          role: "user",
          content:
            "am I too concentrated?\n\n[Attached by user — portfolio]\nPortfolio lots:\n- ASTS",
          timestamp: Date.now(),
        } as Message),
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    const completed = events.find((event) => event.type === "message.completed");
    expect(completed).toMatchObject({
      content: [{ type: "text", text: "am I too concentrated?" }],
      attachments: [{ kind: "portfolio", label: "Portfolio" }],
    });
  });

  it("applies original-input attachments when the marker follows the accepted user message", () => {
    const events = sessionEntriesToChatEvents(
      [
        messageEntry("u1", {
          role: "user",
          content:
            "am I too concentrated?\n\n[Attached by user — portfolio]\nPortfolio lots:\n- ASTS",
          timestamp: Date.now(),
        } as Message),
        {
          type: "custom",
          id: "c1",
          parentId: null,
          timestamp: new Date().toISOString(),
          customType: "opencandle-user-input",
          data: {
            original: "am I too concentrated?",
            attachments: [{ kind: "portfolio", label: "Portfolio" }],
          },
        } as unknown as SessionEntry,
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    const completed = events.find((event) => event.type === "message.completed");
    expect(completed).toMatchObject({
      content: [{ type: "text", text: "am I too concentrated?" }],
      attachments: [{ kind: "portfolio", label: "Portfolio" }],
    });
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
      sessionId: "s1",
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

  it("preserves large multi-symbol OHLCV details through adaptation and reduction", () => {
    const bars = (offset: number) =>
      Array.from({ length: 100 }, (_, index) => ({
        date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
        timestamp: Math.floor(Date.UTC(2026, 0, index + 1) / 1_000),
        open: offset + index,
        high: offset + index + 2,
        low: offset + index - 2,
        close: offset + index + 1,
        volume: 1_000_000 + index,
      }));
    const details = {
      range: "1y",
      interval: "1d",
      baseDate: "2026-01-01",
      series: [
        {
          symbol: "AAPL",
          bars: bars(100),
          indexed: Array.from({ length: 100 }, (_, i) => 100 + i),
        },
        {
          symbol: "MSFT",
          bars: bars(200),
          indexed: Array.from({ length: 100 }, (_, i) => 100 + i / 2),
        },
      ],
      unavailableSymbols: [],
      freshness: {
        fetchedAt: "2026-04-10T00:00:00.000Z",
        providerDataAt: "2026-04-10T00:00:00.000Z",
        providerDataDate: "2026-04-10",
        cacheStatus: "live",
        marketSession: "closed_after_hours",
        isStaleForSession: false,
      },
    };
    const events = sessionEntriesToChatEvents(
      [
        messageEntry("large-details", {
          role: "toolResult",
          toolCallId: "call-large-details",
          toolName: "get_price_comparison",
          content: [{ type: "text", text: "comparison" }],
          details,
          isError: false,
          timestamp: Date.now(),
        } as Message),
      ],
      { sessionId: "s1", startSeq: 1 },
    );
    const state = reduceChatEvents(events);
    const output = [...state.tools.values()].find(
      (tool) => tool.id === "call-large-details",
    )?.output;

    expect(output?.details).toEqual(details);
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

describe("custom message details", () => {
  it("passes entry details through to the custom.message event", () => {
    const events = sessionEntriesToChatEvents(
      [
        {
          type: "custom_message",
          id: "cm1",
          parentId: null,
          timestamp: new Date().toISOString(),
          customType: "opencandle-model-run-failed",
          content: "Chat could not authenticate the configured model key.",
          details: { source: "gui", reason: "model_auth", prompt: "quote NVDA" },
        } as unknown as SessionEntry,
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    const custom = events.find((event) => event.type === "custom.message");
    expect(custom).toMatchObject({
      customType: "opencandle-model-run-failed",
      details: { source: "gui", reason: "model_auth", prompt: "quote NVDA" },
    });
  });
});
