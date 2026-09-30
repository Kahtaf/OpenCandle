import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StepsCard } from "../../../gui/web/src/features/chat/steps-card.jsx";
import { MobileToolDrawerContent } from "../../../gui/web/src/features/chat/tool-drawer.jsx";
import { ToolDrawerProvider } from "../../../gui/web/src/features/chat/tool-drawer-context.jsx";
import { groupToolRuns } from "../../../gui/web/src/features/chat/tool-run-grouper.js";

// A compare workflow stopped after its first tool returned and while its
// second tool call never ran: the user must see Stopped, never Completed or
// Answer, on both the in-thread card and the drawer.
function stoppedRun() {
  const rows = groupToolRuns([
    { id: "message-user-1", type: "user_message", content: [{ type: "text", text: "Compare" }] },
    {
      id: "message-assistant-1",
      type: "assistant_message",
      sessionId: "session-1",
      content: [
        { type: "toolCall", id: "quote-1", name: "get_stock_quote", arguments: { symbol: "AAPL" } },
        { type: "toolCall", id: "quote-2", name: "get_stock_quote", arguments: { symbol: "MSFT" } },
      ],
    },
    {
      id: "tool-quote-1",
      type: "tool_result",
      sessionId: "session-1",
      message: {
        toolCallId: "quote-1",
        toolName: "get_stock_quote",
        content: [{ type: "text", text: "AAPL $189.42" }],
        isError: false,
      },
    },
    {
      id: "message-stopped-1",
      type: "custom_message",
      sessionId: "session-1",
      customType: "opencandle-run-cancelled",
      content: [{ type: "text", text: "Run stopped before it produced an answer." }],
      details: { reason: "aborted" },
    },
  ]);
  return rows.find((row: { type: string }) => row.type === "tool_run");
}

describe("stopped tool runs", () => {
  it("labels the steps card Stopped instead of Answer", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        ToolDrawerProvider,
        null,
        React.createElement(StepsCard, { run: stoppedRun() }),
      ),
    );
    expect(html).toContain('data-run-status="stopped"');
    expect(html).toContain(">Stopped<");
    expect(html).not.toContain(">Answer<");
    expect(html).not.toContain("Tool error");
    expect(html).toContain("1 of 2 steps");
  });

  it("labels the drawer header Stopped and the unfinished step Stopped, not Errored", () => {
    const html = renderToStaticMarkup(
      React.createElement(MobileToolDrawerContent, {
        run: stoppedRun(),
        onClose: () => undefined,
        Surface: "section",
        Title: "span",
      }),
    );
    expect(html).toContain('data-drawer-run-status="stopped"');
    expect(html).toMatch(/data-drawer-run-status="stopped"[^>]*>Stopped</);
    expect(html).not.toContain("Errored");
    // The finished step keeps its own Completed label; the header does not.
    expect(html.match(/>Stopped</g)?.length).toBe(2);
  });
});
