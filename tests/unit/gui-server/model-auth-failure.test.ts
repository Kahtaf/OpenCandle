import { describe, expect, it } from "vitest";
import { isModelAuthenticationFailure } from "../../../gui/server/http-routes.js";

describe("GUI model authentication failures", () => {
  it("classifies provider authorization errors so chat runs can render recovery", () => {
    expect(isModelAuthenticationFailure(new Error("OpenAI API error: 401 invalid_api_key"))).toBe(
      true,
    );
    expect(isModelAuthenticationFailure(new Error("Anthropic returned 403 Forbidden"))).toBe(true);
    expect(
      isModelAuthenticationFailure(new Error("Timed out waiting for the session turn to settle")),
    ).toBe(false);
  });

  it("classifies Google's 400-style invalid-key errors", () => {
    expect(
      isModelAuthenticationFailure(new Error("API key not valid. Please pass a valid API key.")),
    ).toBe(true);
    expect(isModelAuthenticationFailure(new Error("Gemini rejected: API_KEY_INVALID"))).toBe(true);
  });
});
