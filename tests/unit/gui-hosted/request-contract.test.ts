import { describe, expect, it } from "vitest";
import { parseGuiRequest } from "../../../gui/hosted/runtime/request-contract.js";

describe("hosted GUI request contract", () => {
  it("accepts only bounded hosted provider credential validation requests", () => {
    expect(
      parseGuiRequest({
        action: "validate_provider_key",
        providerId: "fred",
        apiKey: "candidate-key",
      }),
    ).toEqual({
      action: "validate_provider_key",
      providerId: "fred",
      apiKey: "candidate-key",
    });
    expect(() =>
      parseGuiRequest({
        action: "validate_provider_key",
        providerId: "unknown",
        apiKey: "candidate-key",
      }),
    ).toThrow("provider");
  });

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
