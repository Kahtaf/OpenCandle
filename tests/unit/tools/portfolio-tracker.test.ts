import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { portfolioTrackerTool } from "../../../src/tools/portfolio/tracker.js";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import { httpGet } from "../../../src/infra/http-client.js";
import { cache } from "../../../src/infra/cache.js";
import type { StockQuote } from "../../../src/types/market.js";
import { initDefaultDatabase } from "../../../src/memory/sqlite.js";
import { MarketStateService } from "../../../src/market-state/service.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
}));
vi.mock("../../../src/infra/http-client.js", () => ({
  httpGet: vi.fn(),
}));

describe("portfolioTrackerTool", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
    cache.consumeStaleFlag();
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-portfolio-test-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => quote(symbol.toUpperCase(), 300));
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

  it("adds a resolved holding to SQLite without creating portfolio.json", async () => {
    const result = await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "VTI",
      shares: 2,
      avg_cost: 250,
    });

    expect(result.content[0].text).toContain("VTI");
    expect(result.details).toMatchObject({
      symbol: "VTI",
      instrumentId: expect.any(Number),
      quantity: 2,
      avgCost: 250,
    });
    expect(existsSync(join(openCandleHome, "state.db"))).toBe(true);
    expect(existsSync(join(openCandleHome, "portfolio.json"))).toBe(false);
  });

  it("ignores pre-existing portfolio.json as a state source", async () => {
    writeFileSync(join(openCandleHome, "portfolio.json"), JSON.stringify([{ symbol: "VTI", shares: 2 }]));

    const result = await portfolioTrackerTool.execute("test", { action: "view" });

    expect(result.content[0].text).toContain("Portfolio is empty");
    expect(result.content[0].text).not.toContain("VTI");
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

  it("discloses zero-filled quote data and excludes the row from current-value totals", async () => {
    await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "VTI",
      shares: 2,
      avg_cost: 250,
    });
    vi.mocked(getQuote).mockResolvedValue(quote("VTI", 0, {
      volume: 0,
      week52High: 0,
      week52Low: 0,
    }));

    const result = await portfolioTrackerTool.execute("test", { action: "view" });

    expect(result.content[0].text).toContain("Quote unavailable: Yahoo returned no valid market data.");
    expect(result.details).toMatchObject({
      totalValue: 0,
      totalCost: 0,
      positions: [
        expect.objectContaining({
          symbol: "VTI",
          currentPrice: null,
          marketValue: null,
          includedInTotals: false,
          quoteStatus: "unavailable",
        }),
      ],
      excludedFromTotals: [
        expect.objectContaining({
          symbol: "VTI",
          reason: "Quote unavailable: Yahoo returned no valid market data.",
        }),
      ],
    });
  });

  it("discloses stale quote data and excludes the row from current-value totals", async () => {
    await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "VTI",
      shares: 2,
      avg_cost: 250,
    });
    cache.set("test-stale-portfolio-quote", quote("VTI", 300), -1);
    cache.getStale("test-stale-portfolio-quote", 60_000);
    vi.mocked(getQuote).mockResolvedValue(quote("VTI", 300));

    const result = await portfolioTrackerTool.execute("test", { action: "view" });

    expect(result.content[0].text).toContain("Quote unavailable: provider returned stale market data");
    expect(result.details).toMatchObject({
      totalValue: 0,
      totalCost: 0,
      positions: [
        expect.objectContaining({
          symbol: "VTI",
          currentPrice: null,
          marketValue: null,
          includedInTotals: false,
          quoteStatus: "unavailable",
        }),
      ],
      excludedFromTotals: [
        expect.objectContaining({
          symbol: "VTI",
          reason: "Quote unavailable: provider returned stale market data",
        }),
      ],
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
    expect(update.details).toMatchObject({
      symbol: "VTI",
      instrumentId: expect.any(Number),
      quantity: 3,
      avgCost: 240,
    });

    const result = await portfolioTrackerTool.execute("test", { action: "view" });
    expect(result.details?.positions[0]).toMatchObject({
      symbol: "VTI",
      shares: 3,
      avgCost: 240,
      totalCost: 720,
      marketValue: 900,
    });
  });

  it("returns candidate matches for an unverified add without mutating the portfolio", async () => {
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

    const result = await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "APL",
      shares: 2,
      avg_cost: 150,
    });

    expect(result.content[0].text).toContain("Could not verify APL");
    expect(result.details).toMatchObject({
      status: "needs_selection",
      query: "APL",
      candidates: [
        expect.objectContaining({ symbol: "AAPL", name: "Apple Inc." }),
      ],
    });

    const view = await portfolioTrackerTool.execute("test", { action: "view" });
    expect(view.content[0].text.toLowerCase()).toContain("empty");
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
    expect(remove.details).toMatchObject({
      symbol: "VTI",
      removedCount: 1,
      removedLotIds: [expect.any(Number)],
    });

    const view = await portfolioTrackerTool.execute("test", { action: "view" });
    expect(view.content[0].text.toLowerCase()).toContain("empty");
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
