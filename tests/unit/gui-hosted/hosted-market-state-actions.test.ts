import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

  it("lists stable watchlist item ids in assistant-visible check content", () => {
    const added = invokeHostedMarketStateTool(service, "manage_watchlist", {
      action: "add",
      symbol: "AAPL",
    });

    const checked = invokeHostedMarketStateTool(service, "manage_watchlist", {
      action: "check",
    });

    const item = added.result.details as { id: number };
    expect(checked.result.content[0]?.text).toContain(`AAPL [item ${item.id}]`);
  });

  it("lists stable portfolio lot ids in assistant-visible view content", () => {
    const added = invokeHostedMarketStateTool(service, "track_portfolio", {
      action: "add",
      symbol: "AAPL",
      shares: 2,
      avg_cost: 180,
      currency: "USD",
    });

    const viewed = invokeHostedMarketStateTool(service, "track_portfolio", {
      action: "view",
    });

    const lot = added.result.details as { id: number };
    expect(viewed.result.content[0]?.text).toContain(`AAPL [lot ${lot.id}]`);
  });

  it("cannot update a lot belonging to a different portfolio", () => {
    invokeHostedMarketStateTool(service, "track_portfolio", {
      action: "create",
      portfolio_name: "Retirement",
    });
    const added = invokeHostedMarketStateTool(service, "track_portfolio", {
      action: "add",
      portfolio_name: "Retirement",
      symbol: "MSFT",
      shares: 3,
      avg_cost: 200,
      currency: "USD",
    });
    const lot = added.result.details as { id: number };

    expect(() =>
      invokeHostedMarketStateTool(service, "track_portfolio", {
        action: "update",
        portfolio_name: "Default",
        lot_id: lot.id,
        shares: 99,
      }),
    ).toThrow("not found");
    expect(service.listPortfolioLots(service.getPortfolioByName("Retirement")?.id)).toEqual([
      expect.objectContaining({ id: lot.id, quantity: 3 }),
    ]);
  });

  it("cannot remove a lot belonging to a different portfolio", () => {
    invokeHostedMarketStateTool(service, "track_portfolio", {
      action: "create",
      portfolio_name: "Retirement",
    });
    const added = invokeHostedMarketStateTool(service, "track_portfolio", {
      action: "add",
      portfolio_name: "Retirement",
      symbol: "MSFT",
      shares: 3,
      avg_cost: 200,
      currency: "USD",
    });
    const lot = added.result.details as { id: number };

    const removed = invokeHostedMarketStateTool(service, "track_portfolio", {
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
