import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ChatEvent } from "../../../gui/shared/chat-events.js";
import { TooltipProvider } from "../../../gui/web/src/components/ui/tooltip.jsx";
import { ChatPanel } from "../../../gui/web/src/features/chat/ChatPanel.jsx";
import { ToolDrawerProvider } from "../../../gui/web/src/features/chat/tool-drawer-context.jsx";

describe("ChatPanel event transcript rendering", () => {
  it("renders the server-adapted user text for persisted workflow turns", () => {
    const events: ChatEvent[] = [
      { type: "session.updated", sessionId: "session-1", updatedAt: "2026-06-12T00:00:00.000Z", seq: 1 },
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

    const html = renderToStaticMarkup(
      React.createElement(TooltipProvider, null,
        React.createElement(ToolDrawerProvider, null,
          React.createElement(ChatPanel, {
            events,
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
          }),
        ),
      ),
    );

    expect(html).toContain("quickly compare AAPL and MSFT");
    expect(html).not.toContain("Current date: 2026-06-12 Compare these assets");
  });
});
