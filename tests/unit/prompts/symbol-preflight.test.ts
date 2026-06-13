import { describe, expect, it, vi } from "vitest";
import type { InstrumentCandidate } from "../../../src/market-state/resolve.js";
import {
  formatPreflightDropAnnotation,
  preflightSymbols,
  type SymbolValidationCache,
} from "../../../src/prompts/symbol-preflight.js";

function candidate(symbol: string): InstrumentCandidate {
  return {
    symbol,
    name: symbol,
    quoteType: "EQUITY",
    assetType: "equity",
    exchange: "NMS",
    provider: "yahoo",
    score: 1,
  };
}

describe("preflightSymbols", () => {
  it("keeps symbols with exact resolver search matches", async () => {
    const search = vi.fn(async (query: string) => [candidate(query.toUpperCase())]);

    const result = await preflightSymbols(["AAPL", "MSFT"], { search });

    expect(result.valid).toEqual(["AAPL", "MSFT"]);
    expect(result.dropped).toEqual([]);
  });

  it("drops symbols without exact resolver search matches", async () => {
    const search = vi.fn(async (query: string) =>
      query === "AAPL" ? [candidate("AAPL")] : [candidate("FAKE")],
    );

    const result = await preflightSymbols(["AAPL", "XXFAKEXX"], { search });

    expect(result.valid).toEqual(["AAPL"]);
    expect(result.dropped).toEqual([
      {
        symbol: "XXFAKEXX",
        reason: "no matching ticker found via resolver search",
      },
    ]);
  });

  it("uses a per-turn cache for repeated validations", async () => {
    const cache: SymbolValidationCache = new Map();
    const search = vi.fn(async (query: string) => [candidate(query.toUpperCase())]);

    await preflightSymbols(["AAPL"], { cache, search });
    await preflightSymbols(["AAPL"], { cache, search });

    expect(search).toHaveBeenCalledTimes(1);
  });

  it("keeps symbols when resolver search is temporarily unavailable", async () => {
    const search = vi.fn(async () => {
      throw new Error("rate limited");
    });

    const result = await preflightSymbols(["AAPL", "MSFT"], { search });

    expect(result.valid).toEqual(["AAPL", "MSFT"]);
    expect(result.dropped).toEqual([]);
  });

  it("formats a prompt annotation for dropped symbols", () => {
    expect(
      formatPreflightDropAnnotation([
        { symbol: "XXFAKEXX", reason: "no matching ticker found via resolver search" },
      ]),
    ).toBe(
      "[Pre-flight: dropped 1 unknown symbol - XXFAKEXX (no matching ticker found via resolver search)]",
    );
  });
});
