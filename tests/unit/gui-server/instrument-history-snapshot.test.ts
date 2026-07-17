import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getInstrumentHistorySnapshot,
  resetInstrumentHistoryMemoForTests,
  resolveHistoryRange,
} from "../../../gui/server/market-state-api.js";
import { cache } from "../../../src/infra/cache.js";
import { getHistory } from "../../../src/providers/yahoo-finance.js";
import { fetchHistoryWithFallback } from "../../../src/tools/market/stock-history.js";

vi.mock("../../../src/tools/market/stock-history.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../src/tools/market/stock-history.js")>();
  return { ...actual, fetchHistoryWithFallback: vi.fn() };
});

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getHistory: vi.fn(),
  getQuote: vi.fn(),
}));

beforeEach(() => {
  cache.clear();
  resetInstrumentHistoryMemoForTests();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.mocked(fetchHistoryWithFallback).mockImplementation(async (symbol, range, interval) => {
    try {
      return {
        status: "ok",
        data: await getHistory(symbol, range, interval),
        timestamp: new Date().toISOString(),
        provider: "yahoo",
      };
    } catch (error) {
      return {
        status: "unavailable",
        reason: error instanceof Error ? error.message : "unknown_error",
        provider: "yahoo",
      };
    }
  });
});

describe("resolveHistoryRange", () => {
  it.each([
    ["1D", "1d", "5m"],
    ["5D", "5d", "15m"],
    ["1M", "1mo", "1h"],
    ["6M", "6mo", "1d"],
    ["YTD", "ytd", "1d"],
    ["1Y", "1y", "1d"],
    ["5Y", "5y", "1wk"],
    ["MAX", "max", "1mo"],
  ])("maps %s to Yahoo range %s and interval %s", (label, range, interval) => {
    expect(resolveHistoryRange(label)).toEqual({ range, interval });
  });

  it.each(["1d", "7W"])("rejects unknown case-sensitive range %s", (range) => {
    expect(resolveHistoryRange(range)).toMatchObject({ status: "invalid_request" });
  });

  it("rejects an unknown interval", () => {
    expect(resolveHistoryRange("1D", "2h")).toMatchObject({ status: "invalid_request" });
  });

  it("rejects an override beyond the interval depth cap", () => {
    const result = resolveHistoryRange("1Y", "5m");

    expect(result).toMatchObject({ status: "invalid_request" });
    expect("reason" in result ? result.reason : "").toContain("1Y");
    expect("reason" in result ? result.reason : "").toContain("5m");
  });
});

describe("getInstrumentHistorySnapshot", () => {
  it("returns timestamped Yahoo bars in the instrument history shape", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T14:30:00.000Z"));
    vi.mocked(getHistory).mockResolvedValue([
      {
        date: "2026-07-16",
        timestamp: 1_768_485_000,
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1_000,
      },
      {
        date: "2026-07-16",
        timestamp: 1_768_485_300,
        open: 101,
        high: 103,
        low: 100,
        close: 102,
        volume: 1_200,
      },
    ]);

    await expect(getInstrumentHistorySnapshot("AAPL")).resolves.toEqual({
      status: "ok",
      symbol: "AAPL",
      range: "1D",
      interval: "5m",
      source: "Yahoo Finance",
      fetchedAt: "2026-07-16T14:30:00.000Z",
      dataAsOf: "2026-07-16",
      stale: false,
      prevClose: null,
      bars: [
        {
          time: 1_768_485_000,
          open: 100,
          high: 102,
          low: 99,
          close: 101,
          volume: 1_000,
        },
        {
          time: 1_768_485_300,
          open: 101,
          high: 103,
          low: 100,
          close: 102,
          volume: 1_200,
        },
      ],
    });
    expect(getHistory).toHaveBeenCalledWith("AAPL", "1d", "5m");
  });

  it("returns unavailable instead of throwing when Yahoo fails", async () => {
    vi.mocked(getHistory).mockRejectedValue(new Error("Yahoo unavailable"));

    await expect(getInstrumentHistorySnapshot("FAIL")).resolves.toEqual({
      status: "unavailable",
      reason: "Yahoo unavailable",
    });
  });

  it("returns unavailable when intraday bars lack finite timestamps", async () => {
    vi.mocked(getHistory).mockResolvedValue([
      {
        date: "2026-07-16",
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1_000,
      },
    ]);

    await expect(getInstrumentHistorySnapshot("OLD-CACHE", "1D")).resolves.toMatchObject({
      status: "unavailable",
      dataAsOf: "2026-07-16",
    });
  });

  it("uses midnight UTC times and the prior daily close when daily timestamps are absent", async () => {
    vi.mocked(getHistory).mockResolvedValue([
      {
        date: "2026-07-14",
        open: 98,
        high: 101,
        low: 97,
        close: 100,
        volume: 900,
      },
      {
        date: "2026-07-15",
        open: 100,
        high: 103,
        low: 99,
        close: 102,
        volume: 1_100,
      },
    ]);

    const result = await getInstrumentHistorySnapshot("DAILY-TWO", "1Y");

    expect(result).toMatchObject({
      status: "ok",
      range: "1Y",
      interval: "1d",
      dataAsOf: "2026-07-15",
      prevClose: 100,
      bars: [
        { time: Date.parse("2026-07-14T00:00:00Z") / 1_000 },
        { time: Date.parse("2026-07-15T00:00:00Z") / 1_000 },
      ],
    });
  });

  it("returns a null previous close when a daily prior bar is not derivable", async () => {
    vi.mocked(getHistory).mockResolvedValue([
      {
        date: "2026-07-15",
        open: 100,
        high: 103,
        low: 99,
        close: 102,
        volume: 1_100,
      },
    ]);

    await expect(getInstrumentHistorySnapshot("DAILY-ONE", "1Y")).resolves.toMatchObject({
      status: "ok",
      prevClose: null,
    });
  });
});
