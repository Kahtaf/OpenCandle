import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { portfolioTrackerTool } from "../../../src/tools/portfolio/tracker.js";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import type { StockQuote } from "../../../src/types/market.js";

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
