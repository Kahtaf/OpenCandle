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
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain("Session transcript</h1>");
    expect(html).not.toContain("Current date: 2026-06-12 Compare these assets");
    expect(html).not.toContain('data-slot="home-dashboard"');
  });

  it("renders internal workflow prompts as collapsed step cards", () => {
    const events: ChatEvent[] = [
      { type: "message.created", messageId: "user-1", role: "user", seq: 1 },
      {
        type: "message.completed",
        messageId: "user-1",
        content: [{ type: "text", text: "Analyze NVDA" }],
        seq: 2,
      },
      {
        type: "custom.message",
        messageId: "workflow-step-user-1",
        customType: "opencandle-workflow-step",
        content: [{ type: "text", text: "Full internal bear researcher prompt" }],
        details: {
          label: "Bear researcher",
          stage: "debate_bear",
          step: 4,
          total: 7,
        },
        seq: 3,
      },
    ];

    const html = renderChatPanelHtml({ events });

    expect(html).toContain('data-slot="workflow-step"');
    expect(html).toContain("Bear researcher");
    expect(html).toContain("step 4 of 7");
    expect(html).toContain("Full internal bear researcher prompt");
    expect(html).toContain("<details");
    expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
    expect(html).toContain("min-h-10");
    expect(html).toContain("focus-visible:ring-2");
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

  it("shows receipt and forwarding progress before the canonical stream arrives", () => {
    const html = renderChatPanelHtml({
      role: "follower",
      runState: "connecting",
      liveEvents: [
        { type: "message.created", messageId: "optimistic-user-1", role: "user", seq: 1 },
        {
          type: "message.completed",
          messageId: "optimistic-user-1",
          content: [{ type: "text", text: "Analyze AAPL" }],
          seq: 2,
        },
      ],
    });

    expect(html).toContain("Queued");
    expect(html).toContain("Sending to the active tab…");
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

  it("preserves the fresh-home session target, one retry, and run-started adoption", () => {
    const appSource = readFileSync(resolve("gui/web/src/App.jsx"), "utf-8");
    const homeSources = [
      "HomeDashboard.jsx",
      "IndicesStrip.jsx",
      "WatchlistMovers.jsx",
      "PortfolioSummaryStrip.jsx",
      "AlertsCard.jsx",
      "MarketStateAffordanceCard.jsx",
    ]
      .map((file) => readFileSync(resolve("gui/web/src/features/home", file), "utf-8"))
      .join("\n");

    expect(appSource).toContain('canStartFreshHomeSession: gui.role === "writer"');
    expect(appSource).toContain("for (let attempt = 0; attempt < 2; attempt++)");
    expect(appSource).toContain("const freshSessionId = await createFreshHomeSession()");
    expect(appSource).toContain("const homeSessionCreationRef = useRef(null)");
    expect(appSource).toContain("baseEventCount: 0");
    expect(appSource).toContain('event.type !== "run.started"');
    expect(appSource).toContain("gui.adoptSessionId(sessionId)");
    expect(homeSources).not.toContain("startChatRun");
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
      "return gui.invokeTool(\n        toolName,\n        args,\n        targetSessionId ?? sessionView.activeSessionId,\n        options,\n      );",
    );
  });

  it("passes the selected watchlist name when a chat entity chip is added", () => {
    const source = readFileSync(resolve("gui/web/src/features/chat/ChatPanel.jsx"), "utf-8");

    expect(source).toContain("watchlist_name: watchlist.name");
    expect(source).toContain("watchlists={marketState.state?.watchlists}");
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

  it("keeps the composer in the centered empty-home block only before the first message", () => {
    const html = renderChatPanelHtml();

    expect(html).toContain('data-slot="home-dashboard"');
    expect(html.indexOf('data-slot="home-composer"')).toBeLessThan(
      html.indexOf('data-slot="home-widget-grid"'),
    );
    expect(html).toContain('data-slot="home-saved-state-skeleton"');
  });

  it("does not read per-session research fields while composing home", () => {
    const accessed = new Set<PropertyKey>();
    const dashboard = new Proxy(
      { knownSymbols: [] },
      {
        get(target, property, receiver) {
          accessed.add(property);
          return Reflect.get(target, property, receiver);
        },
      },
    );

    const html = renderChatPanelHtml({ dashboard });

    expect(html).toContain('data-slot="home-dashboard"');
    expect(accessed.has("activeAnalyses")).toBe(false);
    expect(accessed.has("recentResearch")).toBe(false);
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
          text: "**Reviewing the latest quote data**\n- Comparing volume",
          seq: 2,
        },
      ],
    });

    expect(html).toContain("Reviewing the latest quote data");
    expect(html).toContain("Comparing volume");
    expect(html).not.toContain("**Reviewing");
    expect(html).not.toContain("- Comparing volume");
    expect(html).not.toContain('data-slot="home-dashboard"');
  });

  it("keeps the home surface and a draftable composer behind first-run setup", () => {
    const source = readFileSync(resolve("gui/web/src/features/chat/ChatPanel.jsx"), "utf-8");
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
    // First-run setup is a modal dialog now (portalled, so absent from
    // static markup). The home surface renders behind it and the composer is
    // never disabled by setup — see first-run-setup-dialog.test.ts for the
    // dialog's own open/dismiss/focus behavior.
    expect(html).toContain('data-slot="home-dashboard"');
    expect(html).not.toContain('data-slot="carousel"');
    expect(source).toContain('variant="first-run"');
    expect(source).toContain("Connect or select an AI model before sending this message.");
    expect(source.indexOf("if (needsSetup)")).toBeLessThan(
      source.indexOf("void startChatRun(prompt"),
    );
  });

  it("renders the same read-only home widgets for follower windows", () => {
    const writerHtml = renderChatPanelHtml({ role: "writer" });
    const followerHtml = renderChatPanelHtml({ role: "follower" });

    for (const slot of ["home-dashboard", "home-widget-grid", "home-indices-strip"]) {
      expect(writerHtml).toContain(`data-slot="${slot}"`);
      expect(followerHtml).toContain(`data-slot="${slot}"`);
    }
    expect(followerHtml).not.toMatch(/writer-only|take ownership|read-only dashboard/i);
  });
});
