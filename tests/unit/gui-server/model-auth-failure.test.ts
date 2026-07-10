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
});
