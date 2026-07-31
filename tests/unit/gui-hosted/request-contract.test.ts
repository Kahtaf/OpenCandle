import { describe, expect, it } from "vitest";
import { parseGuiRequest } from "../../../gui/hosted/runtime/request-contract.js";

describe("hosted GUI request contract", () => {
  it("rejects attachments explicitly instead of silently discarding them", () => {
    expect(() =>
      parseGuiRequest({
        action: "chat_run",
        sessionId: "session-1",
        actionId: "action-1",
        prompt: "Review this",
        images: [{ data: "abc", mimeType: "image/png" }],
      }),
    ).toThrow("attachments");
    expect(() =>
      parseGuiRequest({
        action: "chat_run",
        sessionId: "session-1",
        actionId: "action-1",
        prompt: "Review this",
        attachments: [{ kind: "portfolio", id: "1" }],
      }),
    ).toThrow("attachments");
  });
});
