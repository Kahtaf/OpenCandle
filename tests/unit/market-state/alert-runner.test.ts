import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase } from "../../../src/memory/sqlite.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import { ALERT_CONDITION_VERSION, priceCrossesAbove } from "../../../src/market-state/alert-conditions.js";
import { runAlertChecks, type AlertRunnerProviders } from "../../../src/market-state/alert-runner.js";

describe("alert runner", () => {
  let db: Database.Database;
  let service: MarketStateService;

  beforeEach(() => {
    db = initDatabase(":memory:");
    service = new MarketStateService(db);
  });

  afterEach(() => {
    db.close();
  });

  it("uses TradingView batch quotes for supported symbols and Yahoo fallback for unsupported symbols", async () => {
    const aapl = service.upsertInstrumentRecord({
      symbol: "AAPL",
      assetType: "equity",
      name: "Apple Inc.",
      exchange: "NMS",
      currency: "USD",
      provider: "yahoo",
    });
    const btc = service.upsertInstrumentRecord({
      symbol: "BTC-USD",
      assetType: "crypto",
      name: "Bitcoin",
      exchange: null,
      currency: "USD",
      provider: "yahoo",
    });
    service.createAlertRule({
      scopeType: "instrument",
      instrumentId: aapl.id,
      conditionType: "price_crosses_above",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: priceCrossesAbove(250),
      timeframe: "quote",
      cooldownSeconds: 0,
    });
    service.createAlertRule({
      scopeType: "instrument",
      instrumentId: btc.id,
      conditionType: "price_crosses_above",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: priceCrossesAbove(70_000),
      timeframe: "quote",
      cooldownSeconds: 0,
    });

    const providers: AlertRunnerProviders = {
      getTradingViewQuotes: vi.fn(async (symbols) => symbols.map((symbol) => ({
        symbol,
        value: symbol === "AAPL" ? 240 : 0,
        sourceProvider: "tradingview",
        observedAt: "2026-06-01T12:00:00.000Z",
        providerDataAt: "2026-06-01T11:45:00.000Z",
        cacheStatus: "live",
        dataDelayMs: 15 * 60_000,
        caveat: "delayed",
      }))),
      getYahooQuote: vi.fn(async (symbol) => ({
        symbol,
        value: 69_000,
        sourceProvider: "yahoo",
        observedAt: "2026-06-01T12:00:00.000Z",
        providerDataAt: "2026-06-01T12:00:00.000Z",
        cacheStatus: "live",
      })),
      getHistory: vi.fn(),
    };

    const result = await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:00:00.000Z",
      providers,
    });

    expect(result).toMatchObject({ checked: 2, triggered: 0, unavailable: 0 });
    expect(providers.getTradingViewQuotes).toHaveBeenCalledWith(["AAPL"]);
    expect(providers.getYahooQuote).toHaveBeenCalledWith("BTC-USD");

    const [aaplRule, btcRule] = service.listAlertRules();
    expect(aaplRule.lastObservedJson).toMatchObject({
      value: 240,
      sourceProvider: "tradingview",
      providerDataAt: "2026-06-01T11:45:00.000Z",
      dataDelayMs: 900000,
    });
    expect(btcRule.lastObservedJson).toMatchObject({
      value: 69_000,
      sourceProvider: "yahoo",
    });
  });

  it("records notification lifecycle, suppresses still-true checks, rearms on false, and completes one-shot rules", async () => {
    const instrument = service.upsertInstrumentRecord({
      symbol: "AAPL",
      assetType: "equity",
      name: "Apple Inc.",
      exchange: "NMS",
      currency: "USD",
      provider: "yahoo",
    });
    const recurring = service.createAlertRule({
      scopeType: "instrument",
      instrumentId: instrument.id,
      conditionType: "price_crosses_above",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: priceCrossesAbove(250),
      timeframe: "quote",
      cooldownSeconds: 0,
    });
    const oneShot = service.createAlertRule({
      scopeType: "instrument",
      instrumentId: instrument.id,
      conditionType: "price_crosses_above",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: priceCrossesAbove(300),
      timeframe: "quote",
      cooldownSeconds: 0,
      retriggerMode: "once",
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
        dataDelayMs: 15 * 60_000,
      }))),
      getYahooQuote: vi.fn(),
      getHistory: vi.fn(),
    };

    await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "manual",
      now: "2026-06-01T12:00:00.000Z",
      providers,
    });

    price = 260;
    const firstTrigger = await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:01:00.000Z",
      providers,
    });
    const stillTrue = await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:02:00.000Z",
      providers,
    });

    price = 240;
    await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:03:00.000Z",
      providers,
    });
    price = 310;
    const secondTrigger = await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:04:00.000Z",
      providers,
    });

    expect(firstTrigger.triggered).toBe(1);
    expect(stillTrue.triggered).toBe(0);
    expect(secondTrigger.triggered).toBe(2);

    const recurringRule = service.getAlertRule(recurring.id);
    const oneShotRule = service.getAlertRule(oneShot.id);
    expect(recurringRule.armCycleId).toBe(2);
    expect(recurringRule.lastConditionState).toBe("true");
    expect(oneShotRule.status).toBe("completed");
    expect(oneShotRule.enabled).toBe(false);

    expect(service.listAlertEvents()).toHaveLength(3);
    expect(service.listNotificationEvents()).toHaveLength(3);
    expect(service.listAlertEvents()[0]).toMatchObject({
      observedAt: "2026-06-01T12:01:00.000Z",
      providerDataAt: "2026-06-01T11:45:00.000Z",
      sourceProvider: "tradingview",
      cacheStatus: "live",
      dataDelayMs: 900000,
      triggerSource: "heartbeat",
    });
  });

  it("advances next check time from the rule interval after available and unavailable checks", async () => {
    const instrument = service.upsertInstrumentRecord({
      symbol: "AAPL",
      assetType: "equity",
      name: "Apple Inc.",
      exchange: "NMS",
      currency: "USD",
      provider: "yahoo",
    });
    const btc = service.upsertInstrumentRecord({
      symbol: "BTC-USD",
      assetType: "crypto",
      name: "Bitcoin",
      exchange: null,
      currency: "USD",
      provider: "yahoo",
    });
    const available = service.createAlertRule({
      scopeType: "instrument",
      instrumentId: instrument.id,
      conditionType: "price_crosses_above",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: priceCrossesAbove(250),
      timeframe: "quote",
      checkIntervalSeconds: 300,
      cooldownSeconds: 0,
    });
    const unavailable = service.createAlertRule({
      scopeType: "instrument",
      instrumentId: btc.id,
      conditionType: "price_crosses_above",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: priceCrossesAbove(300),
      timeframe: "quote",
      checkIntervalSeconds: 600,
      cooldownSeconds: 0,
    });

    const providers: AlertRunnerProviders = {
      getTradingViewQuotes: vi.fn(async (symbols) => symbols.map((symbol) => ({
        symbol,
        value: 240,
        sourceProvider: "tradingview",
        observedAt: "2026-06-01T12:00:00.000Z",
        providerDataAt: "2026-06-01T11:45:00.000Z",
        cacheStatus: "live",
      }))),
      getYahooQuote: vi.fn(async () => {
        throw new Error("rate limited");
      }),
      getHistory: vi.fn(),
    };

    await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:00:00.000Z",
      providers,
    });

    expect(service.getAlertRule(available.id).nextCheckAt).toBe("2026-06-01T12:05:00.000Z");
    expect(service.getAlertRule(unavailable.id).nextCheckAt).toBe("2026-06-01T12:10:00.000Z");
  });
});
