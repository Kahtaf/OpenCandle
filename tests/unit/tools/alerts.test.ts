import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { alertsTool } from "../../../src/tools/portfolio/alerts.js";
import { getHistory, getQuote } from "../../../src/providers/yahoo-finance.js";
import type { OHLCV, StockQuote } from "../../../src/types/market.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
  getHistory: vi.fn(),
}));

describe("alertsTool", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-alerts-test-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 180));
    vi.mocked(getHistory).mockResolvedValue(history([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114]));
  });

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalEnv;
    }
    rmSync(openCandleHome, { recursive: true, force: true });
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
});

function quote(symbol: string, price: number): StockQuote {
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
