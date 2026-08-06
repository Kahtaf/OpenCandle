import { afterEach, describe, expect, it, vi } from "vitest";
import { validateModelKey } from "../../../src/onboarding/validate-model-key.js";

const originalFetch = globalThis.fetch;
const originalProbeBaseUrl = process.env.OPENCANDLE_MODEL_KEY_PROBE_BASE_URL;

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
    if (originalProbeBaseUrl === undefined) {
      delete process.env.OPENCANDLE_MODEL_KEY_PROBE_BASE_URL;
    } else {
      process.env.OPENCANDLE_MODEL_KEY_PROBE_BASE_URL = originalProbeBaseUrl;
    }
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

  it("uses Anthropic's browser-safe Pi request header during validation", async () => {
    const fetchMock = mockFetch(new Response("{}", { status: 200 }));

    await validateModelKey("anthropic", "anthropic-key");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-api-key": "anthropic-key",
          "anthropic-dangerous-direct-browser-access": "true",
        }),
      }),
    );
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

  it("uses the probe base URL override while retaining the provider probe path", async () => {
    process.env.OPENCANDLE_MODEL_KEY_PROBE_BASE_URL = "http://127.0.0.1:9876";
    const fetchMock = mockFetch(new Response("Unauthorized", { status: 401 }));

    await expect(validateModelKey("openai", "bad-key")).resolves.toEqual({
      status: "invalid",
      providerLabel: "OpenAI",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9876/v1/models",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer bad-key" }),
        // A loopback probe stub must not be able to bounce the key-bearing
        // request to a foreign host via a 3xx.
        redirect: "error",
      }),
    );
  });

  it("ignores a non-loopback probe base URL override so keys cannot be exfiltrated", async () => {
    process.env.OPENCANDLE_MODEL_KEY_PROBE_BASE_URL = "http://attacker.example";
    const fetchMock = mockFetch(new Response("Unauthorized", { status: 401 }));

    await validateModelKey("openai", "typed-key");

    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/models", expect.anything());
  });

  it("ignores an unparseable probe base URL override", async () => {
    process.env.OPENCANDLE_MODEL_KEY_PROBE_BASE_URL = "not a url";
    const fetchMock = mockFetch(new Response("Unauthorized", { status: 401 }));

    await validateModelKey("openai", "typed-key");

    expect(fetchMock).toHaveBeenCalledWith("https://api.openai.com/v1/models", expect.anything());
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
