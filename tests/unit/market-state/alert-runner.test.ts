import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ALERT_CONDITION_VERSION,
  percentMove,
  priceCrossesAbove,
  priceCrossesSma,
  rsiThreshold,
  smaCross,
  volumeSpike,
} from "../../../src/market-state/alert-conditions.js";
import {
  AlertProviderBudget,
  type AlertRunnerProviders,
  defaultAlertProviderBudget,
  runAlertChecks,
} from "../../../src/market-state/alert-runner.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDatabase } from "../../../src/memory/sqlite.js";

describe("alert runner", () => {
  let db: Database.Database;
  let service: MarketStateService;

  beforeEach(() => {
    defaultAlertProviderBudget.reset();
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
      getTradingViewQuotes: vi.fn(async (symbols) =>
        symbols.map((symbol) => ({
          symbol,
          value: symbol === "AAPL" ? 240 : 0,
          sourceProvider: "tradingview",
          observedAt: "2026-06-01T12:00:00.000Z",
          providerDataAt: "2026-06-01T11:45:00.000Z",
          cacheStatus: "live",
          dataDelayMs: 15 * 60_000,
          caveat: "delayed",
        })),
      ),
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

    const aaplLine = result.lines.find((line) => line.startsWith("AAPL"));
    expect(aaplLine).toContain("AAPL: seeded");
    expect(aaplLine).toContain("240.00");
    expect(aaplLine).toContain("above 250.00");
    expect(aaplLine).toContain("condition false");
    expect(aaplLine).toContain("tradingview");
    expect(aaplLine).toContain("15m delayed");
    const btcLine = result.lines.find((line) => line.startsWith("BTC-USD"));
    expect(btcLine).toContain("69000.00");
    expect(btcLine).toContain("above 70000.00");
    expect(btcLine).toContain("yahoo");
    expect(btcLine).not.toContain("delayed");

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

  it("fetches Yahoo fallback quotes concurrently while preserving mixed-result bookkeeping", async () => {
    const symbols = ["AAPL", "MSFT", "NVDA"];
    for (const symbol of symbols) {
      const instrument = service.upsertInstrumentRecord({
        symbol,
        assetType: "equity",
        name: `${symbol} Inc.`,
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      });
      service.createAlertRule({
        scopeType: "instrument",
        instrumentId: instrument.id,
        conditionType: "price_crosses_above",
        conditionVersion: ALERT_CONDITION_VERSION,
        condition: priceCrossesAbove(500),
        timeframe: "quote",
        cooldownSeconds: 0,
      });
    }

    let inFlight = 0;
    let maxConcurrent = 0;
    const providers: AlertRunnerProviders = {
      getTradingViewQuotes: vi.fn(async () => {
        throw new Error("TradingView unavailable");
      }),
      getYahooQuote: vi.fn(async (symbol) => {
        inFlight++;
        maxConcurrent = Math.max(maxConcurrent, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 0));
        inFlight--;
        if (symbol === "NVDA") throw new Error("Yahoo no quote");
        return {
          symbol,
          value: symbol === "AAPL" ? 240 : 410,
          sourceProvider: "yahoo",
          observedAt: "2026-06-01T12:00:00.000Z",
          providerDataAt: "2026-06-01T12:00:00.000Z",
          cacheStatus: "live",
        };
      }),
      getHistory: vi.fn(),
    };

    const result = await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:00:00.000Z",
      providers,
      providerBudget: new AlertProviderBudget(),
    });

    expect(result).toMatchObject({ checked: 3, triggered: 0, unavailable: 1 });
    expect(providers.getYahooQuote).toHaveBeenCalledTimes(3);
    expect(maxConcurrent).toBeGreaterThan(1);
    expect(service.getAlertRule(1).lastObservedJson).toMatchObject({
      sourceProvider: "yahoo",
      value: 240,
    });
    expect(service.getAlertRule(2).lastObservedJson).toMatchObject({
      sourceProvider: "yahoo",
      value: 410,
    });
    expect(service.getAlertRule(3).lastObservedJson).toBeNull();
    expect(service.listAlertCheckRuns()[0].providerStatusJson).toMatchObject({
      unavailableReasons: {
        NVDA: "TradingView unavailable; Yahoo fallback unavailable: Yahoo no quote",
      },
    });
  });

  it("opens the Yahoo circuit for the next run without short-circuiting same-cycle fallback calls", async () => {
    const symbols = ["BTC-USD", "ETH-USD", "SOL-USD"];
    for (const symbol of symbols) {
      const instrument = service.upsertInstrumentRecord({
        symbol,
        assetType: "crypto",
        name: symbol,
        exchange: null,
        currency: "USD",
        provider: "yahoo",
      });
      service.createAlertRule({
        scopeType: "instrument",
        instrumentId: instrument.id,
        conditionType: "price_crosses_above",
        conditionVersion: ALERT_CONDITION_VERSION,
        condition: priceCrossesAbove(70_000),
        timeframe: "quote",
        cooldownSeconds: 0,
      });
    }

    const providers: AlertRunnerProviders = {
      getTradingViewQuotes: vi.fn(),
      getYahooQuote: vi.fn(async () => {
        throw new Error("Yahoo HTTP 429");
      }),
      getHistory: vi.fn(),
    };
    const providerBudget = new AlertProviderBudget({ failureThreshold: 1, backoffMs: 300_000 });

    const first = await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:00:00.000Z",
      providers,
      providerBudget,
    });
    const second = await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:01:00.000Z",
      providers,
      providerBudget,
    });

    expect(first).toMatchObject({ checked: 3, triggered: 0, unavailable: 3 });
    expect(second).toMatchObject({ checked: 3, triggered: 0, unavailable: 3 });
    expect(providers.getYahooQuote).toHaveBeenCalledTimes(3);
    expect(service.listAlertCheckRuns()[0].providerStatusJson).toMatchObject({
      unavailableReasons: {
        "BTC-USD": expect.stringContaining("provider_budget_exhausted"),
        "ETH-USD": expect.stringContaining("provider_budget_exhausted"),
        "SOL-USD": expect.stringContaining("provider_budget_exhausted"),
      },
      providerBudget: {
        yahoo: expect.objectContaining({ state: "open" }),
      },
    });
  });

  it("skips Yahoo network calls while the alert provider circuit is open after repeated rate limits", async () => {
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
      instrumentId: btc.id,
      conditionType: "price_crosses_above",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: priceCrossesAbove(70_000),
      timeframe: "quote",
      cooldownSeconds: 0,
    });

    const providers: AlertRunnerProviders = {
      getTradingViewQuotes: vi.fn(),
      getYahooQuote: vi.fn(async () => {
        throw new Error("Yahoo HTTP 429");
      }),
      getHistory: vi.fn(),
    };
    const providerBudget = new AlertProviderBudget({ failureThreshold: 2, backoffMs: 300_000 });

    await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:00:00.000Z",
      providers,
      providerBudget,
    });
    await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:01:00.000Z",
      providers,
      providerBudget,
    });
    const skipped = await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:02:00.000Z",
      providers,
      providerBudget,
    });

    expect(providers.getYahooQuote).toHaveBeenCalledTimes(2);
    expect(skipped).toMatchObject({ checked: 1, triggered: 0, unavailable: 1 });
    expect(service.listAlertEvents().at(-1)).toMatchObject({
      status: "unavailable",
      message: expect.stringContaining("provider_budget_exhausted"),
    });
    expect(service.listAlertCheckRuns()[0].providerStatusJson).toMatchObject({
      providerBudget: {
        yahoo: expect.objectContaining({ state: "open" }),
      },
    });
  });

  it("does not open the Yahoo provider circuit for symbol-specific no-data failures", async () => {
    const bad = service.upsertInstrumentRecord({
      symbol: "BAD-USD",
      assetType: "crypto",
      name: "Bad Symbol",
      exchange: null,
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
      instrumentId: bad.id,
      conditionType: "price_crosses_above",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: priceCrossesAbove(1),
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
      getTradingViewQuotes: vi.fn(),
      getYahooQuote: vi.fn(async (symbol) => {
        if (symbol === "BAD-USD") throw new Error("No data found, symbol may be delisted");
        return {
          symbol,
          value: 69_000,
          sourceProvider: "yahoo",
          observedAt: "2026-06-01T12:00:00.000Z",
          providerDataAt: "2026-06-01T12:00:00.000Z",
          cacheStatus: "live",
        };
      }),
      getHistory: vi.fn(),
    };

    const result = await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:00:00.000Z",
      providers,
      providerBudget: new AlertProviderBudget({ failureThreshold: 1, backoffMs: 300_000 }),
    });

    expect(result).toMatchObject({ checked: 2, triggered: 0, unavailable: 1 });
    expect(providers.getYahooQuote).toHaveBeenCalledTimes(2);
    expect(service.getAlertRule(2).lastObservedJson).toMatchObject({
      sourceProvider: "yahoo",
      value: 69_000,
    });
    expect(service.listAlertCheckRuns()[0].providerStatusJson).toMatchObject({
      providerBudget: {},
    });
  });

  it("routes latency-sensitive price rules away from delayed TradingView observations", async () => {
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
      condition: { ...priceCrossesAbove(250), allow_delayed: false },
      timeframe: "quote",
      cooldownSeconds: 0,
    });

    const providers: AlertRunnerProviders = {
      getTradingViewQuotes: vi.fn(),
      getYahooQuote: vi.fn(async (symbol) => ({
        symbol,
        value: 240,
        sourceProvider: "yahoo",
        observedAt: "2026-06-01T12:00:00.000Z",
        providerDataAt: "2026-06-01T12:00:00.000Z",
        cacheStatus: "live",
      })),
      getHistory: vi.fn(),
    };

    await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:00:00.000Z",
      providers,
      providerBudget: new AlertProviderBudget(),
    });

    expect(providers.getTradingViewQuotes).not.toHaveBeenCalled();
    expect(providers.getYahooQuote).toHaveBeenCalledWith("AAPL");
    expect(service.getAlertRule(1).lastObservedJson).toMatchObject({
      sourceProvider: "yahoo",
    });
  });

  it("does not reuse delayed TradingView observations for same-symbol latency-sensitive rules when Yahoo fails", async () => {
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
    service.createAlertRule({
      scopeType: "instrument",
      instrumentId: instrument.id,
      conditionType: "price_crosses_above",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: { ...priceCrossesAbove(250), allow_delayed: false },
      timeframe: "quote",
      cooldownSeconds: 0,
    });

    const providers: AlertRunnerProviders = {
      getTradingViewQuotes: vi.fn(async (symbols) =>
        symbols.map((symbol) => ({
          symbol,
          value: 260,
          sourceProvider: "tradingview",
          observedAt: "2026-06-01T12:00:00.000Z",
          providerDataAt: "2026-06-01T11:45:00.000Z",
          cacheStatus: "live",
          dataDelayMs: 15 * 60_000,
        })),
      ),
      getYahooQuote: vi.fn(async () => {
        throw new Error("Yahoo unavailable");
      }),
      getHistory: vi.fn(),
    };

    const result = await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:00:00.000Z",
      providers,
      providerBudget: new AlertProviderBudget(),
    });

    expect(result).toMatchObject({ checked: 2, triggered: 0, unavailable: 1 });
    const [delayedRule, freshOnlyRule] = service.listAlertRules();
    expect(delayedRule.lastObservedJson).toMatchObject({ sourceProvider: "tradingview" });
    expect(freshOnlyRule.lastObservedJson).toBeNull();
    expect(service.listAlertEvents()).toEqual([
      expect.objectContaining({
        alertRuleId: freshOnlyRule.id,
        status: "unavailable",
        message: expect.stringContaining("Yahoo unavailable"),
      }),
    ]);
  });

  it("records TradingView stale cache as unavailable instead of firing alerts from expired quotes", async () => {
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

    const providers: AlertRunnerProviders = {
      getTradingViewQuotes: vi.fn(async (symbols) =>
        symbols.map((symbol) => ({
          symbol,
          value: 260,
          sourceProvider: "tradingview",
          observedAt: "2026-06-01T12:00:00.000Z",
          providerDataAt: "2026-06-01T11:00:00.000Z",
          cacheStatus: "stale",
        })),
      ),
      getYahooQuote: vi.fn(async () => {
        throw new Error("Yahoo fallback unavailable");
      }),
      getHistory: vi.fn(),
    };

    const result = await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:00:00.000Z",
      providers,
    });

    expect(result).toMatchObject({ checked: 1, triggered: 0, unavailable: 1 });
    expect(service.listAlertEvents()).toEqual([
      expect.objectContaining({
        status: "unavailable",
        message: expect.stringMatching(/stale/i),
      }),
    ]);
    expect(service.getAlertRule(1).lastObservedJson).toBeNull();
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
      getTradingViewQuotes: vi.fn(async (symbols) =>
        symbols.map((symbol) => ({
          symbol,
          value: price,
          sourceProvider: "tradingview",
          observedAt: "2026-06-01T12:00:00.000Z",
          providerDataAt: "2026-06-01T11:45:00.000Z",
          cacheStatus: "live",
          dataDelayMs: 15 * 60_000,
        })),
      ),
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
      getTradingViewQuotes: vi.fn(async (symbols) =>
        symbols.map((symbol) => ({
          symbol,
          value: 240,
          sourceProvider: "tradingview",
          observedAt: "2026-06-01T12:00:00.000Z",
          providerDataAt: "2026-06-01T11:45:00.000Z",
          cacheStatus: "live",
        })),
      ),
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

  it("formats indicator alert notifications with indicator units instead of dollars", async () => {
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
      conditionType: "rsi_threshold",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: rsiThreshold(2, 30, "below"),
      timeframe: "1d",
      cooldownSeconds: 0,
    });

    let closes = [100, 102, 101];
    const providers: AlertRunnerProviders = {
      getTradingViewQuotes: vi.fn(),
      getYahooQuote: vi.fn(),
      getHistory: vi.fn(async () =>
        closes.map((close, index) => ({
          date: `2026-06-0${index + 1}`,
          open: close,
          high: close,
          low: close,
          close,
          volume: 1_000,
        })),
      ),
    };

    await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-01T12:00:00.000Z",
      providers,
    });
    closes = [100, 99, 98];
    const triggered = await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-02T12:00:00.000Z",
      providers,
    });

    expect(triggered.triggered).toBe(1);
    expect(service.listAlertEvents()).toEqual([
      expect.objectContaining({
        message: "AAPL RSI below threshold at 0.00",
        observedValueJson: expect.objectContaining({ field: "rsi", value: 0 }),
      }),
    ]);
    expect(service.listAlertEvents()[0].message).not.toContain("$");
  });

  it("triggers percent-move alerts after a threshold crossing", async () => {
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
      conditionType: "percent_move",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: percentMove("up", 5),
      timeframe: "1d",
      cooldownSeconds: 0,
    });

    let closes = [100, 104];
    const providers: AlertRunnerProviders = {
      getTradingViewQuotes: vi.fn(),
      getYahooQuote: vi.fn(),
      getHistory: vi.fn(async () =>
        closes.map((close, index) => ({
          date: `2026-06-0${index + 1}`,
          open: close,
          high: close,
          low: close,
          close,
          volume: 1_000,
        })),
      ),
    };

    await runAlertChecks(service, {
      triggerType: "manual",
      now: "2026-06-01T12:00:00.000Z",
      providers,
    });
    closes = [100, 106];
    const triggered = await runAlertChecks(service, {
      triggerType: "manual",
      now: "2026-06-02T12:00:00.000Z",
      providers,
    });

    expect(triggered.triggered).toBe(1);
    expect(service.listAlertEvents()).toEqual([
      expect.objectContaining({
        message: "AAPL percent move up 6.00%",
        observedValueJson: expect.objectContaining({ field: "percent_move", value: 6 }),
      }),
    ]);
  });

  it("triggers SMA-cross alerts after fast SMA crosses the slow SMA", async () => {
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
      conditionType: "sma_cross",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: smaCross(2, 3, "above"),
      timeframe: "1d",
      cooldownSeconds: 0,
    });

    let closes = [103, 101, 99];
    const providers: AlertRunnerProviders = {
      getTradingViewQuotes: vi.fn(),
      getYahooQuote: vi.fn(),
      getHistory: vi.fn(async () =>
        closes.map((close, index) => ({
          date: `2026-06-0${index + 1}`,
          open: close,
          high: close,
          low: close,
          close,
          volume: 1_000,
        })),
      ),
    };

    await runAlertChecks(service, {
      triggerType: "manual",
      now: "2026-06-01T12:00:00.000Z",
      providers,
    });
    closes = [99, 101, 103];
    const triggered = await runAlertChecks(service, {
      triggerType: "manual",
      now: "2026-06-02T12:00:00.000Z",
      providers,
    });

    expect(triggered.triggered).toBe(1);
    expect(service.listAlertEvents()).toEqual([
      expect.objectContaining({
        message: "AAPL fast SMA crossed above slow SMA at +$1.00",
        observedValueJson: expect.objectContaining({
          field: "sma_spread",
          value: 1,
          fast_sma: 102,
          slow_sma: 101,
        }),
      }),
    ]);
  });

  it("stores the price and SMA legs behind a price-versus-SMA observation", async () => {
    const instrument = service.upsertInstrumentRecord({
      symbol: "AAPL",
      assetType: "equity",
      name: "Apple Inc.",
      exchange: "NMS",
      currency: "USD",
      provider: "yahoo",
    });
    const rule = service.createAlertRule({
      scopeType: "instrument",
      instrumentId: instrument.id,
      conditionType: "price_crosses_sma",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: priceCrossesSma(2, "below"),
      timeframe: "1d",
      cooldownSeconds: 0,
    });
    const providers: AlertRunnerProviders = {
      getTradingViewQuotes: vi.fn(),
      getYahooQuote: vi.fn(),
      getHistory: vi.fn(async () => [
        { date: "2026-06-01", open: 100, high: 100, low: 100, close: 100, volume: 1_000 },
        { date: "2026-06-02", open: 80, high: 80, low: 80, close: 80, volume: 1_000 },
      ]),
    };

    await runAlertChecks(service, {
      triggerType: "manual",
      now: "2026-06-02T12:00:00.000Z",
      providers,
    });

    expect(service.getAlertRule(rule.id).lastObservedJson).toMatchObject({
      field: "price_sma_spread",
      value: -10,
      price: 80,
      sma: 90,
    });
  });

  it("shares daily history observations across indicator alerts for the same symbol", async () => {
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
      conditionType: "rsi_threshold",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: rsiThreshold(2, 30, "below"),
      timeframe: "1d",
      cooldownSeconds: 0,
    });
    service.createAlertRule({
      scopeType: "instrument",
      instrumentId: instrument.id,
      conditionType: "volume_spike",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: volumeSpike(2, 1.5),
      timeframe: "1d",
      cooldownSeconds: 0,
    });

    const providers: AlertRunnerProviders = {
      getTradingViewQuotes: vi.fn(),
      getYahooQuote: vi.fn(),
      getHistory: vi.fn(async () => [
        { date: "2026-06-01", open: 100, high: 100, low: 100, close: 100, volume: 100 },
        { date: "2026-06-02", open: 99, high: 99, low: 99, close: 99, volume: 100 },
        { date: "2026-06-03", open: 98, high: 98, low: 98, close: 98, volume: 300 },
      ]),
    };

    await runAlertChecks(service, {
      ownerId: "runner-1",
      triggerType: "heartbeat",
      now: "2026-06-03T12:00:00.000Z",
      providers,
      providerBudget: new AlertProviderBudget(),
    });

    expect(providers.getHistory).toHaveBeenCalledTimes(1);
  });

  it("marks false-to-true resume triggers as late alerts", async () => {
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
      getTradingViewQuotes: vi.fn(async (symbols) =>
        symbols.map((symbol) => ({
          symbol,
          value: price,
          sourceProvider: "tradingview",
          observedAt: "2026-06-01T12:00:00.000Z",
          providerDataAt: "2026-06-01T11:45:00.000Z",
          cacheStatus: "live",
        })),
      ),
      getYahooQuote: vi.fn(),
      getHistory: vi.fn(),
    };

    await runAlertChecks(service, {
      triggerType: "heartbeat",
      now: "2026-06-01T12:00:00.000Z",
      providers,
    });
    price = 260;
    const resumed = await runAlertChecks(service, {
      triggerType: "resume",
      now: "2026-06-01T13:00:00.000Z",
      providers,
    });

    expect(resumed.triggered).toBe(1);
    expect(service.listAlertEvents()).toEqual([
      expect.objectContaining({
        status: "triggered_late",
        triggerSource: "resume",
      }),
    ]);
  });

  it("suppresses duplicate trigger inserts when a stale caller races with an already-triggered rule", () => {
    const instrument = service.upsertInstrumentRecord({
      symbol: "AAPL",
      assetType: "equity",
      name: "Apple Inc.",
      exchange: "NMS",
      currency: "USD",
      provider: "yahoo",
    });
    const rule = service.createAlertRule({
      scopeType: "instrument",
      instrumentId: instrument.id,
      conditionType: "price_crosses_above",
      conditionVersion: ALERT_CONDITION_VERSION,
      condition: priceCrossesAbove(250),
      timeframe: "quote",
      cooldownSeconds: 0,
    });
    service.recordAlertEvaluationResult({
      ruleId: rule.id,
      observed: { value: 240, field: "last_price" },
      checkedAt: "2026-06-01T12:00:00.000Z",
      conditionState: "false",
    });
    const trigger = {
      instrumentId: instrument.id,
      title: "AAPL alert triggered",
      message: "AAPL price_crosses_above at $260.00",
      triggeredAt: "2026-06-01T12:01:00.000Z",
      observedAt: "2026-06-01T12:01:00.000Z",
      providerDataAt: "2026-06-01T12:01:00.000Z",
      sourceProvider: "tradingview",
      cacheStatus: "live",
      dataDelayMs: null,
      triggerSource: "heartbeat",
      dedupeKey: "first",
    };

    const first = service.recordAlertEvaluationResult({
      ruleId: rule.id,
      observed: { value: 260, field: "last_price" },
      checkedAt: "2026-06-01T12:01:00.000Z",
      conditionState: "true",
      trigger,
    });
    const duplicate = service.recordAlertEvaluationResult({
      ruleId: rule.id,
      observed: { value: 260, field: "last_price" },
      checkedAt: "2026-06-01T12:01:01.000Z",
      conditionState: "true",
      trigger: { ...trigger, triggerSource: "manual", dedupeKey: "second" },
    });

    expect(first.triggered).toBe(true);
    expect(duplicate.triggered).toBe(false);
    expect(service.listAlertEvents()).toHaveLength(1);
    expect(service.listNotificationEvents()).toHaveLength(1);
  });
});
