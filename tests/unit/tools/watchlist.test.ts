import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { httpGet } from "../../../src/infra/http-client.js";
import { getQuotes } from "../../../src/providers/tradingview.js";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import { watchlistTool } from "../../../src/tools/portfolio/watchlist.js";
import type { StockQuote } from "../../../src/types/market.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
}));
vi.mock("../../../src/providers/tradingview.js", () => ({
  getQuotes: vi.fn(),
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
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-watchlist-test-"));
    process.env.OPENCANDLE_HOME = openCandleHome;
    vi.mocked(getQuote).mockImplementation(async (symbol: string) =>
      quote(symbol, symbol === "BTC-USD" ? 68_000 : 180),
    );
    vi.mocked(getQuotes).mockResolvedValue([]);
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

  it("has correct tool metadata", () => {
    expect(watchlistTool.name).toBe("manage_watchlist");
    expect(watchlistTool.label).toBeTruthy();
    expect(watchlistTool.description).toBeTruthy();
  });

  it("adds a resolved symbol to SQLite without creating watchlist.json", async () => {
    const result = await watchlistTool.execute("test", {
      action: "add",
      symbol: "AAPL",
    });

    expect(result.content[0].text).toContain("AAPL");
    expect(result.details).toMatchObject({
      symbol: "AAPL",
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
    });
    const result = await watchlistTool.execute("test", {
      action: "add",
      symbol: "AAPL",
    });

    expect(result.details).toMatchObject({
      symbol: "AAPL",
    });

    const check = await watchlistTool.execute("test", { action: "check" });
    expect(check.content[0].text.match(/AAPL/g)).toHaveLength(1);
  });

  it("removes a symbol from the SQLite watchlist", async () => {
    const added = await watchlistTool.execute("test", { action: "add", symbol: "AAPL" });

    const result = await watchlistTool.execute("test", {
      action: "remove",
      item_id: (added.details as { id: number }).id,
    });

    expect(result.content[0].text).toContain("Removed");
    const check = await watchlistTool.execute("test", { action: "check" });
    expect(check.content[0].text.toLowerCase()).toContain("empty");
  });

  it("checks watchlist and reports current prices", async () => {
    await watchlistTool.execute("test", {
      action: "add",
      symbol: "AAPL",
    });

    const result = await watchlistTool.execute("test", { action: "check" });
    expect(result.content[0].text).toContain("AAPL");
    expect(result.content[0].text).toContain("180");
  });

  it("creates and checks separate named watchlists", async () => {
    const created = await watchlistTool.execute("test", {
      action: "create",
      watchlist_name: "MAG7",
    });
    expect(created.content[0].text).toContain("MAG7");

    await watchlistTool.execute("test", { action: "add", symbol: "AAPL", watchlist_name: "MAG7" });
    await watchlistTool.execute("test", { action: "add", symbol: "MSFT", watchlist_name: "MAG7" });
    await watchlistTool.execute("test", { action: "create", watchlist_name: "ETFs" });
    await watchlistTool.execute("test", { action: "add", symbol: "VOO", watchlist_name: "ETFs" });

    const defaultList = await watchlistTool.execute("test", { action: "check" });
    const mag7 = await watchlistTool.execute("test", { action: "check", watchlist_name: "MAG7" });
    const etfs = await watchlistTool.execute("test", { action: "check", watchlist_name: "ETFs" });

    expect(defaultList.content[0].text).toContain("Default is empty");
    expect(mag7.content[0].text).toContain("**MAG7**");
    expect(mag7.content[0].text).toContain("AAPL");
    expect(mag7.content[0].text).toContain("MSFT");
    expect(mag7.content[0].text).not.toContain("VOO");
    expect(etfs.content[0].text).toContain("VOO");
    expect(etfs.content[0].text).not.toContain("AAPL");
  });

  it("renames a named watchlist for TUI and tool callers", async () => {
    await watchlistTool.execute("test", { action: "create", watchlist_name: "Growth" });
    await watchlistTool.execute("test", {
      action: "add",
      symbol: "NVDA",
      watchlist_name: "Growth",
    });

    const renamed = await watchlistTool.execute("test", {
      action: "rename",
      watchlist_name: "Growth",
      new_watchlist_name: "AI",
    });
    const check = await watchlistTool.execute("test", { action: "check", watchlist_name: "AI" });

    expect(renamed.content[0].text).toContain("Renamed Growth to AI");
    expect(renamed.details).toMatchObject({ name: "AI" });
    expect(check.content[0].text).toContain("**AI**");
    expect(check.content[0].text).toContain("NVDA");
    await expect(
      watchlistTool.execute("test", { action: "check", watchlist_name: "Growth" }),
    ).rejects.toThrow("watchlist Growth not found");
  });

  it("resolves an explicitly named Default watchlist after the original default is renamed", async () => {
    await watchlistTool.execute("test", {
      action: "rename",
      new_watchlist_name: "Growth",
    });
    await watchlistTool.execute("test", { action: "create", watchlist_name: "Default" });
    await watchlistTool.execute("test", {
      action: "add",
      watchlist_name: "Default",
      symbol: "AAPL",
    });

    const active = await watchlistTool.execute("test", { action: "check" });
    const namedDefault = await watchlistTool.execute("test", {
      action: "check",
      watchlist_name: "Default",
    });
    expect(active.content[0].text).toContain("Growth is empty");
    expect(namedDefault.content[0].text).toContain("**Default**");
    expect(namedDefault.content[0].text).toContain("AAPL");
  });

  it("does not create a missing watchlist while reading or renaming", async () => {
    await expect(
      watchlistTool.execute("test", {
        action: "rename",
        watchlist_name: "Missing",
        new_watchlist_name: "AI",
      }),
    ).rejects.toThrow("watchlist Missing not found");

    await expect(
      watchlistTool.execute("test", {
        action: "check",
        watchlist_name: "Missing",
      }),
    ).rejects.toThrow("watchlist Missing not found");
  });

  it("deletes a named watchlist through the tool and selects another list", async () => {
    await watchlistTool.execute("test", { action: "create", watchlist_name: "Growth" });
    const deleted = await watchlistTool.execute("test", {
      action: "delete",
      watchlist_name: "Default",
    });

    expect(deleted.content[0].text).toContain("Deleted Default");
    expect(deleted.content[0].text).toContain("Growth is now active");
    expect(deleted.details).toMatchObject({ name: "Growth", isDefault: true });
  });

  it("removes a symbol from only the selected named watchlist", async () => {
    const mag7Item = await watchlistTool.execute("test", {
      action: "add",
      symbol: "AAPL",
      watchlist_name: "MAG7",
    });
    await watchlistTool.execute("test", { action: "add", symbol: "AAPL", watchlist_name: "ETFs" });

    const removed = await watchlistTool.execute("test", {
      action: "remove",
      item_id: (mag7Item.details as { id: number }).id,
      watchlist_name: "MAG7",
    });
    const mag7 = await watchlistTool.execute("test", { action: "check", watchlist_name: "MAG7" });
    const etfs = await watchlistTool.execute("test", { action: "check", watchlist_name: "ETFs" });

    expect(removed.content[0].text).toContain("Removed AAPL from MAG7");
    expect(mag7.content[0].text).toContain("MAG7 is empty");
    expect(etfs.content[0].text).toContain("AAPL");
  });

  it("requires a stable item id for removal", async () => {
    await watchlistTool.execute("test", { action: "add", symbol: "AAPL" });

    await expect(
      watchlistTool.execute("test", { action: "remove", symbol: "AAPL" }),
    ).rejects.toThrow("item_id is required");
  });

  it("checks equity watchlist symbols through a TradingView batch and fills suffix symbols with Yahoo", async () => {
    await watchlistTool.execute("test", { action: "add", symbol: "AAPL" });
    await watchlistTool.execute("test", { action: "add", symbol: "BTC-USD" });
    vi.mocked(getQuote).mockClear();
    vi.mocked(getQuotes).mockResolvedValue([
      {
        requestedSymbol: "AAPL",
        tvSymbol: "NASDAQ:AAPL",
        symbol: "AAPL",
        price: 190.5,
        change: 2.35,
        changePercent: 1.25,
        volume: 123,
        sourceProvider: "tradingview",
        dataCaveat:
          "TradingView scanner data may be delayed about 15 minutes and comes from an unofficial endpoint.",
      },
    ]);
    vi.mocked(getQuote).mockResolvedValue(quote("BTC-USD", 68_000));

    const result = await watchlistTool.execute("test", { action: "check" });

    expect(getQuotes).toHaveBeenCalledWith(["AAPL"]);
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(getQuote).toHaveBeenCalledWith("BTC-USD");
    expect(result.content[0].text).toMatch(/AAPL \[item \d+\]: \$190\.50/);
    expect(result.content[0].text).toMatch(/BTC-USD \[item \d+\]: \$68000\.00/);
    expect(result.content[0].text).toContain("TradingView scanner data may be delayed");
    expect(result.details?.items).toEqual([
      expect.objectContaining({
        symbol: "AAPL",
        sourceProvider: "tradingview",
        dataCaveat: expect.stringContaining("TradingView"),
      }),
      expect.objectContaining({
        symbol: "BTC-USD",
        sourceProvider: "yahoo",
        dataCaveat: undefined,
      }),
    ]);
  });

  it("checks 100+ equity symbols with one TradingView batch call", async () => {
    const symbols = Array.from({ length: 101 }, (_, index) => `SYM${index}`);
    for (const symbol of symbols) {
      await watchlistTool.execute("test", { action: "add", symbol });
    }
    vi.mocked(getQuote).mockClear();
    vi.mocked(getQuotes).mockResolvedValue(
      symbols.map((symbol, index) => ({
        requestedSymbol: symbol,
        tvSymbol: `NASDAQ:${symbol}`,
        symbol,
        price: 100 + index,
        change: 0,
        changePercent: 0,
        volume: 1000,
        sourceProvider: "tradingview",
        dataCaveat:
          "TradingView scanner data may be delayed about 15 minutes and comes from an unofficial endpoint.",
      })),
    );

    const result = await watchlistTool.execute("test", { action: "check" });

    expect(getQuotes).toHaveBeenCalledTimes(1);
    expect(getQuotes).toHaveBeenCalledWith([...symbols].sort());
    expect(getQuote).not.toHaveBeenCalled();
    expect(result.details?.items).toHaveLength(101);
    expect(result.details?.items).toContainEqual(
      expect.objectContaining({
        symbol: "SYM100",
        currentPrice: 200,
        sourceProvider: "tradingview",
      }),
    );
  });

  it("labels stale TradingView watchlist quotes", async () => {
    await watchlistTool.execute("test", { action: "add", symbol: "AAPL" });
    vi.mocked(getQuotes).mockResolvedValue([
      {
        requestedSymbol: "AAPL",
        tvSymbol: "NASDAQ:AAPL",
        symbol: "AAPL",
        price: 190.5,
        change: 2.35,
        changePercent: 1.25,
        volume: 123,
        sourceProvider: "tradingview",
        dataCaveat:
          "TradingView scanner data may be delayed about 15 minutes and comes from an unofficial endpoint.",
      },
    ]);
    cache.set("test:stale-flag", { ok: true }, -1);
    vi.mocked(getQuotes).mockImplementation(async () => {
      cache.getStale("test:stale-flag", 60_000);
      return [
        {
          requestedSymbol: "AAPL",
          tvSymbol: "NASDAQ:AAPL",
          symbol: "AAPL",
          price: 190.5,
          change: 2.35,
          changePercent: 1.25,
          volume: 123,
          sourceProvider: "tradingview",
          dataCaveat:
            "TradingView scanner data may be delayed about 15 minutes and comes from an unofficial endpoint.",
        },
      ];
    });

    const result = await watchlistTool.execute("test", { action: "check" });

    expect(result.content[0].text).toContain("cached TradingView data from");
    expect(result.details?.items[0].dataCaveat).toContain("cached TradingView data from");
  });

  it("fills missing TradingView rows through Yahoo without discarding successful rows", async () => {
    await watchlistTool.execute("test", { action: "add", symbol: "AAPL" });
    await watchlistTool.execute("test", { action: "add", symbol: "UNKNOWN" });
    vi.mocked(getQuote).mockClear();
    vi.mocked(getQuotes).mockResolvedValue([
      {
        requestedSymbol: "AAPL",
        tvSymbol: "NASDAQ:AAPL",
        symbol: "AAPL",
        price: 190.5,
        change: 2.35,
        changePercent: 1.25,
        volume: 123,
        sourceProvider: "tradingview",
        dataCaveat:
          "TradingView scanner data may be delayed about 15 minutes and comes from an unofficial endpoint.",
      },
    ]);
    vi.mocked(getQuote).mockResolvedValue(quote("UNKNOWN", 12.34));

    const result = await watchlistTool.execute("test", { action: "check" });

    expect(getQuotes).toHaveBeenCalledWith(["AAPL", "UNKNOWN"]);
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(getQuote).toHaveBeenCalledWith("UNKNOWN");
    expect(result.details?.items).toEqual([
      expect.objectContaining({
        symbol: "AAPL",
        currentPrice: 190.5,
        sourceProvider: "tradingview",
      }),
      expect.objectContaining({ symbol: "UNKNOWN", currentPrice: 12.34, sourceProvider: "yahoo" }),
    ]);
  });

  it("falls back to Yahoo for the whole list when TradingView is unavailable", async () => {
    await watchlistTool.execute("test", { action: "add", symbol: "AAPL" });
    await watchlistTool.execute("test", { action: "add", symbol: "MSFT" });
    vi.mocked(getQuote).mockClear();
    vi.mocked(getQuotes).mockRejectedValue(new Error("HTTP 429 Too Many Requests"));
    vi.mocked(getQuote)
      .mockResolvedValueOnce(quote("AAPL", 190))
      .mockResolvedValueOnce(quote("MSFT", 420));

    const result = await watchlistTool.execute("test", { action: "check" });

    expect(getQuotes).toHaveBeenCalledWith(["AAPL", "MSFT"]);
    expect(getQuote).toHaveBeenCalledTimes(2);
    expect(result.details?.items).toEqual([
      expect.objectContaining({ symbol: "AAPL", currentPrice: 190, sourceProvider: "yahoo" }),
      expect.objectContaining({ symbol: "MSFT", currentPrice: 420, sourceProvider: "yahoo" }),
    ]);
  });

  it("treats zero-filled quote data as unavailable during watchlist checks", async () => {
    await watchlistTool.execute("test", {
      action: "add",
      symbol: "AAPL",
    });
    vi.mocked(getQuotes).mockResolvedValue([]);
    vi.mocked(getQuote).mockResolvedValue(
      quote("AAPL", 0, {
        volume: 0,
        week52High: 0,
        week52Low: 0,
      }),
    );

    const result = await watchlistTool.execute("test", { action: "check" });

    expect(result.content[0].text).toContain("UNAVAILABLE: Yahoo returned no valid market data.");
    expect(result.details?.items[0]).toMatchObject({
      symbol: "AAPL",
      currentPrice: null,
      statuses: ["UNAVAILABLE: Yahoo returned no valid market data."],
    });
  });

  it("treats stale quote data as unavailable during watchlist checks", async () => {
    await watchlistTool.execute("test", {
      action: "add",
      symbol: "SHOP.TO",
    });
    vi.mocked(getQuotes).mockResolvedValue([]);
    cache.set("test-stale-watchlist-quote", quote("SHOP.TO", 210), -1);
    vi.mocked(getQuote).mockImplementation(async () => {
      cache.getStale("test-stale-watchlist-quote", 60_000);
      return quote("SHOP.TO", 210);
    });

    const result = await watchlistTool.execute("test", { action: "check" });

    expect(result.content[0].text).toContain("UNAVAILABLE: provider returned stale market data");
    expect(result.details?.items[0]).toMatchObject({
      symbol: "SHOP.TO",
      currentPrice: null,
      statuses: ["UNAVAILABLE: provider returned stale market data"],
    });
  });

  it("rejects zero-filled provider responses before saving", async () => {
    vi.mocked(getQuote).mockResolvedValue(
      quote("APL", 0, { volume: 0, week52High: 0, week52Low: 0 }),
    );

    await expect(watchlistTool.execute("test", { action: "add", symbol: "APL" })).rejects.toThrow(
      /could not resolve/i,
    );

    const result = await watchlistTool.execute("test", { action: "check" });
    expect(result.content[0].text.toLowerCase()).toContain("empty");
  });

  it("returns candidate matches for an unverified add without mutating the watchlist", async () => {
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

    const result = await watchlistTool.execute("test", {
      action: "add",
      symbol: "APL",
    });

    expect(result.content[0].text).toContain("Could not verify APL");
    expect(result.details).toMatchObject({
      status: "needs_selection",
      query: "APL",
      candidates: [expect.objectContaining({ symbol: "AAPL", name: "Apple Inc." })],
    });

    const check = await watchlistTool.execute("test", { action: "check" });
    expect(check.content[0].text.toLowerCase()).toContain("empty");
  });

  it("reports empty watchlist", async () => {
    const result = await watchlistTool.execute("test", { action: "check" });
    expect(result.content[0].text.toLowerCase()).toContain("empty");
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
