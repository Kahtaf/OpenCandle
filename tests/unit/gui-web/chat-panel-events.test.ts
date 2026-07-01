import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "../../../gui/shared/chat-events.js";
import { TooltipProvider } from "../../../gui/web/src/components/ui/tooltip.jsx";
import { ChatPanel } from "../../../gui/web/src/features/chat/ChatPanel.jsx";
import { ToolDrawerProvider } from "../../../gui/web/src/features/chat/tool-drawer-context.jsx";

describe("ChatPanel event transcript rendering", () => {
  function renderChatPanelHtml(props: Partial<React.ComponentProps<typeof ChatPanel>> = {}) {
    return renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(
          ToolDrawerProvider,
          null,
          React.createElement(ChatPanel, {
            events: [],
            liveEvents: [],
            askUserPrompts: [],
            modelSetup: { requirement: "ready" },
            role: "writer",
            runState: "ready",
            catalog: { tools: [], workflows: [], providers: [] },
            send: vi.fn(),
            startChatRun: vi.fn(),
            setToast: vi.fn(),
            onOpenCommandPalette: vi.fn(),
            ...props,
          }),
        ),
      ),
    );
  }

  it("renders the server-adapted user text for persisted workflow turns", () => {
    const events: ChatEvent[] = [
      {
        type: "session.updated",
        sessionId: "session-1",
        updatedAt: "2026-06-12T00:00:00.000Z",
        seq: 1,
      },
      { type: "message.created", messageId: "user-1", role: "user", seq: 2 },
      {
        type: "message.completed",
        messageId: "user-1",
        content: [{ type: "text", text: "quickly compare AAPL and MSFT" }],
        seq: 3,
      },
      { type: "message.created", messageId: "assistant-1", role: "assistant", seq: 4 },
      {
        type: "message.completed",
        messageId: "assistant-1",
        content: [{ type: "text", text: "AAPL and MSFT comparison." }],
        seq: 5,
      },
    ];

    const html = renderChatPanelHtml({ events });

    expect(html).toContain("quickly compare AAPL and MSFT");
    expect(html).not.toContain("Current date: 2026-06-12 Compare these assets");
  });

  it("renders pending ask_user prompts on an otherwise empty thread", () => {
    const html = renderChatPanelHtml({
      askUserPrompts: [
        {
          id: "ask-user-1",
          sessionId: "session-1",
          question:
            "X/Twitter sentiment requires twitter-cli. Install it with `uv tool install twitter-cli`?",
          questionType: "select",
          options: [
            "Continue after installing twitter-cli",
            "Skip X/Twitter once",
            "Always skip X/Twitter",
          ],
          reason: "X/Twitter sentiment needs the twitter-cli command before it can fetch tweets.",
          status: "pending",
          answer: null,
        },
      ],
    });

    expect(html).toContain("X/Twitter sentiment requires twitter-cli");
    expect(html).toContain("Continue after installing twitter-cli");
    expect(html).toContain("Skip X/Twitter once");
    expect(html).not.toContain("Browse tools");
  });

  it("renders a loading state instead of home suggestions while switching sessions", () => {
    const html = renderChatPanelHtml({
      inputDisabled: true,
      sessionLoading: true,
    });

    expect(html).toContain('aria-label="Loading session"');
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("What are we watching");
    expect(html).not.toContain("Compare NVDA and AMD");
  });

  it("renders scoped live thinking text for the active run", () => {
    const html = renderChatPanelHtml({
      runState: "streaming",
      liveEvents: [
        { type: "run.started", sessionId: "session-1", runId: "run-1", seq: 1 },
        {
          type: "thinking.delta",
          sessionId: "session-1",
          runId: "run-1",
          text: "Reviewing the latest quote data",
          seq: 2,
        },
      ],
    });

    expect(html).toContain("Reviewing the latest quote data");
  });

  it("disables chat submission while model setup is incomplete", () => {
    const html = renderChatPanelHtml({
      draft: "Can I buy AAPL today?",
      modelSetup: {
        requirement: "connect_auth",
        providers: [],
        availableModels: [],
      },
    });

    expect(html).toContain("Draft a question, then connect a model to send");
    expect(html).toContain('id="chat-composer"');
    expect(html).toContain("disabled");
    expect(html).toContain('aria-label="Send message"');
  });
});
