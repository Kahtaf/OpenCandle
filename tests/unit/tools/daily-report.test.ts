import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { isZeroFilledQuote } from "../../../src/market-state/resolve.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDefaultDatabase } from "../../../src/memory/sqlite.js";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import { dailyReportTool } from "../../../src/tools/portfolio/daily-report.js";
import { watchlistTool } from "../../../src/tools/portfolio/watchlist.js";
import type { StockQuote } from "../../../src/types/market.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
}));

describe("dailyReportTool", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-report-test-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
    vi.mocked(getQuote).mockImplementation(async (symbol: string) =>
      quote(symbol.toUpperCase(), symbol.toUpperCase() === "MSFT" ? 420 : 180),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalEnv == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalEnv;
    }
    rmSync(openCandleHome, { recursive: true, force: true });
    cache.clear();
    vi.clearAllMocks();
  });

  it("describes exact action literals for agent routing", () => {
    const actionDescription = dailyReportTool.parameters.properties.action.description ?? "";

    expect(dailyReportTool.description).toContain("run");
    expect(dailyReportTool.description).toContain("configure");
    expect(dailyReportTool.description).toContain("history");
    expect(actionDescription).toContain("run");
    expect(actionDescription).toContain("configure");
    expect(actionDescription).toContain("history");
    expect(actionDescription).toContain("Use history");
  });

  it("rejects unsupported direct actions without recording a report run", async () => {
    await expect(dailyReportTool.execute("test", { action: "list" } as never)).rejects.toThrow(
      "Unsupported daily report action",
    );

    const db = initDefaultDatabase();
    expect(new MarketStateService(db).listReportRuns()).toEqual([]);
    db.close();
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
    // Unbuilt sections are omitted entirely — no placeholder scaffolding text.
    expect(result.content[0].text).not.toContain("Technical snapshot");
    expect(result.content[0].text).not.toContain("Deferred unless");
    expect(result.content[0].text).toContain("Data gaps");
    expect(result.details).toMatchObject({ status: "completed" });
    // No template exists → the manual run must not create one as a side effect.
    expect(result.details.templateId).toBeNull();

    const history = await dailyReportTool.execute("test", { action: "history" });
    expect(history.content[0].text).toContain("completed");

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    const templates = service.listReportTemplates();
    const [run] = service.listReportRuns();
    const [notification] = service.listNotificationEvents();
    db.close();

    expect(templates).toHaveLength(0);
    expect(run.templateId).toBeNull();
    expect(run.triggerType).toBe("manual");
    expect(run.summaryJson).toMatchObject({
      text: expect.stringContaining("Daily Watchlist Report"),
    });
    expect(notification).toMatchObject({
      sourceType: "report_run",
      sourceId: run.id,
      severity: "info",
      title: "Daily watchlist report generated",
      status: "unread",
    });
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
    vi.mocked(getQuote).mockImplementation(async () => {
      cache.getStale("test-stale-report-quote", 60_000);
      return quote("AAPL", 260);
    });

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T11:00:00.000Z"));

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
      nextRunAt: "2026-06-01T12:00:00.000Z",
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

  it("links manual runs to the configured morning report template", async () => {
    const configured = await dailyReportTool.execute("test", {
      action: "configure",
      timezone: "America/Toronto",
      local_time: "07:15",
    });

    const run = await dailyReportTool.execute("test", { action: "run" });

    expect(run.details).toMatchObject({
      templateId: configured.details.id,
      status: "completed",
    });

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    const [template] = service.listReportTemplates();
    db.close();

    expect(template.id).toBe(configured.details.id);
    expect(template.lastRunAt).toBe(run.details.startedAt);
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
