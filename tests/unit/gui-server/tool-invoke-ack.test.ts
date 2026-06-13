import { describe, expect, it } from "vitest";
import { buildToolInvokeAckMessage } from "../../../gui/server/tool-invoke-ack.js";

describe("buildToolInvokeAckMessage", () => {
  it("acks successful tool invocations as ok", () => {
    const message = buildToolInvokeAckMessage("req-1", "manage_watchlist", {
      toolCallId: "ui-1",
      isError: false,
      result: {
        content: [{ type: "text", text: "Added AAPL" }],
        details: { id: 1 },
      },
    });

    expect(message).toEqual({
      type: "tool.invoke.result",
      requestId: "req-1",
      ok: true,
      toolName: "manage_watchlist",
      result: {
        toolCallId: "ui-1",
        content: [{ type: "text", text: "Added AAPL" }],
        details: { id: 1 },
        isError: false,
      },
    });
  });

  it("acks non-throwing failed tool invocations as errors", () => {
    const message = buildToolInvokeAckMessage("req-2", "manage_watchlist", {
      toolCallId: "ui-2",
      isError: true,
      result: {
        content: [{ type: "text", text: "Provider rejected the symbol" }],
        details: null,
      },
    });

    expect(message).toMatchObject({
      type: "tool.invoke.result",
      requestId: "req-2",
      ok: false,
      toolName: "manage_watchlist",
      error: { message: "Provider rejected the symbol" },
      result: {
        toolCallId: "ui-2",
        details: null,
        isError: true,
      },
    });
  });
});
