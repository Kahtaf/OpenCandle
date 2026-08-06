import type { Message } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { sessionEntriesToChatEvents } from "../../../gui/server/chat-event-adapter.js";
import { reduceChatEvents } from "../../../gui/shared/event-reducer.js";

describe("sessionEntriesToChatEvents", () => {
  it("renders persisted assistant failures instead of dropping empty error messages", () => {
    const events = sessionEntriesToChatEvents(
      [
        messageEntry("a1", {
          role: "assistant",
          content: [],
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5-mini",
          usage: usage(),
          stopReason: "error",
          errorMessage: "OpenAI API error (401): invalid_api_key",
          timestamp: Date.now(),
        } as Message),
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    expect(events).toEqual([
      expect.objectContaining({ type: "session.updated", seq: 1 }),
      {
        type: "custom.message",
        sessionId: "s1",
        messageId: "model-error-a1",
        customType: "opencandle-model-run-failed",
        content: [{ type: "text", text: "OpenAI API error (401): invalid_api_key" }],
        details: {
          source: "persisted-assistant",
          reason: "model_error",
          provider: "openai",
          model: "gpt-5-mini",
        },
        seq: 2,
      },
    ]);
  });

  it("keeps the visible user prompt on a synthesized failure card for retry after reload", () => {
    const events = sessionEntriesToChatEvents(
      [
        messageEntry("u1", {
          role: "user",
          content: "compare AAPL and MSFT",
          timestamp: Date.now(),
        } as Message),
        messageEntry("a1", {
          role: "assistant",
          content: [],
          api: "openai-responses",
          provider: "openai",
          model: "gpt-5-mini",
          usage: usage(),
          stopReason: "error",
          errorMessage: "OpenAI API error (401): invalid_api_key",
          timestamp: Date.now(),
        } as Message),
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "custom.message",
        customType: "opencandle-model-run-failed",
        details: expect.objectContaining({ prompt: "compare AAPL and MSFT" }),
      }),
    );
  });

  it("deduplicates only the assistant failure paired with an explicit failure card", () => {
    const failedAssistant = (): Message =>
      ({
        role: "assistant",
        content: [],
        api: "openai-responses",
        provider: "openai",
        model: "gpt-5-mini",
        usage: usage(),
        stopReason: "error",
        errorMessage: "OpenAI API error (401): invalid_api_key",
        timestamp: Date.now(),
      }) as Message;
    const events = sessionEntriesToChatEvents(
      [
        messageEntry("a1", failedAssistant()),
        {
          type: "custom_message",
          id: "cm1",
          parentId: null,
          timestamp: new Date().toISOString(),
          customType: "opencandle-model-run-failed",
          content: "Chat could not authenticate the configured model key.",
        } as unknown as SessionEntry,
        messageEntry("u2", {
          role: "user",
          content: "second prompt",
          timestamp: Date.now(),
        } as Message),
        messageEntry("a2", failedAssistant()),
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    expect(
      events
        .filter(
          (event) =>
            event.type === "custom.message" && event.customType === "opencandle-model-run-failed",
        )
        .map((event) => (event.type === "custom.message" ? event.messageId : "")),
    ).toEqual(["cm1", "model-error-a2"]);
  });

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

  it("preserves a slash command persisted immediately before its workflow marker", () => {
    const events = sessionEntriesToChatEvents(
      [
        customEntry("original", "opencandle-user-input", {
          original: "/analyze MSFT",
          attachments: [],
        }),
        customEntry("workflow", "opencandle-workflow", {
          workflow: "comprehensive_analysis",
          analystsTotal: 5,
        }),
        messageEntry("workflow-user-1", {
          role: "user",
          content: "Begin comprehensive analysis of MSFT.",
          timestamp: Date.now(),
        } as Message),
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message.completed",
        content: [{ type: "text", text: "/analyze MSFT" }],
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "custom.message",
        customType: "opencandle-workflow-step",
      }),
    );
  });

  it("adapts persisted workflow prompts into steps while preserving genuine user turns", () => {
    const events = sessionEntriesToChatEvents(
      [
        customEntry("workflow", "opencandle-workflow", {
          workflow: "comprehensive_analysis",
          analystsTotal: 1,
        }),
        customEntry("original", "opencandle-user-input", {
          original: "Analyze NVDA",
        }),
        messageEntry("workflow-user-1", {
          role: "user",
          content: "Full valuation analyst prompt",
          timestamp: Date.now(),
        } as Message),
        messageEntry("assistant-1", assistantMessage("Valuation output")),
        customEntry("analyst-1", "opencandle-analyst-step", {
          stage: "analyst_valuation",
          role: "valuation",
          parsed: true,
        }),
        messageEntry("workflow-user-2", {
          role: "user",
          content: "Full bear researcher prompt",
          timestamp: Date.now(),
        } as Message),
        messageEntry("assistant-2", assistantMessage("Bear output")),
        customEntry("analyst-2", "opencandle-analyst-step", {
          stage: "debate_bear",
          side: "bear",
          parsed: true,
        }),
        messageEntry("workflow-user-3", {
          role: "user",
          content: "Full validation and synthesis prompt",
          timestamp: Date.now(),
        } as Message),
        messageEntry("assistant-3", assistantMessage("Final synthesis")),
        customEntry("validation", "opencandle-validation", {
          passed: true,
          mismatches: [],
        }),
        customEntry("genuine-original", "opencandle-user-input", {
          original: "What is the biggest risk?",
        }),
        messageEntry("genuine-user", {
          role: "user",
          content: "What is the biggest risk?",
          timestamp: Date.now(),
        } as Message),
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    const userMessages = events.filter(
      (event) => event.type === "message.completed" && event.messageId.includes("user"),
    );
    expect(userMessages).toMatchObject([
      { content: [{ type: "text", text: "Analyze NVDA" }] },
      { content: [{ type: "text", text: "What is the biggest risk?" }] },
    ]);

    const workflowSteps = events.filter(
      (event) => event.type === "custom.message" && event.customType === "opencandle-workflow-step",
    );
    expect(workflowSteps).toMatchObject([
      {
        messageId: "workflow-step-workflow-user-1",
        content: [{ type: "text", text: "Full valuation analyst prompt" }],
        details: { label: "Valuation analyst", stage: "analyst_valuation", step: 1, total: 3 },
      },
      {
        messageId: "workflow-step-workflow-user-2",
        content: [{ type: "text", text: "Full bear researcher prompt" }],
        details: { label: "Bear researcher", stage: "debate_bear", step: 2, total: 3 },
      },
      {
        messageId: "workflow-step-workflow-user-3",
        content: [{ type: "text", text: "Full validation and synthesis prompt" }],
        details: { label: "Validation and synthesis", stage: "validation", step: 3, total: 3 },
      },
    ]);
  });

  it("keeps workflow format-retry prompts out of user bubbles", () => {
    const events = sessionEntriesToChatEvents(
      [
        customEntry("workflow", "opencandle-workflow", {
          workflow: "comprehensive_analysis",
        }),
        customEntry("original", "opencandle-user-input", { original: "Analyze NVDA" }),
        messageEntry("workflow-user-1", {
          role: "user",
          content: "Full valuation analyst prompt",
          timestamp: Date.now(),
        } as Message),
        messageEntry("assistant-1", assistantMessage("Incomplete output")),
        messageEntry("workflow-user-retry-1", {
          role: "user",
          content: "Return the exact required format",
          timestamp: Date.now(),
        } as Message),
        messageEntry("assistant-2", assistantMessage("Still incomplete")),
        messageEntry("workflow-user-retry-2", {
          role: "user",
          content: "Revise the prior response without new tools",
          timestamp: Date.now(),
        } as Message),
        messageEntry("assistant-3", assistantMessage("Structured output")),
        customEntry("analyst", "opencandle-analyst-step", {
          stage: "analyst_valuation",
          role: "valuation",
          parsed: true,
        }),
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    expect(
      events.filter(
        (event) =>
          event.type === "message.completed" && event.messageId.startsWith("workflow-user"),
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === "custom.message" && event.customType === "opencandle-workflow-step",
      ),
    ).toHaveLength(3);
  });

  it("closes the workflow group after terminal validation", () => {
    const events = sessionEntriesToChatEvents(
      [
        customEntry("workflow", "opencandle-workflow", {
          workflow: "comprehensive_analysis",
        }),
        customEntry("original", "opencandle-user-input", { original: "Analyze NVDA" }),
        messageEntry("workflow-user-synthesis", {
          role: "user",
          content: "Synthesis prompt",
          timestamp: Date.now(),
        } as Message),
        messageEntry("assistant-synthesis", assistantMessage("Synthesis output")),
        customEntry("validation", "opencandle-validation", { passed: true, mismatches: [] }),
        messageEntry("genuine-follow-up", {
          role: "user",
          content: "What is the biggest risk?",
          timestamp: Date.now(),
        } as Message),
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    expect(
      events.filter(
        (event) => event.type === "message.completed" && event.messageId === "genuine-follow-up",
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === "custom.message" && event.messageId === "workflow-step-genuine-follow-up",
      ),
    ).toHaveLength(0);
  });

  it("closes a non-synthesis workflow group after its terminal completion marker", () => {
    const events = sessionEntriesToChatEvents(
      [
        customEntry("workflow", "opencandle-workflow", { workflow: "portfolio_builder" }),
        customEntry("original", "opencandle-user-input", { original: "Build a portfolio" }),
        messageEntry("workflow-user-final", {
          role: "user",
          content: "Present the final portfolio draft",
          timestamp: Date.now(),
        } as Message),
        messageEntry("assistant-final", assistantMessage("Portfolio output")),
        customEntry("workflow-complete", "opencandle-workflow-complete", {
          workflow: "portfolio_builder",
          status: "completed",
        }),
        messageEntry("genuine-follow-up", {
          role: "user",
          content: "What is the biggest risk?",
          timestamp: Date.now(),
        } as Message),
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    expect(
      events.filter(
        (event) => event.type === "message.completed" && event.messageId === "genuine-follow-up",
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) =>
          event.type === "custom.message" && event.messageId === "workflow-step-genuine-follow-up",
      ),
    ).toHaveLength(0);
  });

  it("does not apply an analyst stage to earlier unclassified workflow prompts", () => {
    const events = sessionEntriesToChatEvents(
      [
        customEntry("workflow", "opencandle-workflow", {
          workflow: "comprehensive_analysis",
        }),
        customEntry("original", "opencandle-user-input", { original: "Analyze NVDA" }),
        messageEntry("workflow-user-fetch", {
          role: "user",
          content: "Initial fetch prompt",
          timestamp: Date.now(),
        } as Message),
        messageEntry("assistant-fetch", assistantMessage("Fetched facts")),
        messageEntry("workflow-user-analyst", {
          role: "user",
          content: "Valuation analyst prompt",
          timestamp: Date.now(),
        } as Message),
        messageEntry("assistant-analyst", assistantMessage("Analyst output")),
        customEntry("analyst", "opencandle-analyst-step", {
          stage: "analyst_valuation",
          role: "valuation",
          parsed: true,
        }),
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    const workflowSteps = events.filter(
      (event) => event.type === "custom.message" && event.customType === "opencandle-workflow-step",
    );
    expect(workflowSteps).toContainEqual(
      expect.objectContaining({
        messageId: "workflow-step-workflow-user-fetch",
        details: expect.objectContaining({ label: "Workflow step", stage: "workflow" }),
      }),
    );
    expect(workflowSteps).toContainEqual(
      expect.objectContaining({
        messageId: "workflow-step-workflow-user-analyst",
        details: expect.objectContaining({
          label: "Valuation analyst",
          stage: "analyst_valuation",
        }),
      }),
    );
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

  it("does not expose an internal workflow prompt after a retroactive attachment marker", () => {
    const events = sessionEntriesToChatEvents(
      [
        messageEntry("u1", {
          role: "user",
          content:
            "analyze this portfolio\n\n[Attached by user — portfolio]\nPortfolio lots:\n- ASTS",
          timestamp: Date.now(),
        } as Message),
        customEntry("original", "opencandle-user-input", {
          original: "analyze this portfolio",
          attachments: [{ kind: "portfolio", label: "Portfolio" }],
        }),
        customEntry("workflow", "opencandle-workflow", {
          workflow: "comprehensive_analysis",
        }),
        messageEntry("workflow-user", {
          role: "user",
          content: "Internal analyst prompt",
          timestamp: Date.now(),
        } as Message),
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    expect(events.filter((event) => event.type === "message.created")).toHaveLength(1);
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "custom.message",
        messageId: "workflow-step-workflow-user",
      }),
    );
  });

  it("preserves a slash command marker after an intervening custom entry", () => {
    const events = sessionEntriesToChatEvents(
      [
        messageEntry("previous-user", {
          role: "user",
          content: "previous prompt",
          timestamp: Date.now(),
        } as Message),
        {
          type: "custom_message",
          id: "notice",
          parentId: null,
          timestamp: new Date().toISOString(),
          customType: "opencandle-model-setup",
          content: "Previous turn notice",
        } as unknown as SessionEntry,
        customEntry("original", "opencandle-user-input", { original: "/analyze MSFT" }),
        customEntry("workflow", "opencandle-workflow", {
          workflow: "comprehensive_analysis",
        }),
        messageEntry("workflow-user", {
          role: "user",
          content: "Internal analyst prompt",
          timestamp: Date.now(),
        } as Message),
      ],
      { sessionId: "s1", startSeq: 1 },
    );

    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message.completed",
        messageId: "workflow-user",
        content: [{ type: "text", text: "/analyze MSFT" }],
      }),
    );
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

function customEntry(id: string, customType: string, data: Record<string, unknown>): SessionEntry {
  return {
    type: "custom",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    customType,
    data,
  } as unknown as SessionEntry;
}

function assistantMessage(text: string): Message {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "openai",
    model: "test",
    usage: usage(),
    stopReason: "stop",
    timestamp: Date.now(),
  } as Message;
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
