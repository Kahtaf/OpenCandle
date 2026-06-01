import { beforeEach, describe, expect, it, vi } from "vitest";

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
    expect(result.details).toHaveLength(1);
  });

  it("returns structured unavailable text without fabricating rows", async () => {
    vi.mocked(wrapProvider).mockResolvedValue({
      status: "unavailable",
      reason: "HTTP 429 Too Many Requests",
      provider: "tradingview",
    });

    const result = await screenStocksTool.execute("call-2", { market: "america" });

    expect((result.content[0] as any).text).toContain("screening unavailable");
    expect(result.details).toEqual([]);
  });
});
