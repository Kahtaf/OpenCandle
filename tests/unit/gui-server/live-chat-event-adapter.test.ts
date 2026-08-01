import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import type { ChatEvent } from "../../../gui/shared/chat-events.js";
import { createLiveChatEventAdapter } from "../../../gui/shared/live-chat-event-adapter.js";

describe("live chat event adapter", () => {
  it("streams text deltas and preserves completed tool outputs for GUI renderers", () => {
    const events: ChatEvent[] = [];
    const adapter = createLiveChatEventAdapter({
      runId: "run-1",
      sessionId: "session-1",
      startSeq: 10,
      emit: (event) => events.push(event),
    });

    adapter.handle(
      agentEvent({
        type: "message_start",
        message: { role: "user", content: "quote NVDA", timestamp: Date.now() },
      }),
    );
    adapter.handle(
      agentEvent({
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
      }),
    );
    adapter.handle(
      agentEvent({
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
      }),
    );
    adapter.handle(
      agentEvent({
        type: "tool_execution_start",
        toolCallId: "call-1",
        toolName: "get_stock_quote",
        args: { symbol: "NVDA" },
      }),
    );
    adapter.handle(
      agentEvent({
        type: "tool_execution_end",
        toolCallId: "call-1",
        toolName: "get_stock_quote",
        result: {
          content: [{ type: "text", text: "NVDA quote" }],
          details: { symbol: "NVDA", price: 185.25, source: "Yahoo Finance" },
        },
        isError: false,
      }),
    );

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
        details: { symbol: "NVDA", price: 185.25, source: "Yahoo Finance" },
        isError: false,
        source: "Yahoo Finance",
      },
    });
  });

  it("renders the original prompt for the first user message of a transformed run", () => {
    const events: ChatEvent[] = [];
    const adapter = createLiveChatEventAdapter({
      runId: "run-1",
      sessionId: "session-1",
      startSeq: 1,
      emit: (event) => events.push(event),
      originalPrompt: "I own 200 ASTS shares. Worth selling covered calls?",
    });

    adapter.handle(
      agentEvent({
        type: "message_start",
        message: {
          role: "user",
          content: "Current date: 2026-06-12 Screen and rank options contracts for ASTS ...",
          timestamp: Date.now(),
        },
      }),
    );

    const completed = events.find((event) => event.type === "message.completed");
    expect(completed).toMatchObject({
      content: [{ type: "text", text: "I own 200 ASTS shares. Worth selling covered calls?" }],
    });
  });

  it("streams workflow-injected prompts as steps without creating extra user bubbles", () => {
    const events: ChatEvent[] = [];
    const adapter = createLiveChatEventAdapter({
      runId: "run-1",
      sessionId: "session-1",
      startSeq: 1,
      emit: (event) => events.push(event),
      originalPrompt: "Analyze NVDA",
      dispatchedPrompt: "Analyze NVDA",
    });

    adapter.handle(
      agentEvent({
        type: "message_start",
        message: {
          role: "user",
          content: "Full valuation analyst prompt",
          timestamp: Date.now(),
        },
      }),
    );
    adapter.handle(
      agentEvent({
        type: "message_start",
        message: {
          role: "user",
          content: "Full bear researcher prompt",
          timestamp: Date.now(),
        },
      }),
    );

    expect(events.filter((event) => event.type === "message.created")).toMatchObject([
      { role: "user", messageId: "run-1-user-1" },
    ]);
    expect(
      events.filter(
        (event) =>
          event.type === "custom.message" && event.customType === "opencandle-workflow-step",
      ),
    ).toMatchObject([
      {
        messageId: "run-1-workflow-step-1",
        content: [{ type: "text", text: "Full valuation analyst prompt" }],
        details: { label: "Workflow step", stage: "workflow", step: 1 },
      },
      {
        messageId: "run-1-workflow-step-2",
        content: [{ type: "text", text: "Full bear researcher prompt" }],
        details: { label: "Workflow step", stage: "workflow", step: 2 },
      },
    ]);
  });

  it("renders attachment chips on the first live user message", () => {
    const events: ChatEvent[] = [];
    const adapter = createLiveChatEventAdapter({
      runId: "run-1",
      sessionId: "session-1",
      startSeq: 1,
      emit: (event) => events.push(event),
      originalPrompt: "am I too concentrated?",
      originalAttachments: [{ kind: "portfolio", label: "Portfolio" }],
    });

    adapter.handle(
      agentEvent({
        type: "message_start",
        message: {
          role: "user",
          content: "am I too concentrated?\n\n[Attached by user — portfolio]\nPortfolio lots:",
          timestamp: Date.now(),
        },
      }),
    );

    expect(events.find((event) => event.type === "message.completed")).toMatchObject({
      content: [{ type: "text", text: "am I too concentrated?" }],
      attachments: [{ kind: "portfolio", label: "Portfolio" }],
    });
  });

  it("keeps live user image thumbnails beside the typed prompt", () => {
    const events: ChatEvent[] = [];
    const adapter = createLiveChatEventAdapter({
      runId: "run-1",
      sessionId: "session-1",
      startSeq: 1,
      emit: (event) => events.push(event),
      originalPrompt: "What does this chart show?",
    });

    adapter.handle(
      agentEvent({
        type: "message_start",
        message: {
          role: "user",
          content: [
            { type: "text", text: "What does this chart show?" },
            { type: "image", data: "base64", mimeType: "image/png", alt: "chart.png" },
          ],
          timestamp: Date.now(),
        },
      }),
    );

    expect(events.find((event) => event.type === "message.completed")).toMatchObject({
      content: [
        { type: "text", text: "What does this chart show?" },
        {
          type: "image",
          url: "data:image/png;base64,base64",
          data: "base64",
          mimeType: "image/png",
          alt: "chart.png",
        },
      ],
    });
  });

  it("emits compact thinking events from Pi reasoning deltas", () => {
    const events: ChatEvent[] = [];
    const adapter = createLiveChatEventAdapter({
      runId: "run-1",
      sessionId: "session-1",
      startSeq: 1,
      emit: (event) => events.push(event),
    });

    adapter.handle(
      agentEvent({
        type: "message_update",
        message: assistantMessage([{ type: "thinking", thinking: "Check the option expirations" }]),
        assistantMessageEvent: {
          type: "thinking_delta",
          contentIndex: 0,
          delta: "Check the option expirations",
          partial: assistantMessage([
            { type: "thinking", thinking: "Check the option expirations" },
          ]),
        },
      }),
    );
    adapter.handle(
      agentEvent({
        type: "message_update",
        message: assistantMessage([{ type: "thinking", thinking: "Check the option expirations" }]),
        assistantMessageEvent: {
          type: "thinking_end",
          contentIndex: 0,
          content: "Check the option expirations",
          partial: assistantMessage([
            { type: "thinking", thinking: "Check the option expirations" },
          ]),
        },
      }),
    );

    expect(events).toEqual([
      {
        type: "thinking.delta",
        sessionId: "session-1",
        runId: "run-1",
        text: "Check the option expirations",
        seq: 1,
      },
      {
        type: "thinking.completed",
        sessionId: "session-1",
        runId: "run-1",
        text: "Check the option expirations",
        seq: 2,
      },
    ]);
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

function assistantMessage(content: Array<{ type: "thinking"; thinking: string }>) {
  return {
    role: "assistant" as const,
    content,
    api: "openai-responses",
    provider: "openai",
    model: "test",
    usage: emptyUsage(),
    stopReason: "toolUse" as const,
    timestamp: Date.now(),
  };
}
