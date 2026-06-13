import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { BackgroundQuoteRefreshes } from "../../../gui/server/background-quotes.js";

describe("BackgroundQuoteRefreshes", () => {
  it("adds synthetic quote refreshes without mutating persisted session entries", () => {
    const persisted: SessionEntry[] = [];
    const refreshes = new BackgroundQuoteRefreshes();

    refreshes.upsert({
      symbol: "NVDA",
      toolName: "get_stock_quote",
      args: { symbol: "NVDA" },
      value: { symbol: "NVDA", price: 216 },
      content: [{ type: "text", text: "NVDA quote" }],
      isError: false,
    });

    const entries = refreshes.withEntries(persisted);
    expect(persisted).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "custom",
      customType: "opencandle-quote-refresh",
      data: {
        symbol: "NVDA",
        value: { symbol: "NVDA", price: 216 },
      },
    });
  });

  it("keeps only the latest refresh per symbol", () => {
    const refreshes = new BackgroundQuoteRefreshes();

    refreshes.upsert({
      symbol: "NVDA",
      toolName: "get_stock_quote",
      args: { symbol: "NVDA" },
      value: { symbol: "NVDA", price: 216 },
      content: [{ type: "text", text: "old" }],
      isError: false,
    });
    refreshes.upsert({
      symbol: "NVDA",
      toolName: "get_stock_quote",
      args: { symbol: "NVDA" },
      value: { symbol: "NVDA", price: 217 },
      content: [{ type: "text", text: "new" }],
      isError: false,
    });

    const entries = refreshes.withEntries([]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      data: {
        symbol: "NVDA",
        value: { symbol: "NVDA", price: 217 },
        content: [{ type: "text", text: "new" }],
      },
    });
  });
});
