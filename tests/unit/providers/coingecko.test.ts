import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getCryptoPrice, getCryptoHistory } from "../../../src/providers/coingecko.js";
import { cache } from "../../../src/infra/cache.js";
import priceFixture from "../../fixtures/coingecko/bitcoin.json";
import ohlcFixture from "../../fixtures/coingecko/bitcoin-ohlc.json";

describe("coingecko provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("getCryptoPrice", () => {
    it("returns CryptoPrice for valid coin id", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(priceFixture),
      });

      const crypto = await getCryptoPrice("bitcoin");
      expect(crypto.id).toBe("bitcoin");
      expect(crypto.symbol).toBe("btc");
      expect(crypto.name).toBe("Bitcoin");
      expect(crypto.price).toBe(69420.50);
      expect(crypto.changePercent24h).toBe(1.81);
      expect(crypto.marketCap).toBe(1362000000000);
      expect(crypto.ath).toBe(73750.00);
      expect(crypto.circulatingSupply).toBe(19625000);
      expect(crypto.totalSupply).toBe(21000000);
    });

    it("caches results", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(priceFixture),
      });

      await getCryptoPrice("bitcoin");
      await getCryptoPrice("bitcoin");
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("getCryptoHistory", () => {
    it("returns OHLCV array for valid coin", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(ohlcFixture),
      });

      const bars = await getCryptoHistory("bitcoin", 7);
      expect(bars).toHaveLength(4);
      expect(bars[0].open).toBe(67500.00);
      expect(bars[3].close).toBe(69420.50);
      expect(bars[0].volume).toBe(0); // OHLC endpoint doesn't include volume
    });

    it("caches history results", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(ohlcFixture),
      });

      await getCryptoHistory("bitcoin", 7);
      await getCryptoHistory("bitcoin", 7);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });
});
