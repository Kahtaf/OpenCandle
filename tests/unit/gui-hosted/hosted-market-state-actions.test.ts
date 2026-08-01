import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invokeHostedMarketStateTool } from "../../../gui/hosted/runtime/hosted-market-state-actions.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import {
  createSqlJsStateDatabase,
  type SqlJsStateDatabase,
} from "../../../src/runtime/sqljs-state-database-node.js";

describe("hosted market-state actions", () => {
  let database: SqlJsStateDatabase;
  let service: MarketStateService;

  beforeEach(async () => {
    database = await createSqlJsStateDatabase();
    service = new MarketStateService(database);
  });

  afterEach(() => database.close());

  it("lists stable watchlist item ids in assistant-visible check content", async () => {
    const added = await invokeHostedMarketStateTool(
      service,
      "manage_watchlist",
      { action: "add", symbol: "AAPL" },
      "hosted-watchlist",
      {
        resolveInstrument: async () => ({
          status: "resolved",
          instrument: { symbol: "AAPL", assetType: "equity", currency: "USD", provider: "yahoo" },
        }),
      },
    );

    const checked = await invokeHostedMarketStateTool(service, "manage_watchlist", {
      action: "check",
    });

    const item = added.result.details as { id: number };
    expect(checked.result.content[0]?.text).toContain(`AAPL [item ${item.id}]`);
  });

  it("resolves watchlist metadata instead of guessing USD", async () => {
    const added = await invokeHostedMarketStateTool(
      service,
      "manage_watchlist",
      { action: "add", symbol: "SHOP.TO" },
      "hosted-watchlist-currency",
      {
        resolveInstrument: async () => ({
          status: "resolved",
          instrument: {
            symbol: "SHOP.TO",
            assetType: "equity",
            name: "Shopify Inc.",
            currency: "CAD",
            provider: "yahoo",
          },
        }),
      },
    );

    expect(added.result.details).toMatchObject({ symbol: "SHOP.TO", currency: "CAD" });
    expect(service.listWatchlistItems()[0]).toMatchObject({ symbol: "SHOP.TO", currency: "CAD" });
  });

  it("stores an explicitly confirmed hosted symbol without guessing its currency", async () => {
    const resolveInstrument = vi.fn(async () => {
      throw new Error("provider resolution should not run for an explicit hosted fallback");
    });

    const added = await invokeHostedMarketStateTool(
      service,
      "manage_watchlist",
      { action: "add", symbol: "AAPL", unverified_exact_symbol: true },
      "hosted-watchlist-exact",
      { resolveInstrument },
    );

    expect(resolveInstrument).not.toHaveBeenCalled();
    expect(added.result.details).toMatchObject({
      symbol: "AAPL",
      currency: null,
    });
    expect(service.listWatchlistItems()[0]).toMatchObject({ symbol: "AAPL", currency: null });
  });

  it("lists stable portfolio lot ids in assistant-visible view content", async () => {
    const added = await invokeHostedMarketStateTool(service, "track_portfolio", {
      action: "add",
      symbol: "AAPL",
      shares: 2,
      avg_cost: 180,
      currency: "USD",
    });

    const viewed = await invokeHostedMarketStateTool(
      service,
      "track_portfolio",
      { action: "view" },
      "hosted-view",
      {
        getCurrentPrice: async () => ({ status: "unavailable", reason: "test fixture" }),
      },
    );

    const lot = added.result.details as { id: number };
    expect(viewed.result.content[0]?.text).toContain(`AAPL [lot ${lot.id}]`);
  });

  it("resolves the instrument currency instead of guessing USD for a new lot", async () => {
    const added = await invokeHostedMarketStateTool(
      service,
      "track_portfolio",
      {
        action: "add",
        symbol: "SHOP.TO",
        shares: 2,
        avg_cost: 140,
      },
      "hosted-currency",
      {
        resolveInstrument: async () => ({
          status: "resolved",
          instrument: {
            symbol: "SHOP.TO",
            assetType: "equity",
            name: "Shopify Inc.",
            currency: "CAD",
            provider: "yahoo",
            providerMetadata: { verified: true },
          },
        }),
      },
    );

    expect(added.result.details).toMatchObject({ symbol: "SHOP.TO", currency: "CAD" });
    expect(added.result.content[0]?.text).toContain("CAD");
  });

  it("returns live hosted P&L from the canonical portfolio view contract", async () => {
    await invokeHostedMarketStateTool(service, "track_portfolio", {
      action: "add",
      symbol: "AAPL",
      shares: 2,
      avg_cost: 180,
      currency: "USD",
    });

    const viewed = await invokeHostedMarketStateTool(
      service,
      "track_portfolio",
      { action: "view" },
      "hosted-pnl",
      {
        getCurrentPrice: async () => ({ status: "ok", price: 200, currency: "USD" }),
      },
    );

    expect(viewed.result.content[0]?.text).toContain("P&L: $40.00 (+11.11%)");
    expect(viewed.result.details).toMatchObject({
      totalValue: 400,
      totalCost: 360,
      totalPnl: 40,
      positions: [{ currentPrice: 200, pnl: 40, includedInTotals: true }],
    });
  });

  it("cannot update a lot belonging to a different portfolio", async () => {
    await invokeHostedMarketStateTool(service, "track_portfolio", {
      action: "create",
      portfolio_name: "Retirement",
    });
    const added = await invokeHostedMarketStateTool(service, "track_portfolio", {
      action: "add",
      portfolio_name: "Retirement",
      symbol: "MSFT",
      shares: 3,
      avg_cost: 200,
      currency: "USD",
    });
    const lot = added.result.details as { id: number };

    await expect(
      invokeHostedMarketStateTool(service, "track_portfolio", {
        action: "update",
        portfolio_name: "Default",
        lot_id: lot.id,
        shares: 99,
      }),
    ).rejects.toThrow("not found");
    expect(service.listPortfolioLots(service.getPortfolioByName("Retirement")?.id)).toEqual([
      expect.objectContaining({ id: lot.id, quantity: 3 }),
    ]);
  });

  it("cannot remove a lot belonging to a different portfolio", async () => {
    await invokeHostedMarketStateTool(service, "track_portfolio", {
      action: "create",
      portfolio_name: "Retirement",
    });
    const added = await invokeHostedMarketStateTool(service, "track_portfolio", {
      action: "add",
      portfolio_name: "Retirement",
      symbol: "MSFT",
      shares: 3,
      avg_cost: 200,
      currency: "USD",
    });
    const lot = added.result.details as { id: number };

    const removed = await invokeHostedMarketStateTool(service, "track_portfolio", {
      action: "remove",
      portfolio_name: "Default",
      lot_id: lot.id,
    });

    expect(removed.result.content[0]?.text).toContain("not found");
    expect(service.listPortfolioLots(service.getPortfolioByName("Retirement")?.id)).toEqual([
      expect.objectContaining({ id: lot.id }),
    ]);
  });
});
