import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, httpGet, httpPost } from "../../../src/infra/http-client.js";

describe("httpGet", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("returns parsed JSON on success", async () => {
    const mockData = { price: 150.25, symbol: "AAPL" };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockData),
    });

    const result = await httpGet<typeof mockData>("https://api.example.com/quote");
    expect(result).toEqual(mockData);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throws HttpError on 4xx responses without retrying", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: () => Promise.resolve("Resource not found"),
    });

    await expect(httpGet("https://api.example.com/missing")).rejects.toThrow(HttpError);
    expect(fetch).toHaveBeenCalledTimes(1); // No retry on client errors
  });

  it("retries on 5xx errors up to maxRetries", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve(""),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: () => Promise.resolve(""),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ recovered: true }),
      });

    const result = await httpGet("https://api.example.com/flaky", {
      maxRetries: 2,
      retryDelayMs: 1,
    });
    expect(result).toEqual({ recovered: true });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting retries", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
      text: () => Promise.resolve(""),
    });

    await expect(
      httpGet("https://api.example.com/down", { maxRetries: 1, retryDelayMs: 1 }),
    ).rejects.toThrow(HttpError);
    expect(fetch).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it("retries on network errors", async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: "ok" }),
      });

    const result = await httpGet("https://api.example.com/retry", {
      maxRetries: 1,
      retryDelayMs: 1,
    });
    expect(result).toEqual({ data: "ok" });
  });

  it("passes custom headers", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await httpGet("https://api.example.com/auth", {
      headers: { Authorization: "Bearer token123" },
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.com/auth",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer token123" },
      }),
    );
  });

  it("HttpError exposes status, statusText, and body", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
      text: () => Promise.resolve("Rate limited"),
    });

    try {
      await httpGet("https://api.example.com/limited");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      const err = e as HttpError;
      expect(err.status).toBe(429);
      expect(err.statusText).toBe("Too Many Requests");
      expect(err.body).toBe("Rate limited");
    }
  });

  it("retries HTTP 429 after the Retry-After delay", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "2" : null) },
        text: () => Promise.resolve("Rate limited"),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ recovered: true }),
      });

    const resultPromise = httpGet("https://api.example.com/limited", {
      maxRetries: 1,
      retryDelayMs: 1,
      maxRetryAfterMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toEqual({ recovered: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("caps oversized Retry-After delays to the safe default", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "60" : null) },
        text: () => Promise.resolve("Rate limited"),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ recovered: true }),
      });

    const resultPromise = httpGet("https://api.example.com/limited", {
      maxRetries: 1,
      retryDelayMs: 1,
    });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toEqual({ recovered: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("caps oversized Retry-After delays to the configured maximum", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "60" : null) },
        text: () => Promise.resolve("Rate limited"),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ recovered: true }),
      });

    const resultPromise = httpGet("https://api.example.com/limited", {
      maxRetries: 1,
      retryDelayMs: 1,
      maxRetryAfterMs: 250,
    });

    await vi.advanceTimersByTimeAsync(249);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(resultPromise).resolves.toEqual({ recovered: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("httpPost", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("sends a JSON POST body and returns typed JSON", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true }),
    });

    const result = await httpPost<{ ok: boolean }>(
      "https://scanner.tradingview.com/america/scan2",
      { columns: ["name", "close"] },
      { headers: { Origin: "https://www.tradingview.com" }, maxRetries: 0 },
    );

    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith(
      "https://scanner.tradingview.com/america/scan2",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ columns: ["name", "close"] }),
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Origin: "https://www.tradingview.com",
        }),
      }),
    );
  });

  it("throws HttpError with response body and does not retry 4xx responses", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: () => Promise.resolve("invalid field"),
    });

    await expect(httpPost("https://example.test", { bad: true })).rejects.toMatchObject({
      status: 400,
      statusText: "Bad Request",
      body: "invalid field",
    } satisfies Partial<HttpError>);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
