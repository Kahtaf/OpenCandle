import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "../../../src/infra/cache.js";
import { getDailyHistory } from "../../../src/providers/alpha-vantage.js";
import { getLseCandles } from "../../../src/providers/lse.js";
import { getHistory } from "../../../src/providers/yahoo-finance.js";
import { stockHistoryTool } from "../../../src/tools/market/stock-history.js";
import candlesFixture from "../../fixtures/lse/candles-AAPL-1d.json";

const configMock = vi.hoisted(() => ({
  alphaVantageApiKey: undefined as string | undefined,
  lseApiKey: "lse-test-key" as string | undefined,
}));
const budgetMock = vi.hoisted(() => ({ overSoftThreshold: false }));

vi.mock("../../../src/config.js", () => ({
  getConfig: () => ({ ...configMock }),
}));
vi.mock("../../../src/infra/lse-byte-budget.js", () => ({
  isOverSoftThreshold: () => budgetMock.overSoftThreshold,
}));
vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getHistory: vi.fn(),
}));
vi.mock("../../../src/providers/alpha-vantage.js", () => ({
  getDailyHistory: vi.fn(),
}));
vi.mock("../../../src/providers/lse.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/providers/lse.js")>();
  return { ...actual, getLseCandles: vi.fn() };
});

describe("get_stock_history tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.alphaVantageApiKey = undefined;
    configMock.lseApiKey = "lse-test-key";
    budgetMock.overSoftThreshold = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("falls back to LSE for intraday history and maps candles to OHLCV", async () => {
    vi.mocked(getHistory).mockRejectedValue(new Error("Yahoo unavailable"));
    vi.mocked(getLseCandles).mockResolvedValue(candlesFixture);

    const result = await stockHistoryTool.execute("call-1", {
      symbol: "aapl",
      range: "5d",
      interval: "5m",
    });

    expect(result.details[0]).toEqual({
      date: candlesFixture[0].ts.slice(0, 10),
      timestamp: Date.parse(`${candlesFixture[0].ts}Z`) / 1_000,
      open: candlesFixture[0].open,
      high: candlesFixture[0].high,
      low: candlesFixture[0].low,
      close: candlesFixture[0].close,
      volume: candlesFixture[0].volume,
    });
    expect(result.content[0]).toMatchObject({ type: "text" });
    if (result.content[0].type !== "text") throw new Error("expected text content");
    expect(result.content[0].text).not.toContain("Stock history unavailable");
  });

  it("renames the weekly interval when the chain reaches LSE", async () => {
    vi.mocked(getHistory).mockRejectedValue(new Error("Yahoo unavailable"));
    vi.mocked(getLseCandles).mockResolvedValue(candlesFixture);

    await stockHistoryTool.execute("call-2", {
      symbol: "AAPL",
      range: "1y",
      interval: "1wk",
    });

    expect(getLseCandles).toHaveBeenCalledWith(
      "AAPL",
      "1w",
      expect.objectContaining({ order: "asc" }),
    );
  });

  it("preserves the no-alternate-source message for intraday history without an LSE key", async () => {
    configMock.lseApiKey = undefined;
    vi.mocked(getHistory).mockRejectedValue(new Error("Yahoo unavailable"));

    const result = await stockHistoryTool.execute("call-3", {
      symbol: "AAPL",
      interval: "5m",
    });

    expect(result.content[0]).toMatchObject({ type: "text" });
    if (result.content[0].type !== "text") throw new Error("expected text content");
    expect(result.content[0].text).toContain("No alternate source for 5m data.");
    expect(getLseCandles).not.toHaveBeenCalled();
  });

  it("tries daily history in Yahoo, Alpha Vantage, then LSE order", async () => {
    configMock.alphaVantageApiKey = "av-test-key";
    vi.mocked(getHistory).mockRejectedValue(new Error("Yahoo unavailable"));
    vi.mocked(getDailyHistory).mockRejectedValue(new Error("Alpha Vantage unavailable"));
    vi.mocked(getLseCandles).mockResolvedValue(candlesFixture);

    const result = await stockHistoryTool.execute("call-4", {
      symbol: "AAPL",
      range: "1y",
      interval: "1d",
    });

    expect(result.details).toHaveLength(candlesFixture.length);
    expect(getHistory).toHaveBeenCalledOnce();
    expect(getDailyHistory).toHaveBeenCalledOnce();
    expect(getLseCandles).toHaveBeenCalledOnce();
    expect(vi.mocked(getHistory).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(getDailyHistory).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(getDailyHistory).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(getLseCandles).mock.invocationCallOrder[0],
    );
  });

  it("removes LSE from the chain when the byte budget is over its soft threshold", async () => {
    budgetMock.overSoftThreshold = true;
    vi.mocked(getHistory).mockRejectedValue(new Error("Yahoo unavailable"));

    const result = await stockHistoryTool.execute("call-5", {
      symbol: "AAPL",
      interval: "5m",
    });

    expect(result.content[0]).toMatchObject({ type: "text" });
    if (result.content[0].type !== "text") throw new Error("expected text content");
    expect(result.content[0].text).toContain("No alternate source for 5m data.");
    expect(getLseCandles).not.toHaveBeenCalled();
  });

  it("converts deep ranges to a date-only LSE start and omits start for max", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:34:56.000Z"));
    vi.mocked(getHistory).mockRejectedValue(new Error("Yahoo unavailable"));
    vi.mocked(getLseCandles).mockResolvedValue(candlesFixture);

    await stockHistoryTool.execute("call-6", {
      symbol: "AAPL",
      range: "10y",
      interval: "1h",
    });

    expect(getLseCandles).toHaveBeenLastCalledWith("AAPL", "1h", {
      start: "2016-07-16",
      order: "asc",
    });

    await stockHistoryTool.execute("call-7", {
      symbol: "AAPL",
      range: "max",
      interval: "1h",
    });

    expect(getLseCandles).toHaveBeenLastCalledWith("AAPL", "1h", { order: "asc" });
  });

  it("discloses stale history in text and structured freshness details", async () => {
    const bars = candlesFixture.map((row) => ({
      date: row.ts.slice(0, 10),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }));
    const staleCache = new Cache();
    staleCache.set("history", bars, 60_000);
    vi.mocked(getHistory).mockImplementation(
      async () => staleCache.getStale<typeof bars>("history", 86_400_000)!.value,
    );

    const result = await stockHistoryTool.execute("call-stale", {
      symbol: "AAPL",
      range: "1y",
      interval: "1d",
    });

    expect(result.details).toMatchObject({
      bars,
      provider: "yahoo",
      stale: true,
      providerTimestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      freshness: { cacheStatus: "stale" },
    });
    expect(result.content[0]).toMatchObject({ type: "text" });
    if (result.content[0].type !== "text") throw new Error("expected text content");
    expect(result.content[0].text).toMatch(/stale cache/i);
  });
});
