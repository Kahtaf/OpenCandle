import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { portfolioTrackerTool } from "../../../src/tools/portfolio/tracker.js";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import type { StockQuote } from "../../../src/types/market.js";
import { initDefaultDatabase } from "../../../src/memory/sqlite.js";
import { MarketStateService } from "../../../src/market-state/service.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
}));

describe("portfolioTrackerTool", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-portfolio-test-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => quote(symbol.toUpperCase(), 300));
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

  it("adds a resolved holding to SQLite without creating portfolio.json", async () => {
    const result = await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "VTI",
      shares: 2,
      avg_cost: 250,
    });

    expect(result.content[0].text).toContain("VTI");
    expect(existsSync(join(openCandleHome, "state.db"))).toBe(true);
    expect(existsSync(join(openCandleHome, "portfolio.json"))).toBe(false);
  });

  it("views persisted holdings with live P&L", async () => {
    await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "VTI",
      shares: 2,
      avg_cost: 250,
    });
    vi.mocked(getQuote).mockResolvedValue(quote("VTI", 300));

    const result = await portfolioTrackerTool.execute("test", { action: "view" });

    expect(result.content[0].text).toContain("VTI");
    expect(result.content[0].text).toContain("Value: $600.00");
    expect(result.details?.positions[0]).toMatchObject({
      symbol: "VTI",
      shares: 2,
      avgCost: 250,
      currentPrice: 300,
      marketValue: 600,
    });
  });

  it("excludes unsupported mixed-currency rows from base-currency totals", async () => {
    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    service.addPortfolioLot({
      instrument: {
        symbol: "VTI",
        assetType: "etf",
        name: "Vanguard Total Stock Market ETF",
        exchange: "PCX",
        currency: "USD",
        provider: "yahoo",
      },
      quantity: 2,
      avgCost: 250,
      currency: "USD",
    });
    service.addPortfolioLot({
      instrument: {
        symbol: "SHOP.TO",
        assetType: "equity",
        name: "Shopify Inc.",
        exchange: "TOR",
        currency: "CAD",
        provider: "yahoo",
      },
      quantity: 3,
      avgCost: 100,
      currency: "CAD",
    });
    db.close();
    vi.mocked(getQuote).mockImplementation(async (symbol: string) =>
      quote(symbol.toUpperCase(), symbol.toUpperCase() === "SHOP.TO" ? 120 : 300),
    );

    const result = await portfolioTrackerTool.execute("test", { action: "view" });

    expect(result.content[0].text).toContain("Value: $600.00");
    expect(result.content[0].text).toContain("Excluded from USD totals: SHOP.TO (CAD)");
    expect(result.details?.totalValue).toBe(600);
    expect(result.details?.positions).toEqual([
      expect.objectContaining({
        symbol: "VTI",
        currency: "USD",
        includedInTotals: true,
        marketValue: 600,
      }),
      expect.objectContaining({
        symbol: "SHOP.TO",
        currency: "CAD",
        includedInTotals: false,
        marketValue: 360,
      }),
    ]);
  });

  it("updates an existing portfolio lot through an explicit update action", async () => {
    await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "VTI",
      shares: 2,
      avg_cost: 250,
    });

    const update = await portfolioTrackerTool.execute("test", {
      action: "update",
      symbol: "VTI",
      shares: 3,
      avg_cost: 240,
      currency: "USD",
    });

    expect(update.content[0].text).toContain("Updated VTI");

    const result = await portfolioTrackerTool.execute("test", { action: "view" });
    expect(result.details?.positions[0]).toMatchObject({
      symbol: "VTI",
      shares: 3,
      avgCost: 240,
      totalCost: 720,
      marketValue: 900,
    });
  });

  it("removes all lots for a symbol", async () => {
    await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "VTI",
      shares: 2,
      avg_cost: 250,
    });

    const remove = await portfolioTrackerTool.execute("test", {
      action: "remove",
      symbol: "VTI",
    });
    expect(remove.content[0].text).toContain("Removed");

    const view = await portfolioTrackerTool.execute("test", { action: "view" });
    expect(view.content[0].text.toLowerCase()).toContain("empty");
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
