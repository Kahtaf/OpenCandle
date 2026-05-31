import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { alertsTool } from "../../../src/tools/portfolio/alerts.js";
import { getHistory, getQuote } from "../../../src/providers/yahoo-finance.js";
import { httpGet } from "../../../src/infra/http-client.js";
import { cache } from "../../../src/infra/cache.js";
import type { OHLCV, StockQuote } from "../../../src/types/market.js";
import { initDefaultDatabase } from "../../../src/memory/sqlite.js";
import { MarketStateService } from "../../../src/market-state/service.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
  getHistory: vi.fn(),
}));
vi.mock("../../../src/infra/http-client.js", () => ({
  httpGet: vi.fn(),
}));

describe("alertsTool", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
    cache.consumeStaleFlag();
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-alerts-test-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 180));
    vi.mocked(getHistory).mockResolvedValue(history([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114]));
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
    cache.consumeStaleFlag();
    vi.clearAllMocks();
  });

  it("creates and lists manual price alerts", async () => {
    const created = await alertsTool.execute("test", {
      action: "create_price_above",
      symbol: "AAPL",
      threshold: 250,
    });

    expect(created.content[0].text).toContain("manual alert");
    expect(created.details).toMatchObject({
      conditionType: "price_crosses_above",
      conditionVersion: 1,
      conditionJson: { threshold: 250, field: "last_price" },
      timeframe: "quote",
    });

    const listed = await alertsTool.execute("test", { action: "list" });
    expect(listed.content[0].text).toContain("AAPL");
    expect(listed.content[0].text).toContain("manually checked");
  });

  it("returns candidate matches for an unverified alert symbol without creating a rule", async () => {
    vi.mocked(getQuote).mockResolvedValue(quote("APL", 0, { volume: 0, week52High: 0, week52Low: 0 }));
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
      candidates: [
        expect.objectContaining({ symbol: "AAPL", name: "Apple Inc." }),
      ],
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
    vi.mocked(getHistory).mockResolvedValue(history([
      100, 98, 96, 94, 92, 90, 88, 86, 84, 82, 80, 78, 76, 74, 72,
    ]));

    const seeded = await alertsTool.execute("test", { action: "check" });
    expect(seeded.content[0].text).toContain("seeded");

    vi.mocked(getHistory).mockResolvedValue(history([
      72, 74, 73, 75, 74, 76, 75, 77, 76, 78, 77, 79, 78, 80, 60,
    ]));
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

    vi.mocked(getHistory).mockResolvedValue(historyWithVolumes(
      [100, 101, 102, 103, 104, 105],
      [100, 100, 100, 100, 100, 150],
    ));
    const seeded = await alertsTool.execute("test", { action: "check" });
    expect(seeded.content[0].text).toContain("seeded");

    vi.mocked(getHistory).mockResolvedValue(historyWithVolumes(
      [100, 101, 102, 103, 104, 105],
      [100, 100, 100, 100, 100, 250],
    ));
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
    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 0, { volume: 0, week52High: 0, week52Low: 0 }));

    const checked = await alertsTool.execute("test", { action: "check" });

    expect(checked.content[0].text).toMatch(/unavailable/i);
    expect(checked.content[0].text).toMatch(/no valid market data/i);
    expect(checked.details).toMatchObject({ checked: 1, triggered: 0 });
  });

  it("does not seed or trigger on stale provider data", async () => {
    await alertsTool.execute("test", {
      action: "create_price_above",
      symbol: "AAPL",
      threshold: 250,
    });
    cache.set("test-stale-alert-quote", quote("AAPL", 260), -1);
    cache.getStale("test-stale-alert-quote", 60_000);
    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 260));

    const checked = await alertsTool.execute("test", { action: "check" });

    expect(checked.content[0].text).toMatch(/unavailable/i);
    expect(checked.content[0].text).toMatch(/stale/i);
    expect(checked.details).toMatchObject({ checked: 1, triggered: 0 });

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    const [rule] = service.listAlertRules();
    expect(rule.lastObservedJson).toBeNull();
    expect(service.listAlertEvents()).toHaveLength(0);
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
