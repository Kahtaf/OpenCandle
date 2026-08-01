import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getBrowserHostedToolDefinitions } from "../../../gui/hosted/runtime/hosted-tool-composition.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import { createSqlJsStateDatabase } from "../../../src/runtime/sqljs-state-database-node.js";

describe("hosted canonical stateful tools", () => {
  let database: Awaited<ReturnType<typeof createSqlJsStateDatabase>>;

  beforeEach(async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("unit test attempted a live provider request");
      }),
    );
    database = await createSqlJsStateDatabase();
  });

  afterEach(() => {
    database.close();
    vi.unstubAllGlobals();
  });

  it("executes watchlist and portfolio commands against injected browser SQLite", async () => {
    const tools = getBrowserHostedToolDefinitions({
      stateDatabase: database,
      marketStateDependencies: {
        resolveInstrument: async (symbol) => ({
          status: "resolved",
          instrument: { symbol, assetType: "equity", currency: "USD", provider: "test" },
        }),
        getCurrentPrice: async () => ({ status: "ok", price: 200, currency: "USD" }),
      },
    });

    await execute(tools, "manage_watchlist", { action: "add", symbol: "AAPL" });
    await execute(tools, "track_portfolio", {
      action: "add",
      symbol: "AAPL",
      shares: 2,
      avg_cost: 180,
      currency: "USD",
    });
    const state = new MarketStateService(database);

    expect(state.listWatchlistItems()).toEqual([expect.objectContaining({ symbol: "AAPL" })]);
    expect(state.listPortfolioLots()).toEqual([
      expect.objectContaining({ symbol: "AAPL", quantity: 2, avgCost: 180 }),
    ]);
    expect(() => database.prepare("SELECT 1").get()).not.toThrow();
  });

  it("keeps foreground alerts and reports while background execution stays out of process", async () => {
    const tools = getBrowserHostedToolDefinitions({ stateDatabase: database });

    const alertCheck = await execute(tools, "manage_alerts", { action: "check" });
    const report = await execute(tools, "daily_watchlist_report", { action: "run" });
    const notifications = await execute(tools, "manage_notifications", { action: "list" });

    expect(alertCheck.content[0]?.text).not.toContain("unavailable in serverless browser mode");
    expect(report.content[0]?.text).toContain("Daily Watchlist Report");
    expect(notifications.content[0]?.text).toBeTruthy();
  });

  it("accepts explicit hosted symbols without adding a provider lookup to saved-state forms", async () => {
    const resolveInstrument = vi.fn(async () => {
      throw new Error("unexpected provider lookup");
    });
    const tools = getBrowserHostedToolDefinitions({
      stateDatabase: database,
      marketStateDependencies: { resolveInstrument },
    });

    await execute(tools, "manage_watchlist", {
      action: "add",
      symbol: "AAPL",
      unverified_exact_symbol: true,
    });
    await execute(tools, "manage_alerts", {
      action: "create_price_above",
      symbol: "NVDA",
      threshold: 250,
      unverified_exact_symbol: true,
    });
    await execute(tools, "track_portfolio", {
      action: "add",
      symbol: "MSFT",
      shares: 2,
      avg_cost: 300,
      currency: "USD",
      unverified_exact_symbol: true,
    });

    expect(resolveInstrument).not.toHaveBeenCalled();
    const state = new MarketStateService(database);
    expect(state.listWatchlistItems().map(({ symbol }) => symbol)).toContain("AAPL");
    expect(state.listPortfolioLots().map(({ symbol }) => symbol)).toContain("MSFT");
    expect((await execute(tools, "manage_alerts", { action: "list" })).content[0]?.text).toContain(
      "NVDA",
    );
  });

  it("does not treat a supplied currency as explicit permission to skip symbol resolution", async () => {
    const resolveInstrument = vi.fn(async () => ({
      status: "needs_selection" as const,
      message: "Choose the intended instrument.",
      candidates: [
        {
          symbol: "AAPL",
          name: "Apple Inc.",
          assetType: "equity" as const,
          currency: "USD",
          provider: "test",
        },
      ],
    }));
    const tools = getBrowserHostedToolDefinitions({
      stateDatabase: database,
      marketStateDependencies: { resolveInstrument },
    });

    const result = await execute(tools, "track_portfolio", {
      action: "add",
      symbol: "APPL",
      shares: 2,
      avg_cost: 180,
      currency: "USD",
    });

    expect(resolveInstrument).toHaveBeenCalledWith(
      "APPL",
      expect.objectContaining({ currency: "USD", unverifiedExactSymbol: false }),
    );
    expect(result.details).toEqual(expect.objectContaining({ status: "needs_selection" }));
    expect(new MarketStateService(database).listPortfolioLots()).toEqual([]);
  });
});

async function execute(
  tools: ReturnType<typeof getBrowserHostedToolDefinitions>,
  name: string,
  args: Record<string, unknown>,
) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing tool: ${name}`);
  return tool.execute("test-call", args, undefined, () => undefined);
}
