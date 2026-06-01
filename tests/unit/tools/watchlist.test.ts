import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { watchlistTool } from "../../../src/tools/portfolio/watchlist.js";
import * as fs from "node:fs";
import { join } from "node:path";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import { getQuotes } from "../../../src/providers/tradingview.js";

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
}));

vi.mock("../../../src/providers/tradingview.js", () => ({
  getQuotes: vi.fn(),
}));

describe("watchlistTool", () => {
  const originalEnv = process.env.OPENCANDLE_HOME;
  const openCandleHome = "/tmp/opencandle-watchlist-test";

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENCANDLE_HOME = openCandleHome;
    vi.mocked(fs.existsSync).mockReturnValue(false);
    vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
    vi.mocked(fs.readFileSync).mockReturnValue("[]");
    vi.mocked(fs.writeFileSync).mockImplementation(() => {});
    vi.mocked(getQuote).mockResolvedValue({ price: 180 } as any);
    vi.mocked(getQuotes).mockResolvedValue([]);
  });

  afterEach(() => {
    if (originalEnv == null) {
      delete process.env.OPENCANDLE_HOME;
    } else {
      process.env.OPENCANDLE_HOME = originalEnv;
    }
    vi.clearAllMocks();
  });

  it("has correct tool metadata", () => {
    expect(watchlistTool.name).toBe("manage_watchlist");
    expect(watchlistTool.label).toBeTruthy();
    expect(watchlistTool.description).toBeTruthy();
  });

  it("adds a symbol to the watchlist", async () => {
    const result = await watchlistTool.execute("test", {
      action: "add",
      symbol: "AAPL",
      target_price: 200,
      stop_price: 150,
    });

    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(vi.mocked(fs.writeFileSync).mock.calls[0][0]).toBe(
      join(openCandleHome, "watchlist.json"),
    );
    const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
    expect(written).toHaveLength(1);
    expect(written[0].symbol).toBe("AAPL");
    expect(written[0].targetPrice).toBe(200);
    expect(written[0].stopPrice).toBe(150);
    expect(result.content[0].text).toContain("AAPL");
  });

  it("removes a symbol from the watchlist", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([{ symbol: "AAPL", addedAt: "2024-01-01" }]),
    );

    const result = await watchlistTool.execute("test", {
      action: "remove",
      symbol: "AAPL",
    });

    const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
    expect(written).toHaveLength(0);
    expect(result.content[0].text).toContain("Removed");
  });

  it("checks watchlist and reports current prices", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([
        { symbol: "AAPL", addedAt: "2024-01-01", targetPrice: 200, stopPrice: 150 },
      ]),
    );

    const result = await watchlistTool.execute("test", { action: "check" });
    expect(result.content[0].text).toContain("AAPL");
    expect(result.content[0].text).toContain("180"); // mocked price
  });

  it("checks equity watchlist symbols through a TradingView batch and fills suffix symbols with Yahoo", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([
        { symbol: "AAPL", addedAt: "2024-01-01", targetPrice: 200 },
        { symbol: "BTC-USD", addedAt: "2024-01-01" },
      ]),
    );
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
        dataCaveat: "TradingView scanner data may be delayed about 15 minutes and comes from an unofficial endpoint.",
      },
    ]);
    vi.mocked(getQuote).mockResolvedValue({ price: 68000 } as any);

    const result = await watchlistTool.execute("test", { action: "check" });

    expect(getQuotes).toHaveBeenCalledWith(["AAPL"]);
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(getQuote).toHaveBeenCalledWith("BTC-USD");
    expect(result.content[0].text).toContain("AAPL: $190.50");
    expect(result.content[0].text).toContain("BTC-USD: $68000.00");
    expect(result.content[0].text).toContain("TradingView scanner data may be delayed");
    expect((result.details as any).items).toEqual([
      expect.objectContaining({ symbol: "AAPL", sourceProvider: "tradingview", dataCaveat: expect.stringContaining("TradingView") }),
      expect.objectContaining({ symbol: "BTC-USD", sourceProvider: "yahoo", dataCaveat: undefined }),
    ]);
  });

  it("fills missing TradingView rows through Yahoo without discarding successful rows", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([
        { symbol: "AAPL", addedAt: "2024-01-01" },
        { symbol: "UNKNOWN", addedAt: "2024-01-01" },
      ]),
    );
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
        dataCaveat: "TradingView scanner data may be delayed about 15 minutes and comes from an unofficial endpoint.",
      },
    ]);
    vi.mocked(getQuote).mockResolvedValue({ price: 12.34 } as any);

    const result = await watchlistTool.execute("test", { action: "check" });

    expect(getQuotes).toHaveBeenCalledWith(["AAPL", "UNKNOWN"]);
    expect(getQuote).toHaveBeenCalledTimes(1);
    expect(getQuote).toHaveBeenCalledWith("UNKNOWN");
    expect((result.details as any).items).toEqual([
      expect.objectContaining({ symbol: "AAPL", currentPrice: 190.5, sourceProvider: "tradingview" }),
      expect.objectContaining({ symbol: "UNKNOWN", currentPrice: 12.34, sourceProvider: "yahoo" }),
    ]);
  });

  it("falls back to Yahoo for the whole list when TradingView is unavailable", async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([
        { symbol: "AAPL", addedAt: "2024-01-01" },
        { symbol: "MSFT", addedAt: "2024-01-01" },
      ]),
    );
    vi.mocked(getQuotes).mockRejectedValue(new Error("HTTP 429 Too Many Requests"));
    vi.mocked(getQuote)
      .mockResolvedValueOnce({ price: 190 } as any)
      .mockResolvedValueOnce({ price: 420 } as any);

    const result = await watchlistTool.execute("test", { action: "check" });

    expect(getQuotes).toHaveBeenCalledWith(["AAPL", "MSFT"]);
    expect(getQuote).toHaveBeenCalledTimes(2);
    expect((result.details as any).items).toEqual([
      expect.objectContaining({ symbol: "AAPL", currentPrice: 190, sourceProvider: "yahoo" }),
      expect.objectContaining({ symbol: "MSFT", currentPrice: 420, sourceProvider: "yahoo" }),
    ]);
  });

  it("flags when target price is hit", async () => {
    vi.mocked(getQuote).mockResolvedValue({ price: 210 } as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([
        { symbol: "AAPL", addedAt: "2024-01-01", targetPrice: 200, stopPrice: 150 },
      ]),
    );

    const result = await watchlistTool.execute("test", { action: "check" });
    expect(result.content[0].text.toLowerCase()).toMatch(/target|alert|hit/);
    expect(result.content[0].text).toContain("Stop OK");
  });

  it("flags when stop price is hit", async () => {
    vi.mocked(getQuote).mockResolvedValue({ price: 140 } as any);
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify([
        { symbol: "AAPL", addedAt: "2024-01-01", stopPrice: 150 },
      ]),
    );

    const result = await watchlistTool.execute("test", { action: "check" });
    expect(result.content[0].text.toLowerCase()).toMatch(/stop|alert|below/);
  });

  it("reports empty watchlist", async () => {
    const result = await watchlistTool.execute("test", { action: "check" });
    expect(result.content[0].text.toLowerCase()).toContain("empty");
  });
});
