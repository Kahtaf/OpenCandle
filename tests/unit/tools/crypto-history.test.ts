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

  it("includes risk metrics when enough crypto history is available", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(makeOhlcRows(45)),
    });

    const result = await cryptoHistoryTool.execute("call-1", { id: "bitcoin", days: 45 });
    const text = result.content[0].text;

    expect(text).toContain("Risk metrics");
    expect(text).toContain("Annualized Volatility");
    expect(text).toContain("Max Drawdown");
    expect(text).toContain("Value at Risk");
  });
});

function makeOhlcRows(count: number): number[][] {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index * 2 + Math.sin(index) * 5;
    return [start + index * 86_400_000, close - 1, close + 2, close - 3, close];
  });
}
