import { describe, expect, it } from "vitest";
import { parseGuiRequest } from "../../../gui/hosted/runtime/request-contract.js";
import { hostedGuiActionBlocksUpdate } from "../../../gui/shared/hosted-gui-protocol.js";

describe("hosted GUI request contract", () => {
  it("accepts Pi thinking level changes", () => {
    expect(parseGuiRequest({ action: "configure_thinking", level: "high" })).toEqual({
      action: "configure_thinking",
      level: "high",
    });
    expect(() => parseGuiRequest({ action: "configure_thinking", level: "turbo" })).toThrow(
      "thinking level",
    );
  });
  it("uses one action contract to classify durable mutations", () => {
    expect(hostedGuiActionBlocksUpdate("bootstrap")).toBe(false);
    expect(hostedGuiActionBlocksUpdate("instrument_history")).toBe(false);
    expect(hostedGuiActionBlocksUpdate("chat_run")).toBe(true);
    expect(hostedGuiActionBlocksUpdate("unknown")).toBe(true);
  });
  it("accepts any installed Pi model from each browser-safe first-class provider", () => {
    for (const request of [
      { provider: "openai", modelId: "gpt-5-mini" },
      { provider: "anthropic", modelId: "claude-haiku-4-5" },
      { provider: "google", modelId: "gemini-2.5-flash" },
    ] as const) {
      expect(
        parseGuiRequest({ action: "configure_model", ...request, apiKey: "live-key" }),
      ).toEqual({ action: "configure_model", ...request, apiKey: "live-key" });
    }
  });

  it("rejects model ids that do not belong to the selected Pi provider", () => {
    expect(() =>
      parseGuiRequest({
        action: "configure_model",
        provider: "openai",
        modelId: "claude-haiku-4-5",
        apiKey: "live-key",
      }),
    ).toThrow("provider or model");
  });

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

  it("accepts the shared GUI attachment contract", () => {
    const image = Buffer.from("png").toString("base64");
    expect(
      parseGuiRequest({
        action: "chat_run",
        sessionId: "session-1",
        actionId: "action-1",
        prompt: "Review this",
        images: [{ data: image, mimeType: "image/png" }],
        attachments: [{ kind: "portfolio", id: "1" }],
      }),
    ).toEqual({
      action: "chat_run",
      sessionId: "session-1",
      actionId: "action-1",
      prompt: "Review this",
      images: [{ data: image, mimeType: "image/png" }],
      attachments: [{ kind: "portfolio", id: "1" }],
    });
  });

  it("accepts the same ask_user actions as the local GUI", () => {
    expect(
      parseGuiRequest({
        action: "ask_user.answer",
        sessionId: "session-1",
        id: "ask-user-1",
        answer: "AAPL",
      }),
    ).toEqual({
      action: "ask_user.answer",
      sessionId: "session-1",
      id: "ask-user-1",
      answer: "AAPL",
    });
    expect(
      parseGuiRequest({
        action: "ask_user.cancel",
        sessionId: "session-1",
        id: "ask-user-1",
      }),
    ).toEqual({
      action: "ask_user.cancel",
      sessionId: "session-1",
      id: "ask-user-1",
    });
  });
});
