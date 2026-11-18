import { describe, expect, it, vi } from "vitest";
import { verifyReleaseModel } from "../../scripts/release-preflight.mjs";

describe("release model preflight", () => {
  it("fails before a request if the required credential is absent", async () => {
    const request = vi.fn();
    await expect(verifyReleaseModel({}, request)).rejects.toThrow("GEMINI_API_KEY");
    expect(request).not.toHaveBeenCalled();
  });

  it("checks an actual generation on the pinned model and keeps secrets out of the URL", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "OK" }] } }],
          }),
        ),
    );
    await expect(
      verifyReleaseModel({ GEMINI_API_KEY: "test-key" }, request),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-goog-api-key": "test-key" }),
      }),
    );
  });

  it("reports access errors without printing a provider response body", async () => {
    await expect(
      verifyReleaseModel(
        { GOOGLE_API_KEY: "secret-value" },
        async () => new Response("secret-value", { status: 403 }),
      ),
    ).rejects.toThrow(
      /^Release model google\/gemini-2.5-flash rejected the preflight \(HTTP 403\)$/,
    );
  });
});
