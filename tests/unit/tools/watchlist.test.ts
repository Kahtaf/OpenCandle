import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { watchlistTool } from "../../../src/tools/portfolio/watchlist.js";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import { httpGet } from "../../../src/infra/http-client.js";
import { cache } from "../../../src/infra/cache.js";
import type { StockQuote } from "../../../src/types/market.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
}));
vi.mock("../../../src/infra/http-client.js", () => ({
  httpGet: vi.fn(),
}));

describe("watchlistTool", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  let openCandleHome: string;

  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
    cache.consumeStaleFlag();
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-watchlist-test-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 180));
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
      thesis: "Services growth offsets hardware cycles",
      notes: "Core watch",
      tags: ["mega-cap", "quality"],
    });

    expect(result.content[0].text).toContain("AAPL");
    expect(result.details).toMatchObject({
      symbol: "AAPL",
      targetPrice: 200,
      stopPrice: 150,
      thesis: "Services growth offsets hardware cycles",
      notes: "Core watch",
      tags: ["mega-cap", "quality"],
    });
    expect(existsSync(join(openCandleHome, "state.db"))).toBe(true);
    expect(existsSync(join(openCandleHome, "watchlist.json"))).toBe(false);
  });

  it("ignores pre-existing watchlist.json as a state source", async () => {
    writeFileSync(join(openCandleHome, "watchlist.json"), JSON.stringify([{ symbol: "MSFT" }]));

    const result = await watchlistTool.execute("test", { action: "check" });

    expect(result.content[0].text.toLowerCase()).toContain("empty");
    expect(result.content[0].text).not.toContain("MSFT");
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

  it("treats zero-filled quote data as unavailable during watchlist checks", async () => {
    await watchlistTool.execute("test", {
      action: "add",
      symbol: "AAPL",
      target_price: 200,
    });
    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 0, {
      volume: 0,
      week52High: 0,
      week52Low: 0,
    }));

    const result = await watchlistTool.execute("test", { action: "check" });

    expect(result.content[0].text).toContain("UNAVAILABLE: Yahoo returned no valid market data.");
    expect(result.details?.items[0]).toMatchObject({
      symbol: "AAPL",
      currentPrice: null,
      alerts: ["UNAVAILABLE: Yahoo returned no valid market data."],
    });
  });

  it("treats stale quote data as unavailable during watchlist checks", async () => {
    await watchlistTool.execute("test", {
      action: "add",
      symbol: "AAPL",
      target_price: 200,
    });
    cache.set("test-stale-watchlist-quote", quote("AAPL", 210), -1);
    cache.getStale("test-stale-watchlist-quote", 60_000);
    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 210));

    const result = await watchlistTool.execute("test", { action: "check" });

    expect(result.content[0].text).toContain("UNAVAILABLE: provider returned stale market data");
    expect(result.content[0].text).not.toContain("TARGET HIT");
    expect(result.details?.items[0]).toMatchObject({
      symbol: "AAPL",
      currentPrice: null,
      alerts: ["UNAVAILABLE: provider returned stale market data"],
    });
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

  it("returns candidate matches for an unverified add without mutating the watchlist", async () => {
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

    const result = await watchlistTool.execute("test", {
      action: "add",
      symbol: "APL",
    });

    expect(result.content[0].text).toContain("Could not verify APL");
    expect(result.details).toMatchObject({
      status: "needs_selection",
      query: "APL",
      candidates: [
        expect.objectContaining({ symbol: "AAPL", name: "Apple Inc." }),
      ],
    });

    const check = await watchlistTool.execute("test", { action: "check" });
    expect(check.content[0].text.toLowerCase()).toContain("empty");
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
