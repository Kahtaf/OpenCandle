import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { watchlistTool } from "../../../src/tools/portfolio/watchlist.js";
import { dailyReportTool } from "../../../src/tools/portfolio/daily-report.js";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import { cache } from "../../../src/infra/cache.js";
import type { StockQuote } from "../../../src/types/market.js";
import { initDefaultDatabase } from "../../../src/memory/sqlite.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import { isZeroFilledQuote } from "../../../src/market-state/resolve.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
}));

describe("dailyReportTool", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
    cache.consumeStaleFlag();
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-report-test-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
    vi.mocked(getQuote).mockImplementation(async (symbol: string) =>
      quote(symbol.toUpperCase(), symbol.toUpperCase() === "MSFT" ? 420 : 180),
    );
  });

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalEnv;
    }
    rmSync(openCandleHome, { recursive: true, force: true });
    cache.clear();
    cache.consumeStaleFlag();
    vi.clearAllMocks();
  });

  it("generates and records a default watchlist report", async () => {
    await watchlistTool.execute("test", { action: "add", symbol: "AAPL" });
    await watchlistTool.execute("test", { action: "add", symbol: "MSFT" });

    const result = await dailyReportTool.execute("test", { action: "run" });

    expect(result.content[0].text).toContain("Daily Watchlist Report");
    expect(result.content[0].text).toContain("Target watchlist: Default");
    expect(result.content[0].text).toContain("Quote freshness");
    expect(result.content[0].text).toContain("Major movers");
    expect(result.content[0].text).toContain("Recent alerts");
    expect(result.content[0].text).toContain("Technical snapshot");
    expect(result.content[0].text).toContain("Data gaps");
    expect(result.details).toMatchObject({ status: "completed" });

    const history = await dailyReportTool.execute("test", { action: "history" });
    expect(history.content[0].text).toContain("completed");
  });

  it("reports zero-filled quote rows as data gaps instead of valid report data", async () => {
    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    service.addWatchlistItem({
      instrument: {
        symbol: "AAPL",
        assetType: "equity",
        name: "Apple Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
    });
    db.close();
    vi.mocked(getQuote).mockReset();
    const zeroQuote = quote("AAPL", 0, {
      volume: 0,
      week52High: 0,
      week52Low: 0,
    });
    expect(isZeroFilledQuote(zeroQuote)).toBe(true);
    vi.mocked(getQuote).mockResolvedValue(zeroQuote);

    const result = await dailyReportTool.execute("test", { action: "run" });

    expect(result.content[0].text).toContain("No quote data available");
    expect(result.content[0].text).toContain("AAPL: Yahoo returned no valid market data.");
    expect(result.details).toMatchObject({
      status: "completed",
      summaryJson: {
        quoteCount: 0,
        dataGapCount: 1,
      },
      errorsJson: ["AAPL: Yahoo returned no valid market data."],
    });
  });

  it("reports stale quote rows as data gaps instead of valid report data", async () => {
    await watchlistTool.execute("test", { action: "add", symbol: "AAPL" });
    cache.set("test-stale-report-quote", quote("AAPL", 260), -1);
    cache.getStale("test-stale-report-quote", 60_000);
    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 260));

    const result = await dailyReportTool.execute("test", { action: "run" });

    expect(result.content[0].text).toContain("No quote data available");
    expect(result.content[0].text).toContain("AAPL: provider returned stale market data");
    expect(result.details).toMatchObject({
      status: "completed",
      summaryJson: {
        quoteCount: 0,
        dataGapCount: 1,
      },
      errorsJson: ["AAPL: provider returned stale market data"],
    });
  });

  it("configures the morning report with timezone and local time", async () => {
    const result = await dailyReportTool.execute("test", {
      action: "configure",
      timezone: "America/Toronto",
      local_time: "08:00",
    });

    expect(result.details).toMatchObject({
      reportType: "watchlist_daily",
      cadence: "daily",
      timezone: "America/Toronto",
      localTime: "08:00",
    });
  });

  it("updates the existing morning report template instead of duplicating it", async () => {
    await dailyReportTool.execute("test", {
      action: "configure",
      timezone: "America/Toronto",
      local_time: "08:00",
    });

    const result = await dailyReportTool.execute("test", {
      action: "configure",
      timezone: "America/New_York",
      local_time: "07:30",
    });

    expect(result.details).toMatchObject({
      timezone: "America/New_York",
      localTime: "07:30",
    });

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    const templates = service.listReportTemplates();
    db.close();

    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      timezone: "America/New_York",
      localTime: "07:30",
    });
  });
});

function quote(symbol: string, price: number, overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    symbol,
    price,
    change: price === 420 ? 5 : -1,
    changePercent: price === 420 ? 1.2 : -0.5,
    open: price,
    high: price,
    low: price,
    previousClose: price,
    volume: 1_000,
    marketCap: 0,
    pe: null,
    week52High: price + 10,
    week52Low: price - 10,
    timestamp: Date.now(),
    ...overrides,
  };
}
