import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { httpGet } from "../../../src/infra/http-client.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDefaultDatabase } from "../../../src/memory/sqlite.js";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import { portfolioTrackerTool } from "../../../src/tools/portfolio/tracker.js";
import type { StockQuote } from "../../../src/types/market.js";

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
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-portfolio-test-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
    vi.mocked(getQuote).mockImplementation(async (symbol: string) =>
      quote(symbol.toUpperCase(), 300),
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

  it("rejects zero shares and cost as invalid instead of treating them as missing", async () => {
    await expect(
      portfolioTrackerTool.execute("test", {
        action: "add",
        symbol: "VTI",
        shares: 0,
        avg_cost: 250,
      }),
    ).rejects.toThrow("shares must be greater than 0");

    await expect(
      portfolioTrackerTool.execute("test", {
        action: "add",
        symbol: "VTI",
        shares: 1,
        avg_cost: 0,
      }),
    ).rejects.toThrow("avg_cost must be greater than 0");
  });

  it("ignores pre-existing portfolio.json as a state source", async () => {
    writeFileSync(
      join(openCandleHome, "portfolio.json"),
      JSON.stringify([{ symbol: "VTI", shares: 2 }]),
    );

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

  it("creates, renames, and views named portfolios independently", async () => {
    const created = await portfolioTrackerTool.execute("test", {
      action: "create",
      portfolio_name: "Retirement",
    });
    await portfolioTrackerTool.execute("test", {
      action: "add",
      portfolio_name: "Retirement",
      symbol: "VTI",
      shares: 2,
      avg_cost: 250,
    });
    await portfolioTrackerTool.execute("test", {
      action: "add",
      portfolio_name: "Trading",
      symbol: "TSLA",
      shares: 1,
      avg_cost: 200,
    });

    const renamed = await portfolioTrackerTool.execute("test", {
      action: "rename",
      portfolio_name: "Trading",
      new_portfolio_name: "Speculative",
    });
    const retirement = await portfolioTrackerTool.execute("test", {
      action: "view",
      portfolio_name: "Retirement",
    });
    const speculative = await portfolioTrackerTool.execute("test", {
      action: "view",
      portfolio_name: "Speculative",
    });

    expect(created.content[0].text).toContain("Created portfolio Retirement");
    expect(renamed.content[0].text).toContain("Renamed Trading to Speculative");
    expect(retirement.content[0].text).toContain("**Retirement**");
    expect(retirement.content[0].text).toContain("VTI");
    expect(retirement.content[0].text).not.toContain("TSLA");
    expect(speculative.content[0].text).toContain("**Speculative**");
    expect(speculative.content[0].text).toContain("TSLA");
    expect(speculative.content[0].text).not.toContain("VTI");
  });

  it("does not create duplicate named portfolios", async () => {
    await portfolioTrackerTool.execute("test", {
      action: "create",
      portfolio_name: "Retirement",
    });
    await portfolioTrackerTool.execute("test", {
      action: "create",
      portfolio_name: "Retirement",
    });

    const db = initDefaultDatabase();
    const portfolios = new MarketStateService(db).listPortfolios();
    db.close();

    expect(portfolios.filter((portfolio) => portfolio.name === "Retirement")).toHaveLength(1);
  });

  it("resolves an explicitly named Default portfolio after the original default is renamed", async () => {
    await portfolioTrackerTool.execute("test", {
      action: "rename",
      new_portfolio_name: "Long term",
    });
    await portfolioTrackerTool.execute("test", {
      action: "create",
      portfolio_name: "Default",
    });
    await portfolioTrackerTool.execute("test", {
      action: "add",
      portfolio_name: "Default",
      symbol: "AAPL",
      shares: 2,
      avg_cost: 100,
      currency: "USD",
    });

    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    expect(service.getDefaultPortfolio().name).toBe("Long term");
    expect(service.listPortfolioLots(service.getDefaultPortfolio().id)).toEqual([]);
    const namedDefault = service.getPortfolioByName("Default");
    expect(namedDefault).not.toBeNull();
    expect(service.listPortfolioLots(namedDefault!.id).map(({ symbol }) => symbol)).toEqual([
      "AAPL",
    ]);
    db.close();
  });

  it("rejects renaming a portfolio to an existing name", async () => {
    await portfolioTrackerTool.execute("test", { action: "create", portfolio_name: "Retirement" });
    await portfolioTrackerTool.execute("test", { action: "create", portfolio_name: "Trading" });

    await expect(
      portfolioTrackerTool.execute("test", {
        action: "rename",
        portfolio_name: "Trading",
        new_portfolio_name: "Retirement",
      }),
    ).rejects.toThrow("portfolio Retirement already exists");
  });

  it("does not create a missing portfolio while viewing or renaming", async () => {
    await expect(
      portfolioTrackerTool.execute("test", {
        action: "rename",
        portfolio_name: "Missing",
        new_portfolio_name: "Speculative",
      }),
    ).rejects.toThrow("portfolio Missing not found");

    await expect(
      portfolioTrackerTool.execute("test", {
        action: "view",
        portfolio_name: "Missing",
      }),
    ).rejects.toThrow("portfolio Missing not found");
  });

  it("does not emit NaN for a legacy zero-cost portfolio lot", async () => {
    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
    const portfolio = service.getDefaultPortfolio();
    const instrument = service.upsertInstrumentRecord({
      symbol: "VTI",
      assetType: "etf",
      name: "Vanguard Total Stock Market ETF",
      exchange: "PCX",
      currency: "USD",
      provider: "yahoo",
    });
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO portfolio_lots (
         portfolio_id, instrument_id, quantity, avg_cost, currency,
         opened_at, notes, source, source_account_ref, source_lot_id,
         source_row_id, source_metadata_json, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      portfolio.id,
      instrument.id,
      2,
      0,
      "USD",
      now,
      null,
      null,
      null,
      null,
      null,
      null,
      now,
      now,
    );
    db.close();
    vi.mocked(getQuote).mockResolvedValue(quote("VTI", 300));

    const result = await portfolioTrackerTool.execute("test", { action: "view" });

    expect(result.content[0].text).not.toMatch(/NaN/);
    expect(result.content[0].text).toContain("P&L: unavailable");
    expect(result.details?.positions[0]).toMatchObject({
      symbol: "VTI",
      totalCost: 0,
      pnlPercent: null,
    });
  });

  it("discloses zero-filled quote data and excludes the row from current-value totals", async () => {
    await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "VTI",
      shares: 2,
      avg_cost: 250,
    });
    vi.mocked(getQuote).mockResolvedValue(
      quote("VTI", 0, {
        volume: 0,
        week52High: 0,
        week52Low: 0,
      }),
    );

    const result = await portfolioTrackerTool.execute("test", { action: "view" });

    expect(result.content[0].text).toContain(
      "Quote unavailable: Yahoo returned no valid market data.",
    );
    expect(result.details).toMatchObject({
      totalValue: null,
      totalCost: 500,
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
    vi.mocked(getQuote).mockImplementation(async () => {
      cache.getStale("test-stale-portfolio-quote", 60_000);
      return quote("VTI", 300);
    });

    const result = await portfolioTrackerTool.execute("test", { action: "view" });

    expect(result.content[0].text).toContain(
      "Quote unavailable: provider returned stale market data",
    );
    expect(result.details).toMatchObject({
      totalValue: null,
      totalCost: 500,
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

  it("marks aggregate P&L unavailable when a base-currency lot cannot be valued", async () => {
    await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "VTI",
      shares: 2,
      avg_cost: 250,
    });
    await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "AAPL",
      shares: 1,
      avg_cost: 180,
    });
    vi.mocked(getQuote).mockImplementation(async (symbol: string) =>
      symbol === "VTI"
        ? quote("VTI", 300)
        : quote("AAPL", 0, { volume: 0, week52High: 0, week52Low: 0 }),
    );

    const result = await portfolioTrackerTool.execute("test", { action: "view" });

    expect(result.content[0].text).toContain("Value: unavailable | P&L: unavailable");
    expect(result.details).toMatchObject({
      totalValue: null,
      totalCost: 680,
      totalPnl: null,
      totalsStatus: "unavailable",
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
      symbol.toUpperCase() === "SHOP.TO"
        ? quote("SHOP.TO", 120, { currency: "CAD" })
        : quote(symbol.toUpperCase(), 300),
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

  it("does not compute row value or P&L when quote and lot currencies differ", async () => {
    const db = initDefaultDatabase();
    const service = new MarketStateService(db);
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
      currency: "USD",
    });
    db.close();
    vi.mocked(getQuote).mockResolvedValue(quote("SHOP.TO", 120, { currency: "CAD" }));

    const result = await portfolioTrackerTool.execute("test", { action: "view" });

    expect(result.content[0].text).toContain("P&L: unavailable");
    expect(result.details?.positions).toEqual([
      expect.objectContaining({
        symbol: "SHOP.TO",
        currency: "USD",
        currentPrice: null,
        marketValue: null,
        pnl: null,
        pnlPercent: null,
        includedInTotals: false,
      }),
    ]);
    expect(result.details?.excludedFromTotals).toEqual([
      expect.objectContaining({
        symbol: "SHOP.TO",
        reason: "No FX conversion from CAD to USD",
      }),
    ]);
  });

  it("uses provider currency for foreign listings when no lot currency is supplied", async () => {
    vi.mocked(getQuote).mockResolvedValue(quote("SHOP.TO", 120, { currency: "CAD" }));

    const add = await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "SHOP.TO",
      shares: 3,
      avg_cost: 100,
    });

    expect(add.details).toMatchObject({
      symbol: "SHOP.TO",
      currency: "CAD",
      instrumentCurrency: "CAD",
    });

    const view = await portfolioTrackerTool.execute("test", { action: "view" });
    expect(view.content[0].text).toContain("Excluded from USD totals: SHOP.TO (CAD)");
    expect(view.details).toMatchObject({
      totalValue: null,
      positions: [
        expect.objectContaining({
          symbol: "SHOP.TO",
          currency: "CAD",
          includedInTotals: false,
        }),
      ],
    });
  });

  it("does not save a holding with an unknown currency unless one is supplied", async () => {
    vi.mocked(getQuote).mockResolvedValue(quote("SHOP.TO", 120, { currency: null }));

    const add = await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "SHOP.TO",
      shares: 3,
      avg_cost: 100,
    });

    expect(add.content[0].text).toContain("Could not determine currency");
    expect(add.details).toMatchObject({
      status: "needs_currency",
      symbol: "SHOP.TO",
    });

    const view = await portfolioTrackerTool.execute("test", { action: "view" });
    expect(view.content[0].text.toLowerCase()).toContain("empty");
  });

  it("updates an existing portfolio lot through an explicit update action", async () => {
    const add = await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "VTI",
      shares: 2,
      avg_cost: 250,
    });
    const lotId = (add.details as { id: number }).id;

    const update = await portfolioTrackerTool.execute("test", {
      action: "update",
      lot_id: lotId,
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

  it("does not update a lot belonging to a different selected portfolio", async () => {
    await portfolioTrackerTool.execute("test", {
      action: "create",
      portfolio_name: "Retirement",
    });
    const added = await portfolioTrackerTool.execute("test", {
      action: "add",
      portfolio_name: "Retirement",
      symbol: "VTI",
      shares: 2,
      avg_cost: 250,
    });
    const lotId = (added.details as { id: number }).id;

    const update = await portfolioTrackerTool.execute("test", {
      action: "update",
      portfolio_name: "Default",
      lot_id: lotId,
      shares: 99,
    });

    expect(update.content[0].text).toContain(`lot ${lotId} not found in portfolio`);
    const retirement = await portfolioTrackerTool.execute("test", {
      action: "view",
      portfolio_name: "Retirement",
    });
    expect(retirement.details?.positions[0]).toMatchObject({ shares: 2, avgCost: 250 });
  });

  it("requires lot_id for portfolio updates and leaves same-symbol lots unchanged", async () => {
    await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "VTI",
      shares: 2,
      avg_cost: 250,
    });
    await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "VTI",
      shares: 3,
      avg_cost: 240,
    });

    const update = await portfolioTrackerTool.execute("test", {
      action: "update",
      symbol: "VTI",
      shares: 10,
      avg_cost: 100,
    });

    expect(update.content[0].text).toContain("lot_id is required");
    expect(update.details).toMatchObject({ status: "needs_lot_id", symbol: "VTI" });

    const view = await portfolioTrackerTool.execute("test", { action: "view" });
    expect(view.details?.positions).toEqual([
      expect.objectContaining({ symbol: "VTI", shares: 2, avgCost: 250 }),
      expect.objectContaining({ symbol: "VTI", shares: 3, avgCost: 240 }),
    ]);
  });

  it("returns candidate matches for an unverified add without mutating the portfolio", async () => {
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
      candidates: [expect.objectContaining({ symbol: "AAPL", name: "Apple Inc." })],
    });

    const view = await portfolioTrackerTool.execute("test", { action: "view" });
    expect(view.content[0].text.toLowerCase()).toContain("empty");
  });

  it("requires a stable lot id instead of deleting every lot for a symbol", async () => {
    await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "VTI",
      shares: 2,
      avg_cost: 250,
    });

    await expect(
      portfolioTrackerTool.execute("test", {
        action: "remove",
        symbol: "VTI",
      }),
    ).rejects.toThrow("lot_id is required");

    const view = await portfolioTrackerTool.execute("test", { action: "view" });
    expect(view.content[0].text).toContain("VTI [lot ");
  });

  it("removes only the selected lot when lot_id is supplied", async () => {
    const first = await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "VTI",
      shares: 2,
      avg_cost: 250,
    });
    const second = await portfolioTrackerTool.execute("test", {
      action: "add",
      symbol: "VTI",
      shares: 3,
      avg_cost: 240,
    });

    const firstLotId = (first.details as { id: number }).id;
    const secondLotId = (second.details as { id: number }).id;
    const remove = await portfolioTrackerTool.execute("test", {
      action: "remove",
      lot_id: firstLotId,
    });

    expect(remove.content[0].text).toContain(`Removed VTI portfolio lot ${firstLotId}`);
    expect(remove.details).toMatchObject({
      id: firstLotId,
      symbol: "VTI",
    });

    const view = await portfolioTrackerTool.execute("test", { action: "view" });
    expect(view.details).toMatchObject({
      positions: [
        expect.objectContaining({
          symbol: "VTI",
          shares: 3,
          avgCost: 240,
        }),
      ],
    });
    expect((view.details as { positions: unknown[] }).positions).toHaveLength(1);
    expect(secondLotId).not.toBe(firstLotId);
  });

  it("does not remove a lot from a different named portfolio", async () => {
    const retirementLot = await portfolioTrackerTool.execute("test", {
      action: "add",
      portfolio_name: "Retirement",
      symbol: "VTI",
      shares: 2,
      avg_cost: 250,
    });
    const retirementLotId = (retirementLot.details as { id: number }).id;

    const removeFromDefault = await portfolioTrackerTool.execute("test", {
      action: "remove",
      lot_id: retirementLotId,
    });

    expect(removeFromDefault.content[0].text).toBe(`lot ${retirementLotId} not found in portfolio`);
    expect(removeFromDefault.details).toBeNull();

    const retirement = await portfolioTrackerTool.execute("test", {
      action: "view",
      portfolio_name: "Retirement",
    });
    expect(retirement.details?.positions).toEqual([
      expect.objectContaining({ lotId: retirementLotId, symbol: "VTI" }),
    ]);
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
    currency: "USD",
    ...overrides,
  };
}
