import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { stockQuoteTool } from "../../../src/tools/market/stock-quote.js";
import { cache } from "../../../src/infra/cache.js";
import quoteFixture from "../../fixtures/yahoo/AAPL-quote.json";

describe("get_stock_quote tool", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("has correct tool metadata", () => {
    expect(stockQuoteTool.name).toBe("get_stock_quote");
    expect(stockQuoteTool.label).toBe("Stock Quote");
    expect(stockQuoteTool.description).toBeTruthy();
  });

  it("returns formatted text with price data", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(quoteFixture),
    });

    const result = await stockQuoteTool.execute("call-1", { symbol: "AAPL" });
    const text = result.content[0];
    expect(text.type).toBe("text");
    expect((text as any).text).toContain("AAPL");
    expect((text as any).text).toContain("178.72");
    expect((text as any).text).toContain("52W Range");
  });

  it("returns StockQuote in details", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(quoteFixture),
    });

    const result = await stockQuoteTool.execute("call-2", { symbol: "aapl" });
    expect(result.details.symbol).toBe("AAPL");
    expect(result.details.price).toBe(178.72);
  });

  it("uppercases the symbol", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(quoteFixture),
    });

    await stockQuoteTool.execute("call-3", { symbol: "aapl" });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("AAPL"),
      expect.anything(),
    );
  });
});
