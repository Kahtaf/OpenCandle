import { describe, expect, it } from "vitest";
import { chatRowsFromEvents } from "../../../gui/web/src/features/chat/chat-rows.js";

describe("chat rows custom message details", () => {
  it("keeps custom.message details on the row so failure cards can retry their own prompt", () => {
    const rows = chatRowsFromEvents([
      {
        type: "custom.message",
        sessionId: "s1",
        messageId: "cm1",
        customType: "opencandle-model-run-failed",
        content: [{ type: "text", text: "Chat could not authenticate the configured model key." }],
        details: { source: "gui", reason: "model_auth", prompt: "quote NVDA" },
        seq: 1,
      },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "custom_message",
      customType: "opencandle-model-run-failed",
      details: { prompt: "quote NVDA" },
    });
  });
});
