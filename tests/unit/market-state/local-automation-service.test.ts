import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase } from "../../../src/memory/sqlite.js";
import { ALERT_CONDITION_VERSION, priceCrossesAbove } from "../../../src/market-state/alert-conditions.js";
import {
  runLocalAutomationHeartbeat,
} from "../../../src/market-state/local-automation-service.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import type { AlertRunnerProviders } from "../../../src/market-state/alert-runner.js";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import type { StockQuote } from "../../../src/types/market.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
}));

describe("local automation service", () => {
  let db: Database.Database;
  let service: MarketStateService;

  beforeEach(() => {
    vi.clearAllMocks();
    db = initDatabase(":memory:");
    service = new MarketStateService(db);
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => quote(symbol, 180));
  });

  afterEach(() => {
    db.close();
    vi.clearAllMocks();
  });

  it("renews runner ownership without creating noisy check runs when alerts are not due", async () => {
    const result = await runLocalAutomationHeartbeat(db, {
      ownerId: "gui-1",
      ownerKind: "writer",
      now: "2026-06-01T12:00:00.000Z",
      ttlSeconds: 60,
      checkAlerts: true,
      providers: unusedProviders(),
    });

    expect(result.lease).toMatchObject({ acquired: true, ownerId: "gui-1", ownerKind: "writer" });
    expect(result.alertCheck).toBeNull();
    expect(service.listAlertCheckRuns()).toEqual([]);
  });

  it("prevents a second local process from evaluating checks while the runner lease is current", async () => {
    const instrument = service.upsertInstrumentRecord({
      symbol: "AAPL",
      assetType: "equity",
      name: "Apple Inc.",
      exchange: "NMS",
      currency: "USD",
      provider: "yahoo",
    });
    service.createAlertRule({
      scopeType: "instrument",
      instrumentId: instrument.id,
      conditionType: "price_crosses_above",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: priceCrossesAbove(250),
      timeframe: "quote",
      cooldownSeconds: 0,
    });

    await runLocalAutomationHeartbeat(db, {
      ownerId: "gui-1",
      ownerKind: "writer",
      now: "2026-06-01T12:00:00.000Z",
      ttlSeconds: 60,
      checkAlerts: false,
    });

    const blocked = await runLocalAutomationHeartbeat(db, {
      ownerId: "monitor-1",
      ownerKind: "monitor",
      now: "2026-06-01T12:00:10.000Z",
      ttlSeconds: 60,
      checkAlerts: true,
      providers: unusedProviders(),
    });

    expect(blocked.lease.acquired).toBe(false);
    expect(blocked.alertCheck).toBeNull();
    expect(service.listAlertCheckRuns()).toEqual([]);
  });

  it("runs due alerts through the shared alert runner when the lease holder owns the heartbeat", async () => {
    const instrument = service.upsertInstrumentRecord({
      symbol: "AAPL",
      assetType: "equity",
      name: "Apple Inc.",
      exchange: "NMS",
      currency: "USD",
      provider: "yahoo",
    });
    service.createAlertRule({
      scopeType: "instrument",
      instrumentId: instrument.id,
      conditionType: "price_crosses_above",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: priceCrossesAbove(250),
      timeframe: "quote",
      cooldownSeconds: 0,
    });

    let price = 240;
    const providers: AlertRunnerProviders = {
      getTradingViewQuotes: vi.fn(async (symbols) => symbols.map((symbol) => ({
        symbol,
        value: price,
        sourceProvider: "tradingview",
        observedAt: "2026-06-01T12:00:00.000Z",
        providerDataAt: "2026-06-01T11:45:00.000Z",
        cacheStatus: "live",
      }))),
      getYahooQuote: vi.fn(),
      getHistory: vi.fn(),
    };

    const seed = await runLocalAutomationHeartbeat(db, {
      ownerId: "gui-1",
      ownerKind: "writer",
      now: "2026-06-01T12:00:00.000Z",
      ttlSeconds: 60,
      checkAlerts: true,
      providers,
    });
    price = 260;
    const triggered = await runLocalAutomationHeartbeat(db, {
      ownerId: "gui-1",
      ownerKind: "writer",
      now: "2026-06-01T12:01:00.000Z",
      ttlSeconds: 60,
      checkAlerts: true,
      providers,
    });

    expect(seed.alertCheck).toMatchObject({ checked: 1, triggered: 0 });
    expect(triggered.alertCheck).toMatchObject({ checked: 1, triggered: 1 });
    expect(service.listAlertCheckRuns()).toHaveLength(2);
    expect(service.listNotificationEvents()).toEqual([
      expect.objectContaining({ sourceType: "alert_event", title: "AAPL alert triggered" }),
    ]);
  });

  it("runs due scheduled daily reports and creates report notifications", async () => {
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
    const template = service.createReportTemplate({
      name: "Morning watchlist",
      reportType: "watchlist_daily",
      cadence: "daily",
      timezone: "America/Toronto",
      localTime: "08:00",
      config: { targets: { default_watchlist: true } },
      enabled: true,
      nextRunAt: "2026-03-08T12:00:00.000Z",
    });

    const result = await runLocalAutomationHeartbeat(db, {
      ownerId: "gui-1",
      ownerKind: "writer",
      now: "2026-03-08T12:00:30.000Z",
      ttlSeconds: 60,
      checkAlerts: true,
      providers: unusedProviders(),
    });

    expect(result.reportRuns).toEqual([
      expect.objectContaining({
        templateId: template.id,
        triggerType: "scheduled",
        scheduledFor: "2026-03-08T12:00:00.000Z",
        ownerId: "gui-1",
        status: "completed",
      }),
    ]);
    expect(service.getReportTemplate(template.id).nextRunAt).toBe("2026-03-09T12:00:00.000Z");
    expect(service.listNotificationEvents()).toEqual([
      expect.objectContaining({
        sourceType: "report_run",
        sourceId: result.reportRuns[0].id,
        title: "Daily watchlist report generated",
      }),
    ]);
  });
});

function unusedProviders(): AlertRunnerProviders {
  return {
    getTradingViewQuotes: vi.fn(async () => {
      throw new Error("should not fetch quotes");
    }),
    getYahooQuote: vi.fn(async () => {
      throw new Error("should not fetch quotes");
    }),
    getHistory: vi.fn(async () => {
      throw new Error("should not fetch history");
    }),
  };
}

function quote(symbol: string, price: number): StockQuote {
  return {
    symbol,
    price,
    change: 1,
    changePercent: 0.5,
    open: price,
    high: price,
    low: price,
    previousClose: price,
    volume: 1_000,
    marketCap: 0,
    pe: null,
    week52High: price + 10,
    week52Low: price - 10,
    timestamp: Date.parse("2026-06-01T12:00:00.000Z"),
  };
}
