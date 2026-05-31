import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { alertsTool } from "../../../src/tools/portfolio/alerts.js";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import type { StockQuote } from "../../../src/types/market.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
}));

describe("alertsTool", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-alerts-test-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 180));
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
