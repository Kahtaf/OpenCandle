import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { watchlistTool } from "../../../src/tools/portfolio/watchlist.js";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import type { StockQuote } from "../../../src/types/market.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
}));

describe("watchlistTool", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-watchlist-test-"));
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

  it("has correct tool metadata", () => {
    expect(watchlistTool.name).toBe("manage_watchlist");
    expect(watchlistTool.label).toBeTruthy();
    expect(watchlistTool.description).toBeTruthy();
  });

  it("adds a resolved symbol to SQLite without creating watchlist.json", async () => {
    const result = await watchlistTool.execute("test", {
      action: "add",
      symbol: "AAPL",
      target_price: 200,
      stop_price: 150,
    });

    expect(result.content[0].text).toContain("AAPL");
    expect(result.details).toMatchObject({
      symbol: "AAPL",
      targetPrice: 200,
      stopPrice: 150,
    });
    expect(existsSync(join(openCandleHome, "state.db"))).toBe(true);
    expect(existsSync(join(openCandleHome, "watchlist.json"))).toBe(false);
  });

  it("updates an existing watchlist item instead of duplicating it", async () => {
    await watchlistTool.execute("test", {
      action: "add",
      symbol: "AAPL",
      target_price: 200,
    });
    const result = await watchlistTool.execute("test", {
      action: "add",
      symbol: "AAPL",
      stop_price: 150,
      notes: "Updated thesis",
    });

    expect(result.details).toMatchObject({
      symbol: "AAPL",
      targetPrice: null,
      stopPrice: 150,
      notes: "Updated thesis",
    });

    const check = await watchlistTool.execute("test", { action: "check" });
    expect(check.content[0].text.match(/AAPL/g)).toHaveLength(1);
  });

  it("updates watchlist metadata through an explicit update action", async () => {
    await watchlistTool.execute("test", {
      action: "add",
      symbol: "AAPL",
      target_price: 200,
      stop_price: 150,
      notes: "Initial note",
    });

    const result = await watchlistTool.execute("test", {
      action: "update",
      symbol: "AAPL",
      target_price: 220,
      notes: "Revised thesis",
    });

    expect(result.content[0].text).toContain("Updated AAPL");
    expect(result.details).toMatchObject({
      symbol: "AAPL",
      targetPrice: 220,
      stopPrice: 150,
      notes: "Revised thesis",
    });
  });

  it("removes a symbol from the SQLite watchlist", async () => {
    await watchlistTool.execute("test", { action: "add", symbol: "AAPL" });

    const result = await watchlistTool.execute("test", {
      action: "remove",
      symbol: "AAPL",
    });

    expect(result.content[0].text).toContain("Removed");
    const check = await watchlistTool.execute("test", { action: "check" });
    expect(check.content[0].text.toLowerCase()).toContain("empty");
  });

  it("checks watchlist and reports current prices", async () => {
    await watchlistTool.execute("test", {
      action: "add",
      symbol: "AAPL",
      target_price: 200,
      stop_price: 150,
    });

    const result = await watchlistTool.execute("test", { action: "check" });
    expect(result.content[0].text).toContain("AAPL");
    expect(result.content[0].text).toContain("180");
  });

  it("flags when target price is hit", async () => {
    await watchlistTool.execute("test", {
      action: "add",
      symbol: "AAPL",
      target_price: 200,
      stop_price: 150,
    });
    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 210));

    const result = await watchlistTool.execute("test", { action: "check" });
    expect(result.content[0].text.toLowerCase()).toMatch(/target|alert|hit/);
    expect(result.content[0].text).toContain("Stop OK");
  });

  it("rejects zero-filled provider responses before saving", async () => {
    vi.mocked(getQuote).mockResolvedValue(quote("APL", 0, { volume: 0, week52High: 0, week52Low: 0 }));

    await expect(
      watchlistTool.execute("test", { action: "add", symbol: "APL" }),
    ).rejects.toThrow(/could not resolve/i);

    const result = await watchlistTool.execute("test", { action: "check" });
    expect(result.content[0].text.toLowerCase()).toContain("empty");
  });

  it("reports empty watchlist", async () => {
    const result = await watchlistTool.execute("test", { action: "check" });
    expect(result.content[0].text.toLowerCase()).toContain("empty");
  });
});

function quote(
  symbol: string,
  price: number,
  overrides: Partial<StockQuote> = {},
): StockQuote {
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
