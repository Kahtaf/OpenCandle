import { describe, it, expect, vi } from "vitest";
import { httpGet } from "../../../src/infra/http-client.js";
import { searchYahooInstruments } from "../../../src/market-state/resolve.js";

vi.mock("../../../src/infra/http-client.js", () => ({
  httpGet: vi.fn(),
}));

describe("searchYahooInstruments", () => {
  it("returns normalized resolver candidates for autocomplete", async () => {
    vi.mocked(httpGet).mockResolvedValue({
      quotes: [
        {
          symbol: "AAPL",
          shortname: "Apple Inc.",
          quoteType: "EQUITY",
          exchange: "NMS",
          score: 101,
        },
      ],
    });

    const results = await searchYahooInstruments("apple");

    expect(results).toEqual([
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        quoteType: "EQUITY",
        assetType: "equity",
        exchange: "NMS",
        provider: "yahoo",
        score: 101,
      },
    ]);
  });

  it("returns candidate lists without mutating state for misspelled ticker-like input", async () => {
    vi.mocked(httpGet).mockResolvedValue({
      quotes: [
        {
          symbol: "APLD",
          longname: "Applied Digital Corporation",
          quoteType: "EQUITY",
          exchange: "NMS",
          score: 20,
        },
      ],
    });

    const results = await searchYahooInstruments("APL");

    expect(results[0].symbol).toBe("APLD");
    expect(results[0].symbol).not.toBe("APL");
  });
});
