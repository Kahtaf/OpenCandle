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

  describe("runs interrupted by Stop", () => {
    const user = (text: string, id = "message-user-1") => ({
      id,
      type: "user_message",
      content: [{ type: "text", text }],
    });
    const toolCall = (id: string, symbol: string, messageId = `assistant-${id}`) => ({
      id: `message-${messageId}`,
      type: "assistant_message",
      sessionId: "session-1",
      messageId,
      content: [{ type: "toolCall", id, name: "get_stock_quote", arguments: { symbol } }],
    });
    const toolResult = (id: string, text: string, isError = false) => ({
      id: `tool-${id}`,
      type: "tool_result",
      sessionId: "session-1",
      message: {
        toolCallId: id,
        toolName: "get_stock_quote",
        content: [{ type: "text", text }],
        isError,
      },
    });
    const stoppedMarker = (id = "stopped-1") => ({
      id: `message-${id}`,
      type: "custom_message",
      sessionId: "session-1",
      customType: "opencandle-run-cancelled",
      content: [{ type: "text", text: "Run stopped before it produced an answer." }],
      details: { reason: "aborted", prompt: "Compare AAPL and MSFT" },
    });
    const runOf = (rows: unknown[]) =>
      groupToolRuns(rows).find((row: { type: string }) => row.type === "tool_run");

    it("reads stopped, not completed, when Stop lands between steps", () => {
      const run = runOf([
        user("Compare AAPL and MSFT"),
        toolCall("quote-1", "AAPL"),
        toolResult("quote-1", "AAPL $189.42"),
        stoppedMarker(),
      ]);
      expect(run.status).toBe("stopped");
      expect(run.steps.map((step: { status: string }) => step.status)).toEqual(["completed"]);
    });

    it("marks steps that never returned as cancelled", () => {
      const run = runOf([
        user("Compare AAPL and MSFT"),
        toolCall("quote-1", "AAPL"),
        toolResult("quote-1", "AAPL $189.42"),
        toolCall("quote-2", "MSFT"),
        stoppedMarker(),
      ]);
      expect(run.status).toBe("stopped");
      expect(run.steps.map((step: { status: string }) => step.status)).toEqual([
        "completed",
        "cancelled",
      ]);
    });

    it("treats a tool the Stop aborted as cancelled rather than a tool error", () => {
      const run = runOf([
        user("Hold the NVDA tool"),
        toolCall("quote-1", "NVDA"),
        toolResult("quote-1", "Operation aborted", true),
        stoppedMarker(),
      ]);
      expect(run.status).toBe("stopped");
      expect(run.steps[0].status).toBe("cancelled");
      expect(run.failureReason).toBe("");
    });

    it.each(["This operation was aborted", "The operation was aborted.", "Request was aborted."])(
      "treats the abort error %j as a cancelled step under a Stop",
      (text) => {
        const run = runOf([
          user("Hold the NVDA tool"),
          toolCall("quote-1", "NVDA"),
          toolResult("quote-1", text, true),
          stoppedMarker(),
        ]);
        expect(run.steps[0].status).toBe("cancelled");
      },
    );

    it("reads stopped when Stop cut off the answer that followed the tools", () => {
      const run = runOf([
        user("What is AAPL trading at?"),
        toolCall("quote-1", "AAPL"),
        toolResult("quote-1", "AAPL $189.42"),
        {
          id: "message-assistant-partial",
          type: "assistant_message",
          sessionId: "session-1",
          content: [{ type: "text", text: "AAPL is trading" }],
        },
        stoppedMarker(),
      ]);
      expect(run.status).toBe("stopped");
    });

    it("leaves a finished run completed when a later turn is stopped", () => {
      const rows = groupToolRuns([
        user("What is AAPL trading at?"),
        toolCall("quote-1", "AAPL"),
        toolResult("quote-1", "AAPL $189.42"),
        {
          id: "message-assistant-answer",
          type: "assistant_message",
          sessionId: "session-1",
          content: [{ type: "text", text: "AAPL is trading at $189.42." }],
        },
        user("Now MSFT", "message-user-2"),
        stoppedMarker(),
      ]);
      const runs = rows.filter((row: { type: string }) => row.type === "tool_run");
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("completed");
    });

    it("keeps genuine tool errors as errors when the run was not stopped", () => {
      const run = runOf([
        user("What is AAPL trading at?"),
        toolCall("quote-1", "AAPL"),
        toolResult("quote-1", "Quote unavailable.", true),
      ]);
      expect(run.status).toBe("error");
      expect(run.failureReason).toBe("Quote unavailable.");
    });
  });
});
