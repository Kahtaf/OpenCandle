import { describe, expect, it } from "vitest";
import {
  collectSessionMarketFacts,
  enrichStockQuoteDetails,
} from "../../../gui/web/src/features/chat/session-market-facts.js";

describe("session market facts", () => {
  it("fills missing quote valuation fields from later comparison results", () => {
    const rows = [
      {
        type: "tool_run",
        steps: [
          {
            result: {
              toolName: "get_stock_quote",
              details: {
                symbol: "MU",
                price: 919.25,
                changePercent: -6.65,
                pe: null,
              },
            },
          },
          {
            result: {
              toolName: "compare_companies",
              details: {
                companies: [
                  {
                    symbol: "MU",
                    name: "Micron Technology, Inc.",
                    marketCap: 103_000_000_000,
                    pe: 22.28,
                    forwardPe: 6.36,
                  },
                ],
              },
            },
          },
        ],
      },
    ];

    const facts = collectSessionMarketFacts(rows);
    expect(facts.MU.pe).toBe(22.28);

    const enriched = enrichStockQuoteDetails(
      { symbol: "MU", price: 919.25, changePercent: -6.65, pe: null, marketCap: 0 },
      facts,
    );
    expect(enriched.pe).toBe(22.28);
    expect(enriched.marketCap).toBe(103_000_000_000);
  });

  it("keeps recent quote facts available for symbols that are not in saved state", () => {
    const facts = collectSessionMarketFacts([
      {
        type: "tool_result",
        message: {
          toolName: "get_stock_quote",
          details: {
            symbol: "SNDK",
            price: 1575.12,
            change: -169.31,
            changePercent: -9.71,
            open: 1619.86,
            high: 1638.88,
            low: 1485.02,
            volume: 11_320_000,
            pe: null,
            timestamp: 1_783_443_600_000,
          },
        },
      },
    ]);

    expect(facts.SNDK.price).toBe(1575.12);
    expect(facts.SNDK.volume).toBe(11_320_000);
  });

  it("prefers the latest non-empty fact for repeated symbols", () => {
    const facts = collectSessionMarketFacts([
      {
        type: "tool_result",
        message: {
          toolName: "get_stock_quote",
          details: { symbol: "SNDK", price: 1500, pe: null },
        },
      },
      {
        type: "tool_result",
        message: {
          toolName: "get_stock_quote",
          details: { symbol: "SNDK", price: 1575.12, pe: null },
        },
      },
      {
        type: "tool_result",
        message: {
          toolName: "compare_companies",
          details: {
            companies: [{ symbol: "SNDK", pe: 53.74 }],
          },
        },
      },
    ]);

    expect(facts.SNDK.price).toBe(1575.12);
    expect(facts.SNDK.pe).toBe(53.74);
  });
});
