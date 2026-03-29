import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { httpGet, HttpError } from "../../../src/infra/http-client.js";

describe("httpGet", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
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
});
