// Unit tests for the provider credential validator dispatcher. Each test
// mocks `globalThis.fetch` directly so the validator can be exercised
// without touching the network.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateCredential } from "../../../src/onboarding/validation.js";

const originalFetch = globalThis.fetch;

function mockFetchOnce(responseInit: {
  ok?: boolean;
  status?: number;
  body?: string;
  throwError?: Error;
}): () => Request {
  const calls: Request[] = [];
  const fakeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req =
      typeof input === "string" || input instanceof URL
        ? new Request(input.toString(), init)
        : input;
    calls.push(req);
    if (responseInit.throwError) throw responseInit.throwError;
    return new Response(responseInit.body ?? "{}", {
      status: responseInit.status ?? 200,
    });
  });
  globalThis.fetch = fakeFetch as unknown as typeof globalThis.fetch;
  return () => calls[0];
}

describe("validateCredential", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("alpha_vantage", () => {
    it("returns valid on 200 OK with normal quote JSON", async () => {
      mockFetchOnce({
        status: 200,
        body: JSON.stringify({ "Global Quote": { "01. symbol": "IBM", "05. price": "123.45" } }),
      });

      const result = await validateCredential("alpha_vantage", "good-key");
      expect(result.status).toBe("valid");
    });

    it("returns invalid on 401", async () => {
      mockFetchOnce({ status: 401 });

      const result = await validateCredential("alpha_vantage", "bad-key");
      expect(result.status).toBe("invalid");
      if (result.status === "invalid") {
        expect(result.httpStatus).toBe(401);
      }
    });

    it("returns invalid when the JSON body contains an Error Message", async () => {
      // Alpha Vantage frequently returns HTTP 200 with an error shape in the
      // JSON body instead of a 4xx status code. The validator must inspect
      // the body to catch this.
      mockFetchOnce({
        status: 200,
        body: JSON.stringify({
          "Error Message": "Invalid API call. Please retry or visit the documentation...",
        }),
      });

      const result = await validateCredential("alpha_vantage", "bad-key");
      expect(result.status).toBe("invalid");
    });

    it("returns invalid when the JSON body carries an Information rate-limit-like message that mentions invalid api", async () => {
      mockFetchOnce({
        status: 200,
        body: JSON.stringify({
          Information:
            "Invalid API key. Please claim your free API key on https://www.alphavantage.co/support/#api-key",
        }),
      });

      const result = await validateCredential("alpha_vantage", "bad-key");
      expect(result.status).toBe("invalid");
    });

    it("returns transient on network error", async () => {
      mockFetchOnce({ throwError: new Error("ECONNRESET") });

      const result = await validateCredential("alpha_vantage", "whatever");
      expect(result.status).toBe("transient");
      if (result.status === "transient") {
        expect(result.reason).toContain("ECONNRESET");
      }
    });

    it("returns transient on HTTP 503", async () => {
      mockFetchOnce({ status: 503 });

      const result = await validateCredential("alpha_vantage", "whatever");
      expect(result.status).toBe("transient");
    });

    it("sends the key via apikey query parameter", async () => {
      const getRequest = mockFetchOnce({ status: 200, body: "{}" });
      await validateCredential("alpha_vantage", "key-123");
      const req = getRequest();
      expect(req.url).toContain("apikey=key-123");
    });
  });

  describe("fred", () => {
    it("returns valid on 200", async () => {
      mockFetchOnce({
        status: 200,
        body: JSON.stringify({ seriess: [{ id: "GDP" }] }),
      });
      const result = await validateCredential("fred", "abcdef1234567890abcdef1234567890");
      expect(result.status).toBe("valid");
    });

    it("returns invalid on 400 (FRED's shape for bad keys)", async () => {
      mockFetchOnce({
        status: 400,
        body: '{"error_code":400,"error_message":"Bad Request. The api_key is not registered."}',
      });
      const result = await validateCredential("fred", "bad");
      expect(result.status).toBe("invalid");
    });

    it("sends the key via api_key query parameter", async () => {
      const getRequest = mockFetchOnce({ status: 200, body: "{}" });
      await validateCredential("fred", "fredkey123");
      const req = getRequest();
      expect(req.url).toContain("api_key=fredkey123");
    });
  });

  describe("finnhub", () => {
    it("returns valid on 200", async () => {
      mockFetchOnce({
        status: 200,
        body: JSON.stringify({ c: 123.45, h: 125, l: 122, o: 124, pc: 123, t: Date.now() }),
      });
      const result = await validateCredential("finnhub", "finnhub-key");
      expect(result.status).toBe("valid");
    });

    it("returns invalid on 401", async () => {
      mockFetchOnce({ status: 401 });
      const result = await validateCredential("finnhub", "bad");
      expect(result.status).toBe("invalid");
    });

    it("sends the key via token query parameter", async () => {
      const getRequest = mockFetchOnce({ status: 200, body: "{}" });
      await validateCredential("finnhub", "fh-xyz");
      const req = getRequest();
      expect(req.url).toContain("token=fh-xyz");
    });
  });

  describe("brave", () => {
    it("returns valid on 200", async () => {
      mockFetchOnce({
        status: 200,
        body: JSON.stringify({ web: { results: [] } }),
      });
      const result = await validateCredential("brave", "brave-sub-token");
      expect(result.status).toBe("valid");
    });

    it("returns invalid on 401", async () => {
      mockFetchOnce({ status: 401 });
      const result = await validateCredential("brave", "bad");
      expect(result.status).toBe("invalid");
    });

    it("sends the key via X-Subscription-Token header", async () => {
      const getRequest = mockFetchOnce({ status: 200, body: "{}" });
      await validateCredential("brave", "brave-key");
      const req = getRequest();
      expect(req.headers.get("X-Subscription-Token")).toBe("brave-key");
      // Key must NOT be in the URL for Brave.
      expect(req.url).not.toContain("brave-key");
    });
  });

  describe("exa", () => {
    it("returns valid on 200", async () => {
      mockFetchOnce({
        status: 200,
        body: JSON.stringify({ results: [] }),
      });
      const result = await validateCredential("exa", "exa-key");
      expect(result.status).toBe("valid");
    });

    it("returns invalid on 401", async () => {
      mockFetchOnce({ status: 401 });
      const result = await validateCredential("exa", "bad");
      expect(result.status).toBe("invalid");
    });

    it("sends the key via Exa's supported x-api-key header", async () => {
      const getRequest = mockFetchOnce({ status: 200, body: "{}" });
      await validateCredential("exa", "exa-key");
      const req = getRequest();
      expect(req.method).toBe("POST");
      expect(req.headers.get("authorization")).toBeNull();
      expect(req.headers.get("x-api-key")).toBe("exa-key");
      expect(req.url).not.toContain("exa-key");
    });
  });

  describe("lse", () => {
    it("validates with a candle request and sends the x-api-key header", async () => {
      const getRequest = mockFetchOnce({ status: 200, body: "[]" });

      const result = await validateCredential("lse", "lse-live-key");
      const request = getRequest();

      expect(result.status).toBe("valid");
      expect(request.method).toBe("GET");
      expect(request.url).toBe(
        "https://api.londonstrategicedge.com/vault/candles?symbol=AAPL&timeframe=1d&limit=1",
      );
      expect(request.headers.get("x-api-key")).toBe("lse-live-key");
      expect(request.url).not.toContain("lse-live-key");
    });
  });
});
