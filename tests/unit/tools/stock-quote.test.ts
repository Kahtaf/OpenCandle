import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { stockQuoteTool } from "../../../src/tools/market/stock-quote.js";
import quoteFixture from "../../fixtures/yahoo/AAPL-quote.json";
import invalidQuoteFixture from "../../fixtures/yahoo/XXFAKEXX-quote.json";

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
    if (text.type !== "text") throw new Error("expected text content");
    expect(text.text).toContain("AAPL");
    expect(text.text).toContain("178.72");
    expect(text.text).toContain("52W Range");
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
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("AAPL"), expect.anything());
  });

  it("surfaces invalid sparse quote responses as unavailable without zero-filled details", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(invalidQuoteFixture),
    });

    const result = await stockQuoteTool.execute("call-4", { symbol: "XXFAKEXX" });

    expect(result.content[0].type).toBe("text");
    const text = result.content[0];
    if (text.type !== "text") throw new Error("expected text content");
    expect(text.text).toContain("Stock quote unavailable for XXFAKEXX");
    expect(text.text).toContain("Invalid symbol XXFAKEXX for yahoo");
    expect(result.details).toBeNull();
  });
});
