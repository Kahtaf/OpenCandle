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
});
