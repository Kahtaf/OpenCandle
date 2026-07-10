import { afterEach, describe, expect, it, vi } from "vitest";
import { validateModelKey } from "../../../src/onboarding/validate-model-key.js";

const originalFetch = globalThis.fetch;

function mockFetch(response: Response | Error): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  return fetchMock;
}

describe("validateModelKey", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejects an OpenAI key when the provider returns 401", async () => {
    mockFetch(new Response("Unauthorized", { status: 401 }));

    await expect(validateModelKey("openai", "bad-key")).resolves.toEqual({
      status: "invalid",
      providerLabel: "OpenAI",
    });
  });

  it("allows saving a key when the validation request has a network failure", async () => {
    mockFetch(new Error("offline"));

    await expect(validateModelKey("anthropic", "network-key")).resolves.toEqual({
      status: "transient",
      providerLabel: "Anthropic",
      reason: "offline",
    });
  });

  it("accepts a Google key after the provider accepts the probe", async () => {
    const fetchMock = mockFetch(new Response("{}", { status: 200 }));

    await expect(validateModelKey("google", "good-key")).resolves.toEqual({
      status: "valid",
      providerLabel: "Google Gemini",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://generativelanguage.googleapis.com/v1beta/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ "x-goog-api-key": "good-key" }),
      }),
    );
  });

  it("rejects a Google key when the provider flags API_KEY_INVALID on a 400", async () => {
    mockFetch(
      new Response(
        JSON.stringify({
          error: {
            code: 400,
            message: "API key not valid. Please pass a valid API key.",
            status: "INVALID_ARGUMENT",
            details: [{ reason: "API_KEY_INVALID" }],
          },
        }),
        { status: 400 },
      ),
    );

    await expect(validateModelKey("google", "bad-key")).resolves.toEqual({
      status: "invalid",
      providerLabel: "Google Gemini",
    });
  });

  it("keeps unrelated 400 responses transient so provider hiccups do not block saving", async () => {
    mockFetch(new Response("Bad Request", { status: 400 }));

    await expect(validateModelKey("openai", "some-key")).resolves.toEqual({
      status: "transient",
      providerLabel: "OpenAI",
      reason: "HTTP 400",
    });
  });
});
