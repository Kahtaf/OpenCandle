import { describe, expect, it } from "vitest";
import { groupToolRuns } from "../../../gui/web/src/features/chat/tool-run-grouper.js";

describe("groupToolRuns", () => {
  it("renders orphaned tool results as one-step runs", () => {
    const rows = [
      {
        id: "row-1",
        type: "tool_result",
        message: {
          toolName: "get_stock_quote",
          content: [{ type: "text", text: "AAPL quote" }],
          isError: false,
        },
      },
    ];

    expect(groupToolRuns(rows)).toEqual([
      expect.objectContaining({
        type: "tool_run",
        id: "run-row-1",
        status: "completed",
        steps: [
          expect.objectContaining({
            name: "get_stock_quote",
            status: "completed",
            result: rows[0].message,
          }),
        ],
      }),
    ]);
  });

  it("carries session identity from assistant tool calls into grouped runs", () => {
    const rows = [
      {
        id: "message-assistant-1",
        type: "assistant_message",
        sessionId: "session-a",
        messageId: "assistant-1",
        content: [
          {
            type: "toolCall",
            id: "quote-1",
            name: "get_stock_quote",
            arguments: { symbol: "AAPL" },
            sessionId: "session-a",
          },
        ],
      },
      {
        id: "tool-quote-1",
        type: "tool_result",
        sessionId: "session-a",
        message: {
          toolCallId: "quote-1",
          toolName: "get_stock_quote",
          content: [{ type: "text", text: "AAPL quote" }],
          isError: false,
          sessionId: "session-a",
        },
      },
    ];

    expect(groupToolRuns(rows)).toEqual([
      expect.objectContaining({
        type: "tool_run",
        id: "run-quote-1",
        sessionId: "session-a",
        steps: [
          expect.objectContaining({
            id: "quote-1",
            sessionId: "session-a",
            result: expect.objectContaining({ sessionId: "session-a" }),
          }),
        ],
      }),
    ]);
  });
});
