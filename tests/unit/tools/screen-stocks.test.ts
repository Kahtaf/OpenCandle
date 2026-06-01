import { beforeEach, describe, expect, it, vi } from "vitest";
import { Value } from "@sinclair/typebox/value";

vi.mock("../../../src/providers/tradingview.js", () => ({
  screenStocks: vi.fn(),
}));

vi.mock("../../../src/providers/wrap-provider.js", () => ({
  wrapProvider: vi.fn(),
}));

import { wrapProvider } from "../../../src/providers/wrap-provider.js";
import { screenStocks } from "../../../src/providers/tradingview.js";
import { screenStocksTool } from "../../../src/tools/market/screen-stocks.js";

describe("screen_stocks tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("has tool metadata and flat filter parameters", () => {
    expect(screenStocksTool.name).toBe("screen_stocks");
    expect(screenStocksTool.label).toBe("Stock Screener");
    expect(JSON.stringify(screenStocksTool.parameters)).toContain("filter");
    expect(JSON.stringify(screenStocksTool.parameters)).not.toContain("filter2");
  });

  it("returns formatted rows with the TradingView caveat", async () => {
    vi.mocked(wrapProvider).mockImplementation(async (_provider, fn) => ({
      status: "ok",
      data: await fn(),
      timestamp: "2026-06-01T00:00:00.000Z",
    }));
    vi.mocked(screenStocks).mockResolvedValue([
      {
        tvSymbol: "NASDAQ:AAPL",
        symbol: "AAPL",
        values: { close: 190.5, volume: 123456789, "RSI|60": 29.4 },
        sourceProvider: "tradingview",
        dataCaveat: "TradingView scanner data may be delayed about 15 minutes and comes from an unofficial endpoint.",
      },
    ]);

    const result = await screenStocksTool.execute("call-1", {
      market: "america",
      filter: [{ field: "RSI|60", op: "less", value: 30 }],
      sort: { field: "volume", direction: "desc" },
      columns: ["close", "volume", "RSI|60"],
      limit: 10,
    });

    expect(wrapProvider).toHaveBeenCalledWith("tradingview", expect.any(Function));
    expect(screenStocks).toHaveBeenCalledWith({
      market: "america",
      filter: [{ field: "RSI|60", op: "less", value: 30 }],
      sort: { field: "volume", direction: "desc" },
      columns: ["close", "volume", "RSI|60"],
      limit: 10,
    });
    expect(result.content[0]?.type).toBe("text");
    expect((result.content[0] as any).text).toContain("AAPL");
    expect((result.content[0] as any).text).toContain("TradingView");
    expect((result.content[0] as any).text).toContain("retrieved at 2026-06-01T00:00:00.000Z");
    expect((result.content[0] as any).text).toContain("candidates, not recommendations");
    expect(result.details).toHaveLength(1);
  });

  it("accepts natural comparison and field aliases from screener prompts", async () => {
    vi.mocked(wrapProvider).mockImplementation(async (_provider, fn) => ({
      status: "ok",
      data: await fn(),
      timestamp: "2026-06-01T00:00:00.000Z",
    }));
    vi.mocked(screenStocks).mockResolvedValue([]);
    const args = {
      market: "america",
      columns: ["name", "RSI|14D", "total_volume", "market_cap"],
      filter: [
        { field: "market_cap", op: "gte", value: "10B" },
        { field: "RSI|14D", op: "lt", value: 30 },
      ],
      sort: { field: "total_volume", direction: "desc" },
      limit: 10,
    };

    expect(Value.Check(screenStocksTool.parameters, args)).toBe(true);
    await screenStocksTool.execute("call-aliases", args as any);

    expect(screenStocks).toHaveBeenCalledWith({
      market: "america",
      columns: ["name", "RSI", "volume", "market_cap_basic"],
      filter: [
        { field: "market_cap_basic", op: "egreater", value: 10_000_000_000 },
        { field: "RSI", op: "less", value: 30 },
      ],
      sort: { field: "volume", direction: "desc" },
      limit: 10,
    });
  });

  it("normalizes percent-change aliases for mover screens", async () => {
    vi.mocked(wrapProvider).mockImplementation(async (_provider, fn) => ({
      status: "ok",
      data: await fn(),
      timestamp: "2026-06-01T00:00:00.000Z",
    }));
    vi.mocked(screenStocks).mockResolvedValue([]);

    await screenStocksTool.execute("call-movers", {
      columns: ["change_percent", "market_cap_basic"],
      filter: [{ field: "change_percent", op: "<", value: "-3" }],
      sort: { field: "change_percent", direction: "asc" },
      limit: 5,
    } as any);

    expect(screenStocks).toHaveBeenCalledWith({
      market: undefined,
      columns: ["change", "market_cap_basic"],
      filter: [{ field: "change", op: "less", value: -3 }],
      sort: { field: "change", direction: "asc" },
      limit: 5,
    });
  });

  it("labels stale cached TradingView screens with the cache timestamp", async () => {
    vi.mocked(wrapProvider).mockResolvedValue({
      status: "ok",
      data: [
        {
          tvSymbol: "NASDAQ:AAPL",
          symbol: "AAPL",
          values: { close: 190.5 },
          sourceProvider: "tradingview",
          dataCaveat: "TradingView scanner data may be delayed about 15 minutes and comes from an unofficial endpoint.",
        },
      ],
      timestamp: "2026-06-01T00:00:00.000Z",
      stale: true,
    });

    const result = await screenStocksTool.execute("call-stale", { market: "america" });

    expect((result.content[0] as any).text).toContain("cached TradingView screen from 2026-06-01T00:00:00.000Z");
  });

  it("returns structured unavailable text without fabricating rows", async () => {
    vi.mocked(wrapProvider).mockResolvedValue({
      status: "unavailable",
      reason: "HTTP 429 Too Many Requests",
      provider: "tradingview",
    });

    const result = await screenStocksTool.execute("call-2", { market: "america" });

    expect((result.content[0] as any).text).toContain("screening unavailable");
    expect((result.content[0] as any).text).toContain("Manual fallback");
    expect((result.content[0] as any).text).not.toContain("RSI < 30");
    expect(result.details).toEqual([]);
  });
});
