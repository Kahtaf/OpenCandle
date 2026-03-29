import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cryptoPriceTool } from "../../../src/tools/market/crypto-price.js";
import { cache } from "../../../src/infra/cache.js";
import priceFixture from "../../fixtures/coingecko/bitcoin.json";

describe("get_crypto_price tool", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("has correct tool metadata", () => {
    expect(cryptoPriceTool.name).toBe("get_crypto_price");
    expect(cryptoPriceTool.label).toBe("Crypto Price");
  });

  it("returns formatted text with crypto data", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(priceFixture),
    });

    const result = await cryptoPriceTool.execute("call-1", { id: "bitcoin" });
    const text = (result.content[0] as any).text;
    expect(text).toContain("Bitcoin");
    expect(text).toContain("BTC");
    expect(text).toContain("69420.50");
    expect(text).toContain("ATH");
  });

  it("returns CryptoPrice in details", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(priceFixture),
    });

    const result = await cryptoPriceTool.execute("call-2", { id: "Bitcoin" });
    expect(result.details.id).toBe("bitcoin");
    expect(result.details.price).toBe(69420.50);
  });

  it("lowercases the coin id", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(priceFixture),
    });

    await cryptoPriceTool.execute("call-3", { id: "Bitcoin" });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/bitcoin?"),
      expect.anything(),
    );
  });
});
