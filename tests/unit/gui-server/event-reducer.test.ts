import { describe, expect, it } from "vitest";
import type { ChatEvent, ToolOutput } from "../../../gui/shared/chat-events.js";
import { createChatRenderState } from "../../../gui/shared/chat-events.js";
import { applyChatEvent, reduceChatEvents } from "../../../gui/shared/event-reducer.js";

describe("chat event reducer", () => {
  it("rebuilds the same state from out-of-order historical events", () => {
    const events: ChatEvent[] = [
      { type: "message.delta", sessionId: "s1", messageId: "m1", text: "NV", seq: 3 },
      { type: "run.started", runId: "r1", sessionId: "s1", seq: 1 },
      { type: "message.created", sessionId: "s1", messageId: "m1", role: "assistant", seq: 2 },
      { type: "message.delta", sessionId: "s1", messageId: "m1", text: "DA", seq: 4 },
      {
        type: "message.completed",
        sessionId: "s1",
        messageId: "m1",
        content: [{ type: "text", text: "NVDA" }],
        seq: 5,
      },
      { type: "run.completed", sessionId: "s1", runId: "r1", seq: 6 },
    ];

    const state = reduceChatEvents(events);

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0]).toMatchObject({ id: "m1", text: "NVDA", status: "completed" });
    expect([...state.runs.values()].find((run) => run.id === "r1")?.status).toBe("completed");
    expect(state.gaps).toEqual([]);
  });

  it("ignores duplicate sequence numbers so tool cards are not repeated", () => {
    const output = quoteOutput("NVDA");
    const events: ChatEvent[] = [
      { type: "message.created", messageId: "m1", role: "assistant", seq: 1 },
      {
        type: "tool.started",
        toolCallId: "t1",
        messageId: "m1",
        name: "get_stock_quote",
        input: { symbol: "NVDA" },
        seq: 2,
      },
      { type: "tool.completed", toolCallId: "t1", output, seq: 3 },
      { type: "tool.completed", toolCallId: "t1", output, seq: 3 },
    ];

    const state = reduceChatEvents(events);

    expect([...state.tools.values()]).toHaveLength(1);
    expect([...state.tools.values()].find((tool) => tool.id === "t1")?.output).toEqual(output);
  });

  it("treats the same sequence number in another session as a distinct event", () => {
    const state = reduceChatEvents([
      {
        type: "message.created",
        sessionId: "session-a",
        messageId: "a1",
        role: "assistant",
        seq: 1,
      },
      {
        type: "message.created",
        sessionId: "session-b",
        messageId: "b1",
        role: "assistant",
        seq: 1,
      },
    ]);

    expect(state.messages.map((message) => message.id)).toEqual(["a1", "b1"]);
    expect(state.gaps).toEqual([]);
  });

  it("scopes duplicate message, tool, and run ids by session", () => {
    const state = reduceChatEvents([
      { type: "run.started", sessionId: "session-a", runId: "run-1", seq: 1 },
      {
        type: "message.created",
        sessionId: "session-a",
        messageId: "message-1",
        role: "assistant",
        seq: 2,
      },
      {
        type: "tool.started",
        sessionId: "session-a",
        toolCallId: "tool-1",
        messageId: "message-1",
        name: "get_stock_quote",
        input: { symbol: "AAPL" },
        seq: 3,
      },
      {
        type: "tool.completed",
        sessionId: "session-a",
        toolCallId: "tool-1",
        output: quoteOutput("AAPL"),
        seq: 4,
      },
      { type: "run.completed", sessionId: "session-a", runId: "run-1", seq: 5 },
      { type: "run.started", sessionId: "session-b", runId: "run-1", seq: 1 },
      {
        type: "message.created",
        sessionId: "session-b",
        messageId: "message-1",
        role: "assistant",
        seq: 2,
      },
      {
        type: "tool.started",
        sessionId: "session-b",
        toolCallId: "tool-1",
        messageId: "message-1",
        name: "get_stock_quote",
        input: { symbol: "MSFT" },
        seq: 3,
      },
      {
        type: "tool.completed",
        sessionId: "session-b",
        toolCallId: "tool-1",
        output: quoteOutput("MSFT"),
        seq: 4,
      },
      { type: "run.completed", sessionId: "session-b", runId: "run-1", seq: 5 },
    ]);

    expect(state.messages).toHaveLength(2);
    expect([...state.tools.values()].map((tool) => tool.output?.details)).toMatchObject([
      { symbol: "AAPL" },
      { symbol: "MSFT" },
    ]);
    expect([...state.runs.values()].map((run) => run.sessionId)).toEqual([
      "session-a",
      "session-b",
    ]);
  });

  it("updates one tool call across started, delta, and completed events", () => {
    const state = reduceChatEvents([
      { type: "message.created", messageId: "m1", role: "assistant", seq: 1 },
      {
        type: "tool.started",
        toolCallId: "t1",
        messageId: "m1",
        name: "get_option_chain",
        input: { symbol: "NVDA" },
        seq: 2,
      },
      { type: "tool.delta", toolCallId: "t1", chunk: { loaded: 10 }, seq: 3 },
      { type: "tool.completed", toolCallId: "t1", output: optionsOutput(), seq: 4 },
    ]);

    expect([...state.tools.values()]).toHaveLength(1);
    expect([...state.tools.values()].find((tool) => tool.id === "t1")).toMatchObject({
      name: "get_option_chain",
      status: "completed",
      chunks: [{ loaded: 10 }],
    });
  });

  it("tracks failed tools and failed runs without dropping chat state", () => {
    const state = reduceChatEvents([
      { type: "run.started", runId: "r1", sessionId: "s1", seq: 1 },
      { type: "message.created", sessionId: "s1", messageId: "m1", role: "assistant", seq: 2 },
      {
        type: "tool.started",
        sessionId: "s1",
        toolCallId: "t1",
        messageId: "m1",
        name: "get_sec_filings",
        input: { symbol: "NVDA" },
        seq: 3,
      },
      {
        type: "tool.failed",
        sessionId: "s1",
        toolCallId: "t1",
        error: { message: "SEC unavailable" },
        seq: 4,
      },
      {
        type: "run.failed",
        sessionId: "s1",
        runId: "r1",
        error: { message: "stream failed" },
        seq: 5,
      },
    ]);

    expect([...state.tools.values()].find((tool) => tool.id === "t1")).toMatchObject({
      status: "failed",
      error: { message: "SEC unavailable" },
    });
    expect([...state.runs.values()].find((run) => run.id === "r1")).toMatchObject({
      status: "failed",
      error: { message: "stream failed" },
    });
  });

  it("records sequence gaps during live application", () => {
    let state = createChatRenderState();
    state = applyChatEvent(state, {
      type: "message.created",
      messageId: "m1",
      role: "assistant",
      seq: 1,
    });
    state = applyChatEvent(state, {
      type: "message.delta",
      messageId: "m1",
      text: "after gap",
      seq: 3,
    });

    expect(state.gaps).toEqual([{ expected: 2, received: 3 }]);
  });

  it("accepts fixture-like outputs for OpenCandle financial renderer categories", () => {
    const outputs = [
      quoteOutput("NVDA"),
      quoteComparisonOutput(),
      historicalPricesOutput(),
      fundamentalsOutput(),
      optionsOutput(),
      macroOutput(),
      newsOutput(),
      secOutput(),
      portfolioOutput(),
      genericOutput(),
    ];

    const state = reduceChatEvents(
      outputs.flatMap((output, index): ChatEvent[] => {
        const seq = index * 2 + 1;
        return [
          {
            type: "tool.started",
            toolCallId: `t${index}`,
            messageId: "m1",
            name: `tool_${index}`,
            input: {},
            seq,
          },
          { type: "tool.completed", toolCallId: `t${index}`, output, seq: seq + 1 },
        ];
      }),
    );

    expect(state.tools.size).toBe(outputs.length);
    expect([...state.tools.values()].every((tool) => tool.output != null)).toBe(true);
  });

  it("tracks streaming thinking text for an active run", () => {
    const state = reduceChatEvents([
      { type: "run.started", runId: "r1", sessionId: "s1", seq: 1 },
      {
        type: "thinking.delta",
        sessionId: "s1",
        runId: "r1",
        text: "Checking expirations",
        seq: 2,
      },
      {
        type: "thinking.delta",
        sessionId: "s1",
        runId: "r1",
        text: " and filtering LEAPS.",
        seq: 3,
      },
      {
        type: "thinking.completed",
        sessionId: "s1",
        runId: "r1",
        text: "Checking expirations and filtering LEAPS.",
        seq: 4,
      },
      { type: "run.completed", sessionId: "s1", runId: "r1", seq: 5 },
    ]);

    expect([...state.thinking.values()].find((thinking) => thinking.runId === "r1")).toEqual({
      runId: "r1",
      sessionId: "s1",
      status: "completed",
      text: "Checking expirations and filtering LEAPS.",
    });
  });
});

function quoteOutput(symbol: string): ToolOutput {
  return {
    content: [{ type: "text", text: `${symbol} quote` }],
    details: { symbol, price: 185.25, changePercent: 1.2, stale: false },
  };
}

function quoteComparisonOutput(): ToolOutput {
  return {
    content: [{ type: "text", text: "NVDA vs AMD" }],
    details: { symbols: ["NVDA", "AMD"], rows: [{ symbol: "NVDA", price: 185.25 }] },
  };
}

function historicalPricesOutput(): ToolOutput {
  return {
    content: [{ type: "text", text: "Historical prices" }],
    details: { symbol: "NVDA", candles: [{ date: "2026-05-08", close: 185.25 }] },
  };
}

function fundamentalsOutput(): ToolOutput {
  return {
    content: [{ type: "text", text: "Fundamentals" }],
    details: { symbol: "NVDA", peRatio: 31.2, revenueTtm: 1000 },
  };
}

function optionsOutput(): ToolOutput {
  return {
    content: [{ type: "text", text: "Options chain" }],
    details: { symbol: "NVDA", expirations: [{ date: "2026-06-19", calls: [], puts: [] }] },
  };
}

function macroOutput(): ToolOutput {
  return {
    content: [{ type: "text", text: "FRED series" }],
    details: { seriesId: "CPIAUCSL", observations: [{ date: "2026-04-01", value: 313.2 }] },
  };
}

function newsOutput(): ToolOutput {
  return {
    content: [{ type: "text", text: "News results" }],
    details: { query: "NVDA", results: [{ title: "Nvidia news", url: "https://example.com" }] },
  };
}

function secOutput(): ToolOutput {
  return {
    content: [{ type: "text", text: "SEC filings" }],
    details: { cik: "0001045810", filings: [{ form: "10-K", accession: "abc" }] },
  };
}

function portfolioOutput(): ToolOutput {
  return {
    content: [{ type: "text", text: "Portfolio" }],
    details: { holdings: [{ symbol: "NVDA", weight: 0.1 }], risk: { beta: 1.2 } },
  };
}

function genericOutput(): ToolOutput {
  return {
    content: [{ type: "text", text: "Generic JSON" }],
    details: { ok: true },
  };
}

describe("custom message details reduction", () => {
  it("keeps custom.message details on the rendered message for per-entry actions", () => {
    const state = reduceChatEvents([
      {
        type: "custom.message",
        sessionId: "s1",
        messageId: "cm1",
        customType: "opencandle-model-run-failed",
        content: [{ type: "text", text: "Chat could not authenticate the configured model key." }],
        details: { source: "gui", reason: "model_auth", prompt: "quote NVDA" },
        seq: 1,
      },
    ]);

    expect(state.messages[0]).toMatchObject({
      customType: "opencandle-model-run-failed",
      details: { prompt: "quote NVDA" },
    });
  });
});
