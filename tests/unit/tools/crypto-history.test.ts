import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { cryptoHistoryTool } from "../../../src/tools/market/crypto-history.js";

describe("get_crypto_history tool", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("shows raw candles and source caveats without stock-daily risk metrics", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeOhlcRows(45)),
    });

    const result = await cryptoHistoryTool.execute("call-1", { id: "bitcoin", days: 45 });
    const text = result.content[0].text;

    expect(text).toContain("Candle spacing");
    expect(text).toContain("volume is unavailable");
    expect(text).not.toMatch(/Annualized|Sharpe|Value at Risk/);
    expect(result.details).toHaveLength(45);
  });
});

function makeOhlcRows(count: number): number[][] {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 2 + Math.sin(index) * 5;
    return [start + index * 86_400_000, close - 1, close + 2, close - 3, close];
  });
}
