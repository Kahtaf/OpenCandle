import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../../../src/config.js";
import { cache } from "../../../src/infra/cache.js";
import * as lseByteBudget from "../../../src/infra/lse-byte-budget.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import {
  getLseCandles,
  getLseFinancialReports,
  LseHttpError,
  toLseTimeframe,
} from "../../../src/providers/lse.js";
import { ProviderCredentialError } from "../../../src/providers/provider-credential-error.js";
import candlesFixture from "../../fixtures/lse/candles-AAPL-1d.json";
import allowanceFixture from "../../fixtures/lse/error-429-allowance.json";

vi.mock("../../../src/config.js", () => ({
  getConfig: vi.fn(() => ({ lseApiKey: "test-lse-key" })),
}));

vi.mock("../../../src/infra/lse-byte-budget.js", () => ({
  markExhausted: vi.fn(),
  recordBytes: vi.fn(),
}));

const mockedGetConfig = vi.mocked(getConfig);

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("LSE provider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
    rateLimiter.configure("lse", 100, 1.66);
    mockedGetConfig.mockReturnValue({ lseApiKey: "test-lse-key" });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches candles with authentication and caches the response", async () => {
    const acquireSpy = vi.spyOn(rateLimiter, "acquire");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(candlesFixture));
    vi.stubGlobal("fetch", fetchMock);

    const first = await getLseCandles("AAPL", "1d");
    const second = await getLseCandles("AAPL", "1d");

    expect(first).toEqual(candlesFixture);
    expect(second).toEqual(candlesFixture);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(acquireSpy).toHaveBeenCalledWith("lse");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.londonstrategicedge.com/vault/candles?symbol=AAPL&timeframe=1d",
      expect.objectContaining({
        headers: { "x-api-key": "test-lse-key" },
      }),
    );
  });

  it.each([
    401, 403,
  ])("throws a stale credential error before serving stale cache on %i", async (status) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00Z"));
    rateLimiter.configure("lse", 100, 1.66);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(candlesFixture))
      .mockResolvedValueOnce(jsonResponse({ detail: "Invalid API key" }, status));
    vi.stubGlobal("fetch", fetchMock);

    await getLseCandles("AAPL", "1d");
    vi.setSystemTime(new Date("2026-07-16T13:00:00.001Z"));

    const error = await getLseCandles("AAPL", "1d").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderCredentialError);
    expect(error).toMatchObject({ provider: "lse", reason: "stale", httpStatus: status });
  });

  it("fails before fetching when the API key is missing", async () => {
    mockedGetConfig.mockReturnValue({});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const error = await getLseCandles("AAPL", "1d").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderCredentialError);
    expect(error).toMatchObject({ provider: "lse", reason: "missing" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns stale candles after all 5xx retry attempts fail", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00Z"));
    rateLimiter.configure("lse", 100, 1.66);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(candlesFixture))
      .mockImplementation(() => Promise.resolve(jsonResponse({ detail: "Unavailable" }, 503)));
    vi.stubGlobal("fetch", fetchMock);

    await getLseCandles("AAPL", "1d");
    vi.setSystemTime(new Date("2026-07-16T13:00:00.001Z"));
    const request = getLseCandles("AAPL", "1d");
    await vi.runAllTimersAsync();

    await expect(request).resolves.toEqual(candlesFixture);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("rethrows the last 5xx error when no stale cache exists", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00Z"));
    rateLimiter.configure("lse", 100, 1.66);
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse({ detail: "Unavailable" }, 503)));
    vi.stubGlobal("fetch", fetchMock);

    const request = getLseCandles("AAPL", "1d").catch((caught: unknown) => caught);
    await vi.runAllTimersAsync();

    const error = await request;
    expect(error).toBeInstanceOf(LseHttpError);
    expect(error).toMatchObject({ status: 503, detail: "Unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("exposes the status and detail for an unknown symbol", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ detail: "Unknown symbol" }, 404)),
    );

    const error = await getLseCandles("UNKNOWN", "1d").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LseHttpError);
    expect(error).toMatchObject({ status: 404, detail: "Unknown symbol" });
  });

  it("records the X-Data-Bytes header from every response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(candlesFixture, 200, { "X-Data-Bytes": "1024" }))
      .mockResolvedValueOnce(
        jsonResponse({ detail: "Unknown symbol" }, 404, { "X-Data-Bytes": "2048" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await getLseCandles("AAPL", "1d");
    await getLseCandles("UNKNOWN", "1d").catch(() => undefined);

    expect(lseByteBudget.recordBytes).toHaveBeenNthCalledWith(1, 1024);
    expect(lseByteBudget.recordBytes).toHaveBeenNthCalledWith(2, 2048);
  });

  it("marks an allowance 429 exhausted and does not retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(allowanceFixture, 429));
    vi.stubGlobal("fetch", fetchMock);

    const error = await getLseCandles("AAPL", "1d").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LseHttpError);
    expect(lseByteBudget.markExhausted).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("retries an ordinary 429 after a Retry-After delay capped at five seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00Z"));
    rateLimiter.configure("lse", 100, 1.66);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ detail: "Rate limit exceeded" }, 429, { "Retry-After": "10" }),
      )
      .mockResolvedValueOnce(jsonResponse(candlesFixture));
    vi.stubGlobal("fetch", fetchMock);

    const request = getLseCandles("AAPL", "1d");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetchMock).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);

    await expect(request).resolves.toEqual(candlesFixture);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fetches and caches financial reports with all provided query parameters", async () => {
    const reportRows: Record<string, unknown>[] = [{}];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(reportRows));
    vi.stubGlobal("fetch", fetchMock);

    const opts = {
      period: "FY" as const,
      start: "2024-01-01",
      end: "2025-01-01",
      order: "desc" as const,
      limit: 5,
    };
    const first = await getLseFinancialReports("AAPL", "income", opts);
    const second = await getLseFinancialReports("AAPL", "income", opts);

    expect(first).toEqual(reportRows);
    expect(second).toEqual(reportRows);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.londonstrategicedge.com/vault/ref/financial_reports?symbol=AAPL&report_type=income&period=FY&start=2024-01-01&end=2025-01-01&order=desc&limit=5",
      expect.objectContaining({ headers: { "x-api-key": "test-lse-key" } }),
    );
  });

  it.each([
    ["1m", "1m"],
    ["5m", "5m"],
    ["15m", "15m"],
    ["1h", "1h"],
    ["1d", "1d"],
    ["1wk", "1w"],
    ["1mo", "1mo"],
    ["4h", undefined],
    ["garbage", undefined],
  ])("maps timeframe %s to %s", (interval, expected) => {
    expect(toLseTimeframe(interval)).toBe(expected);
  });

  it("maps timeframes without reading config or the byte budget", () => {
    expect(toLseTimeframe("1wk")).toBe("1w");
    expect(mockedGetConfig).not.toHaveBeenCalled();
    expect(lseByteBudget.recordBytes).not.toHaveBeenCalled();
    expect(lseByteBudget.markExhausted).not.toHaveBeenCalled();
  });
});
