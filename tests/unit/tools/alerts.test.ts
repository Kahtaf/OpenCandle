import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { httpGet } from "../../../src/infra/http-client.js";
import { defaultAlertProviderBudget } from "../../../src/market-state/alert-runner.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDefaultDatabase } from "../../../src/memory/sqlite.js";
import { getQuotes } from "../../../src/providers/tradingview.js";
import { getHistory, getQuote } from "../../../src/providers/yahoo-finance.js";
import { alertsTool } from "../../../src/tools/portfolio/alerts.js";
import type { OHLCV, StockQuote } from "../../../src/types/market.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
  getHistory: vi.fn(),
}));
vi.mock("../../../src/providers/tradingview.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/providers/tradingview.js")>();
  return {
    ...actual,
    getQuotes: vi.fn(),
  };
});
vi.mock("../../../src/infra/http-client.js", () => ({
  httpGet: vi.fn(),
}));

describe("alertsTool", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    defaultAlertProviderBudget.reset();
    cache.clear();
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-alerts-test-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 180));
    vi.mocked(getQuotes).mockRejectedValue(new Error("TradingView unavailable in unit test"));
    vi.mocked(getHistory).mockResolvedValue(
      history([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114]),
    );
    vi.mocked(httpGet).mockResolvedValue({ quotes: [] });
  });

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalEnv;
    }
    rmSync(openCandleHome, { recursive: true, force: true });
    cache.clear();
    vi.clearAllMocks();
  });

  it("describes exact alert action literals for agent routing", () => {
    const actionDescription = alertsTool.parameters.properties.action.description ?? "";

    expect(alertsTool.description).toContain("create_price_above");
    expect(alertsTool.description).toContain("create_rsi_below");
    expect(alertsTool.description).toContain("set_enabled");
    expect(actionDescription).toContain("create_price_above");
    expect(actionDescription).toContain("create_price_below_sma");
    expect(actionDescription).toContain("create_rsi_below");
    expect(actionDescription).toContain("set_enabled");
    expect(actionDescription).toContain("status");
    expect(actionDescription).toContain("check_after_create");
    expect(alertsTool.parameters.properties.check_after_create.description).toContain(
      "immediately",
    );
  });

  it("rejects unsupported create action prefixes before persisting an alert", async () => {
    await expect(
      alertsTool.execute("test", {
        action: "create_typo",
        symbol: "AAPL",
        threshold: 100,
      } as never),
    ).rejects.toThrow("Unsupported alert action");

    const db = initDefaultDatabase();
    expect(new MarketStateService(db).listAlertRules()).toEqual([]);
    db.close();
  });

  it("reports local runner status and recent check history for TUI parity", async () => {
    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    service.acquireAutomationRunnerLease({
      ownerId: "monitor-1",
      ownerKind: "monitor",
      now: new Date().toISOString(),
      ttlSeconds: 60,
    });
    service.startAlertCheckRun({
      ownerId: "monitor-1",
      triggerType: "heartbeat",
      startedAt: "2026-06-01T12:00:05.000Z",
    });
    service.completeAlertCheckRun(1, {
      completedAt: "2026-06-01T12:00:06.000Z",
      status: "completed",
      checkedCount: 2,
      triggeredCount: 1,
      unavailableCount: 0,
      providerStatus: { providerBudget: { yahoo: { state: "available", failureCount: 0 } } },
    });
    db.close();

    const status = await alertsTool.execute("test", { action: "status" });

    expect(status.content[0].text).toContain("Running locally");
    expect(status.content[0].text).toContain("monitor-1");
    expect(status.content[0].text).toContain("checked=2");
    expect(status.details).toMatchObject({
      runnerLease: expect.objectContaining({ ownerId: "monitor-1" }),
      recentCheckRuns: [expect.objectContaining({ checkedCount: 2, triggeredCount: 1 })],
    });
  });

  it("creates and lists manual price alerts", async () => {
    const created = await alertsTool.execute("test", {
      action: "create_price_above",
      symbol: "AAPL",
      threshold: 250,
    });

    expect(created.content[0].text).toContain("local alert");
    expect(created.details).toMatchObject({
      conditionType: "price_crosses_above",
      conditionVersion: 1,
      conditionJson: { threshold: 250, field: "last_price" },
      timeframe: "quote",
    });

    const listed = await alertsTool.execute("test", { action: "list" });
    expect(listed.content[0].text).toContain("AAPL");
    expect(listed.content[0].text).toContain("manual checks available");
  });

  it("rejects invalid alert thresholds before resolving or persisting instruments", async () => {
    const invalidAlerts = [
      { action: "create_price_above" as const, threshold: 0 },
      { action: "create_rsi_below" as const, threshold: 101 },
      { action: "create_volume_spike" as const, threshold: 0 },
      { action: "create_percent_move_up" as const, threshold: Number.NaN },
    ];

    for (const alert of invalidAlerts) {
      await expect(alertsTool.execute("test", { ...alert, symbol: "AAPL" })).rejects.toThrow(
        /threshold|multiplier/,
      );
    }

    expect(getQuote).not.toHaveBeenCalled();
    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    expect(service.listAlertRules()).toHaveLength(0);
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM instruments").get() as { count: number }).count,
    ).toBe(0);
    db.close();
  });

  it("updates and deletes alert rules through the shared TUI tool", async () => {
    await alertsTool.execute("test", {
      action: "create_price_above",
      symbol: "AAPL",
      threshold: 250,
    });

    const updated = await alertsTool.execute("test", {
      action: "update",
      id: 1,
      condition_action: "create_price_below",
      threshold: 150,
      cooldown_seconds: 120,
    });

    expect(updated.content[0].text).toContain("Updated alert #1");
    expect(updated.details).toMatchObject({
      id: 1,
      conditionType: "price_crosses_below",
      conditionJson: { threshold: 150, field: "last_price" },
      cooldownSeconds: 120,
      lastCheckedAt: null,
      lastObservedJson: null,
    });

    const deleted = await alertsTool.execute("test", { action: "delete", id: 1 });
    expect(deleted.content[0].text).toContain("Deleted alert #1");
    expect(deleted.details).toMatchObject({ id: 1 });

    const listed = await alertsTool.execute("test", { action: "list" });
    expect(listed.content[0].text).toContain("No alert rules");
  });

  it("validates alert updates before resolving or persisting a replacement instrument", async () => {
    await alertsTool.execute("test", {
      action: "create_price_above",
      symbol: "AAPL",
      threshold: 250,
    });
    vi.mocked(getQuote).mockClear();

    await expect(
      alertsTool.execute("test", {
        action: "update",
        id: 1,
        condition_action: "create_price_below",
        symbol: "MSFT",
        threshold: 0,
      }),
    ).rejects.toThrow("threshold must be a finite number greater than 0");

    expect(getQuote).not.toHaveBeenCalled();
    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    expect(service.listAlertRules()[0]).toMatchObject({
      instrumentId: 1,
      conditionJson: { threshold: 250 },
    });
    expect(
      (db.prepare("SELECT COUNT(*) AS count FROM instruments").get() as { count: number }).count,
    ).toBe(1);
    db.close();
  });

  it("creates instrument-scoped alerts without adding the symbol to the watchlist", async () => {
    await alertsTool.execute("test", {
      action: "create_price_above",
      symbol: "MSFT",
      threshold: 450,
    });

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    expect(service.listWatchlistItems()).toHaveLength(0);
    expect(service.listAlertRules()).toEqual([
      expect.objectContaining({
        conditionType: "price_crosses_above",
        instrumentId: expect.any(Number),
      }),
    ]);
    db.close();
  });

  it("returns candidate matches for an unverified alert symbol without creating a rule", async () => {
    vi.mocked(getQuote).mockResolvedValue(
      quote("APL", 0, { volume: 0, week52High: 0, week52Low: 0 }),
    );
    vi.mocked(httpGet).mockResolvedValue({
      quotes: [
        {
          symbol: "AAPL",
          longname: "Apple Inc.",
          quoteType: "EQUITY",
          exchange: "NMS",
          score: 101,
        },
      ],
    });

    const result = await alertsTool.execute("test", {
      action: "create_price_above",
      symbol: "APL",
      threshold: 250,
    });

    expect(result.content[0].text).toContain("Could not verify APL");
    expect(result.details).toMatchObject({
      status: "needs_selection",
      query: "APL",
      candidates: [expect.objectContaining({ symbol: "AAPL", name: "Apple Inc." })],
    });

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    expect(service.listAlertRules()).toHaveLength(0);
    db.close();
  });

  it("seeds first observation before triggering on a later crossing", async () => {
    await alertsTool.execute("test", {
      action: "create_price_above",
      symbol: "AAPL",
      threshold: 250,
    });

    const seeded = await alertsTool.execute("test", { action: "check" });
    expect(seeded.content[0].text).toContain("seeded");
    expect(seeded.details).toMatchObject({ checked: 1, triggered: 0 });

    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 260));
    const triggered = await alertsTool.execute("test", { action: "check" });

    expect(triggered.content[0].text).toContain("TRIGGERED");
    expect(triggered.details).toMatchObject({ checked: 1, triggered: 1 });
  });

  it("can check immediately after creating an alert when requested", async () => {
    const result = await alertsTool.execute("test", {
      action: "create_price_above",
      symbol: "AAPL",
      threshold: 1,
      check_after_create: true,
    });

    expect(result.content[0].text).toContain("Created local alert");
    expect(result.content[0].text).toContain("Manual Alert Check");
    expect(result.content[0].text).toContain("seeded");
    expect(result.details).toMatchObject({
      created: expect.objectContaining({
        conditionType: "price_crosses_above",
      }),
      check: { checked: 1, triggered: 0 },
    });

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    expect(service.listAlertRules()[0].lastObservedJson).toMatchObject({ value: 180 });
    expect(service.listAlertEvents()).toHaveLength(0);
    db.close();
  });

  it("does not duplicate events when a manual check sees the same triggered value again", async () => {
    await alertsTool.execute("test", {
      action: "create_price_above",
      symbol: "AAPL",
      threshold: 250,
    });

    await alertsTool.execute("test", { action: "check" });
    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 260));

    const triggered = await alertsTool.execute("test", { action: "check" });
    const duplicate = await alertsTool.execute("test", { action: "check" });

    expect(triggered.details).toMatchObject({ triggered: 1 });
    expect(duplicate.content[0].text).not.toContain("TRIGGERED");
    expect(duplicate.details).toMatchObject({ checked: 1, triggered: 0 });

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    expect(service.listAlertEvents()).toHaveLength(1);
    db.close();
  });

  it("can disable and re-enable alert rules before manual checks", async () => {
    const created = await alertsTool.execute("test", {
      action: "create_price_above",
      symbol: "AAPL",
      threshold: 250,
    });

    const disabled = await alertsTool.execute("test", {
      action: "set_enabled",
      id: created.details.id,
      enabled: false,
    });

    expect(disabled.content[0].text).toContain("Disabled alert");
    expect(disabled.details).toMatchObject({ enabled: false });

    const skipped = await alertsTool.execute("test", { action: "check" });
    expect(skipped.content[0].text).toContain("No enabled alert rules");
    expect(vi.mocked(getQuote)).toHaveBeenCalledTimes(1);

    const enabled = await alertsTool.execute("test", {
      action: "set_enabled",
      id: created.details.id,
      enabled: true,
    });

    expect(enabled.content[0].text).toContain("Enabled alert");
    expect(enabled.details).toMatchObject({ enabled: true });
  });

  it("returns a clear not-found result when enabling an unknown alert id", async () => {
    const result = await alertsTool.execute("test", {
      action: "set_enabled",
      id: 999,
      enabled: false,
    });

    expect(result.content[0].text).toContain("Alert #999 not found");
    expect(result.content[0].text).toContain("list");
    expect(result.details).toBeNull();
  });

  it("suppresses a fresh crossing while the alert is inside cooldown", async () => {
    await alertsTool.execute("test", {
      action: "create_price_above",
      symbol: "AAPL",
      threshold: 250,
      cooldown_seconds: 3600,
    });

    await alertsTool.execute("test", { action: "check" });
    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 260));
    await alertsTool.execute("test", { action: "check" });

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    const rule = service.listAlertRules()[0];
    expect(rule.lastTriggeredAt).not.toBeNull();
    service.updateAlertObservation({
      ruleId: rule.id,
      observed: { value: 240, field: "last_price", at: new Date().toISOString() },
      checkedAt: new Date().toISOString(),
    });
    db.close();

    const checked = await alertsTool.execute("test", { action: "check" });

    expect(checked.content[0].text).not.toContain("TRIGGERED");
    expect(checked.details).toMatchObject({ checked: 1, triggered: 0 });

    const verifyDb = initDefaultDatabase();
    const verifyService = new MarketStateService(verifyDb);
    expect(verifyService.listAlertEvents()).toHaveLength(1);
    verifyDb.close();
  });

  it("creates and manually checks RSI threshold alerts", async () => {
    await alertsTool.execute("test", {
      action: "create_rsi_below",
      symbol: "AAPL",
      threshold: 30,
      period: 14,
    });
    vi.mocked(getHistory).mockResolvedValue(
      history([100, 98, 96, 94, 92, 90, 88, 86, 84, 82, 80, 78, 76, 74, 72]),
    );

    const seeded = await alertsTool.execute("test", { action: "check" });
    expect(seeded.content[0].text).toContain("seeded");

    vi.mocked(getHistory).mockResolvedValue(
      history([72, 74, 73, 75, 74, 76, 75, 77, 76, 78, 77, 79, 78, 80, 60]),
    );
    const checked = await alertsTool.execute("test", { action: "check" });
    expect(checked.details.checked).toBe(1);
  });

  it("creates SMA crossing alerts with canonical condition JSON", async () => {
    const created = await alertsTool.execute("test", {
      action: "create_price_above_sma",
      symbol: "AAPL",
      period: 50,
    });

    expect(created.details).toMatchObject({
      conditionType: "price_crosses_sma",
      conditionJson: { period: 50, direction: "above", price_field: "close" },
      timeframe: "1d",
    });
  });

  it("creates percent-move alerts with canonical condition JSON", async () => {
    const created = await alertsTool.execute("test", {
      action: "create_percent_move_up",
      symbol: "AAPL",
      threshold: 5,
    });

    expect(created.details).toMatchObject({
      conditionType: "percent_move",
      conditionJson: { direction: "up", percent: 5, window: "1d" },
      timeframe: "1d",
    });
  });

  it("creates SMA-cross alerts with canonical condition JSON", async () => {
    const created = await alertsTool.execute("test", {
      action: "create_sma_cross_above",
      symbol: "AAPL",
      fast_period: 3,
      slow_period: 5,
    });

    expect(created.details).toMatchObject({
      conditionType: "sma_cross",
      conditionJson: { fast_period: 3, slow_period: 5, direction: "above" },
      timeframe: "1d",
    });
  });

  it("rejects fractional SMA-cross lookback periods before storing a rule", async () => {
    await expect(
      alertsTool.execute("test", {
        action: "create_sma_cross_above",
        symbol: "AAPL",
        fast_period: 2.5,
        slow_period: 5,
      }),
    ).rejects.toThrow("fast_period and slow_period must be whole-number lookback periods");

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    expect(service.listAlertRules()).toHaveLength(0);
    db.close();
  });

  it("rejects invalid indicator alert lookback periods before storing a rule", async () => {
    await expect(
      alertsTool.execute("test", {
        action: "create_price_above_sma",
        symbol: "AAPL",
        period: 2.5,
      }),
    ).rejects.toThrow("period must be a whole-number lookback period");

    await expect(
      alertsTool.execute("test", {
        action: "create_volume_spike",
        symbol: "AAPL",
        period: -5,
      }),
    ).rejects.toThrow("period must be a whole-number lookback period");

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    expect(service.listAlertRules()).toHaveLength(0);
    db.close();
  });

  it("rejects lookback periods longer than the alert runner's history window", async () => {
    await expect(
      alertsTool.execute("test", {
        action: "create_sma_cross_above",
        symbol: "AAPL",
        fast_period: 50,
        slow_period: 1000,
      }),
    ).rejects.toThrow("slow_period must be at most 400");

    await expect(
      alertsTool.execute("test", {
        action: "create_price_above_sma",
        symbol: "AAPL",
        period: 500,
      }),
    ).rejects.toThrow("period must be at most 200");

    await expect(
      alertsTool.execute("test", {
        action: "create_rsi_above",
        symbol: "AAPL",
        threshold: 70,
        period: 500,
      }),
    ).rejects.toThrow("period must be at most 100");

    await expect(
      alertsTool.execute("test", {
        action: "create_volume_spike",
        symbol: "AAPL",
        period: 500,
      }),
    ).rejects.toThrow("period must be at most 100");

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    expect(service.listAlertRules()).toHaveLength(0);
    db.close();
  });

  it("allows zero cooldowns and rejects negative cooldowns before storing a rule", async () => {
    const created = await alertsTool.execute("test", {
      action: "create_price_above",
      symbol: "AAPL",
      threshold: 250,
      cooldown_seconds: 0,
    });
    expect(created.details).toMatchObject({ cooldownSeconds: 0 });

    await expect(
      alertsTool.execute("test", {
        action: "create_price_below",
        symbol: "AAPL",
        threshold: 100,
        cooldown_seconds: -1,
      }),
    ).rejects.toThrow("cooldown_seconds must be a whole number greater than or equal to 0");

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    expect(service.listAlertRules()).toHaveLength(1);
    db.close();
  });

  it("creates and manually checks volume-spike alerts", async () => {
    const created = await alertsTool.execute("test", {
      action: "create_volume_spike",
      symbol: "AAPL",
      threshold: 2,
      period: 5,
    });

    expect(created.details).toMatchObject({
      conditionType: "volume_spike",
      conditionJson: { lookback_period: 5, multiplier: 2 },
      timeframe: "1d",
    });

    vi.mocked(getHistory).mockResolvedValue(
      historyWithVolumes([100, 101, 102, 103, 104, 105], [100, 100, 100, 100, 100, 150]),
    );
    const seeded = await alertsTool.execute("test", { action: "check" });
    expect(seeded.content[0].text).toContain("seeded");

    vi.mocked(getHistory).mockResolvedValue(
      historyWithVolumes([100, 101, 102, 103, 104, 105], [100, 100, 100, 100, 100, 250]),
    );
    const triggered = await alertsTool.execute("test", { action: "check" });
    expect(triggered.content[0].text).toContain("TRIGGERED");
    expect(triggered.details).toMatchObject({ checked: 1, triggered: 1 });
  });

  it("does not seed or trigger on zero-filled quote data", async () => {
    await alertsTool.execute("test", {
      action: "create_price_above",
      symbol: "AAPL",
      threshold: 250,
    });
    vi.mocked(getQuote).mockResolvedValue(
      quote("AAPL", 0, { volume: 0, week52High: 0, week52Low: 0 }),
    );

    const checked = await alertsTool.execute("test", { action: "check" });

    expect(checked.content[0].text).toMatch(/unavailable/i);
    expect(checked.content[0].text).toMatch(/no valid market data/i);
    expect(checked.details).toMatchObject({ checked: 1, triggered: 0 });

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    const [rule] = service.listAlertRules();
    expect(rule.lastCheckedAt).not.toBeNull();
    expect(rule.lastObservedJson).toBeNull();
    expect(service.listAlertEvents()).toEqual([
      expect.objectContaining({
        status: "unavailable",
        message: expect.stringMatching(/no valid market data/i),
      }),
    ]);
    db.close();
  });

  it("does not seed or trigger on stale provider data", async () => {
    await alertsTool.execute("test", {
      action: "create_price_above",
      symbol: "AAPL",
      threshold: 250,
    });
    cache.set("test-stale-alert-quote", quote("AAPL", 260), -1);
    vi.mocked(getQuote).mockImplementation(async () => {
      cache.getStale("test-stale-alert-quote", 60_000);
      return quote("AAPL", 260);
    });

    const checked = await alertsTool.execute("test", { action: "check" });

    expect(checked.content[0].text).toMatch(/unavailable/i);
    expect(checked.content[0].text).toMatch(/stale/i);
    expect(checked.details).toMatchObject({ checked: 1, triggered: 0 });

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    const [rule] = service.listAlertRules();
    expect(rule.lastCheckedAt).not.toBeNull();
    expect(rule.lastObservedJson).toBeNull();
    expect(service.listAlertEvents()).toEqual([
      expect.objectContaining({
        status: "unavailable",
        message: expect.stringMatching(/stale/i),
      }),
    ]);
    db.close();
  });

  it("reports unsupported condition versions as needing review", async () => {
    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    const item = service.addWatchlistItem({
      instrument: {
        symbol: "AAPL",
        assetType: "equity",
        name: "Apple Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
    });
    service.createAlertRule({
      scopeType: "instrument",
      instrumentId: item.instrumentId,
      conditionType: "price_crosses_above",
      conditionVersion: 999,
      condition: { threshold: 250, field: "last_price" },
      timeframe: "quote",
      cooldownSeconds: 3600,
    });
    db.close();

    const checked = await alertsTool.execute("test", { action: "check" });

    expect(checked.content[0].text).toMatch(/needs review/i);
    expect(checked.content[0].text).toContain("version 999");
    expect(checked.details).toMatchObject({ checked: 1, triggered: 0 });
  });
});

function quote(symbol: string, price: number, overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    symbol,
    price,
    change: 0,
    changePercent: 0,
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

function history(closes: number[]): OHLCV[] {
  return closes.map((close, index) => ({
    date: `2026-05-${String(index + 1).padStart(2, "0")}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1_000,
  }));
}

function historyWithVolumes(closes: number[], volumes: number[]): OHLCV[] {
  return closes.map((close, index) => ({
    date: `2026-05-${String(index + 1).padStart(2, "0")}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: volumes[index] ?? 0,
  }));
}
