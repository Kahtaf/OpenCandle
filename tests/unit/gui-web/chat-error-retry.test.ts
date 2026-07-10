import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { StepsCard } from "../../../gui/web/src/features/chat/steps-card.jsx";
import { ToolDrawerProvider } from "../../../gui/web/src/features/chat/tool-drawer-context.jsx";
import { groupToolRuns } from "../../../gui/web/src/features/chat/tool-run-grouper.js";

describe("failed chat tool runs", () => {
  it("keeps the user prompt and failure reason available for retry", () => {
    const rows = groupToolRuns([
      {
        id: "message-user-1",
        type: "user_message",
        content: [{ type: "text", text: "analyze NVDA" }],
      },
      {
        id: "message-assistant-1",
        type: "assistant_message",
        sessionId: "session-1",
        content: [
          {
            type: "toolCall",
            id: "quote-1",
            name: "get_stock_quote",
            arguments: { symbol: "NVDA" },
          },
        ],
      },
      {
        id: "tool-quote-1",
        type: "tool_result",
        sessionId: "session-1",
        message: {
          toolCallId: "quote-1",
          toolName: "get_stock_quote",
          content: [{ type: "text", text: "Quote unavailable." }],
          isError: true,
        },
      },
    ]);
    const run = rows.find((row) => row.type === "tool_run");

    expect(run).toMatchObject({
      status: "error",
      retryPrompt: "analyze NVDA",
      failureReason: "Quote unavailable.",
    });

    const html = renderToStaticMarkup(
      React.createElement(
        ToolDrawerProvider,
        null,
        React.createElement(StepsCard, {
          run,
          onRetry: vi.fn(),
        }),
      ),
    );

    expect(html).toContain("Quote unavailable.");
    expect(html).toContain(">Retry</button>");
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*>Retry<\/button>/);

    const disabledHtml = renderToStaticMarkup(
      React.createElement(
        ToolDrawerProvider,
        null,
        React.createElement(StepsCard, {
          run,
          onRetry: vi.fn(),
          retryDisabled: true,
        }),
      ),
    );

    expect(disabledHtml).toMatch(/<button[^>]*disabled[^>]*>[\s\S]*Retry<\/button>/);
  });
});
