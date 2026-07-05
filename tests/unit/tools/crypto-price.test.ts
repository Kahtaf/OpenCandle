import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { cryptoPriceTool } from "../../../src/tools/market/crypto-price.js";
import type { CryptoPrice } from "../../../src/types/market.js";
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
    expect(result.details.price).toBe(69420.5);
    expect(result.details.freshness.providerDataAt).toBe("2026-07-03T18:50:00.000Z");
  });

  it("discloses stale cached crypto prices", async () => {
    const staleCrypto: CryptoPrice = {
      id: "bitcoin",
      symbol: "btc",
      name: "Bitcoin",
      price: 69000,
      change24h: 1,
      changePercent24h: 0.1,
      marketCap: 1_000_000,
      volume24h: 2_000_000,
      high24h: 70000,
      low24h: 68000,
      ath: 73750,
      athDate: "2024-03-14T07:10:36.635Z",
      circulatingSupply: 19_625_000,
      totalSupply: 21_000_000,
      timestamp: Date.now(),
    };
    cache.set("coingecko:price:bitcoin", staleCrypto, -1);
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await cryptoPriceTool.execute("call-stale", { id: "bitcoin" });
    const text = (result.content[0] as any).text;

    expect(text).toContain("Using cached data from");
    expect(result.details.freshness.cacheStatus).toBe("stale");
  });

  it("lowercases the coin id", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(priceFixture),
    });

    await cryptoPriceTool.execute("call-3", { id: "Bitcoin" });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/bitcoin?"), expect.anything());
  });
});
