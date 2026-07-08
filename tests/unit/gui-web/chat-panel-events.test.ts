import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("renders user attachment chips and image thumbnails without exposing expanded prompt text", () => {
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
        content: [
          { type: "text", text: "am I too concentrated?" },
          { type: "image", data: "iVBORw0KGgo=", mimeType: "image/png", alt: "chart.png" },
        ],
        attachments: [{ kind: "portfolio", label: "Portfolio" }],
        seq: 3,
      },
    ];

    const html = renderChatPanelHtml({ events });

    expect(html).toContain("am I too concentrated?");
    expect(html).toContain("Portfolio");
    expect(html).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(html).not.toContain("[Attached by user");
  });

  it("renders bare dashboard-known symbols as entity chips in chat messages", () => {
    const events: ChatEvent[] = [
      { type: "message.created", messageId: "assistant-1", role: "assistant", seq: 1 },
      {
        type: "message.completed",
        messageId: "assistant-1",
        content: [{ type: "text", text: "NVDA and CPI update." }],
        seq: 2,
      },
    ];

    const html = renderChatPanelHtml({
      events,
      dashboard: { knownSymbols: ["NVDA"] },
    });

    expect(html).toContain('data-symbol="NVDA"');
    expect(html).toContain(" and CPI update.");
  });

  it("delegates entity chip clicks by data-symbol", () => {
    const source = readFileSync(resolve("gui/web/src/features/chat/ChatPanel.jsx"), "utf-8");

    expect(source).toContain('"[data-symbol]"');
    expect(source).toContain("setSelectedSymbol(symbol.toUpperCase())");
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

  it("keeps ask_user controls available in non-owner windows for proxying", () => {
    const html = renderChatPanelHtml({
      role: "follower",
      askUserPrompts: [
        {
          id: "ask-user-1",
          sessionId: "session-1",
          question: "Continue?",
          questionType: "confirm",
          options: ["Yes", "No"],
          reason: "",
          status: "pending",
          answer: null,
        },
      ],
    });

    expect(html).toContain("Continue?");
    expect(html).toMatch(/<button(?![^>]*disabled="")[^>]*>Answer yes/);
    expect(html).not.toMatch(/writer|follower|read-only|takeover/i);
  });

  it("routes ask_user actions through the prompt session id", () => {
    const source = readFileSync(resolve("gui/web/src/features/chat/ChatPanel.jsx"), "utf-8");
    const cardStart = source.indexOf("function AskUserPromptCard");
    const cardSource = source.slice(cardStart, source.indexOf("return (", cardStart));

    expect(cardSource).toContain("sessionId: prompt.sessionId");
  });

  it("keeps home sends available for non-owner sessions that can be proxied", () => {
    const source = readFileSync(resolve("gui/web/src/App.jsx"), "utf-8");

    expect(source).not.toContain("homeNeedsFreshWriterSession");
    expect(source).toContain('canStartFreshHomeSession: gui.role === "writer"');
    expect(source).toContain("Non-owner windows submit to the active session");
  });

  it("keeps non-chat actions unavailable for TUI-owned routed sessions", () => {
    const source = readFileSync(resolve("gui/web/src/App.jsx"), "utf-8");

    expect(source).toContain("const nonChatActionsUnavailable");
    expect(source).toContain('gui.coordination?.ownerKind === "tui"');
    expect(source).not.toContain(
      'gui.coordination?.ownerKind === "tui" &&\n    gui.role !== "writer"',
    );
    expect(source).toContain("const visibleAskUserPrompts = nonChatActionsUnavailable");
    // The unavailable branch must reject (not return a bare false) so awaiting
    // consumers treat the blocked invocation as a failure instead of a success.
    expect(source).toContain("return Promise.reject(new Error(message));");
    expect(source).not.toContain("return false;\n      }\n      return gui.invokeTool(");
  });

  it("preserves direct tool invocation options for market-state actions", () => {
    const source = readFileSync(resolve("gui/web/src/App.jsx"), "utf-8");

    expect(source).toContain("(toolName, args, targetSessionId, options) =>");
    expect(source).toContain(
      "return gui.invokeTool(toolName, args, targetSessionId ?? sessionView.activeSessionId, options);",
    );
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
