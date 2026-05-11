import { describe, expect, it } from "vitest";
import { parseGuiPromptIntent } from "../../../gui/server/prompt-intent.js";

describe("parseGuiPromptIntent", () => {
  it("detects direct stock quote prompts", () => {
    expect(parseGuiPromptIntent("Get the latest quote for NVDA. Show key fields briefly.")).toEqual({
      type: "stock_quote",
      symbol: "NVDA",
    });
  });

  it("ignores broader analysis prompts", () => {
    expect(parseGuiPromptIntent("Analyze NVDA and compare it to AMD")).toEqual({ type: "agent" });
  });

  it("detects concise quote comparison prompts", () => {
    expect(parseGuiPromptIntent("Compare NVDA and AMD using latest quotes.")).toEqual({
      type: "stock_quote_compare",
      symbols: ["NVDA", "AMD"],
    });
  });

  it("routes option chain prompts to the options tool", () => {
    expect(parseGuiPromptIntent("Show the options chain for NVDA")).toEqual({
      type: "tool_prompt",
      toolName: "get_option_chain",
      args: { symbol: "NVDA" },
    });
  });

  it("routes SEC filing prompts to the filings tool", () => {
    expect(parseGuiPromptIntent("Show recent SEC filings for AAPL")).toEqual({
      type: "tool_prompt",
      toolName: "get_sec_filings",
      args: { symbol: "AAPL", limit: 5 },
    });
  });

  it("routes macro prompts to FRED series defaults", () => {
    expect(parseGuiPromptIntent("Show FRED CPI inflation data")).toEqual({
      type: "tool_prompt",
      toolName: "get_economic_data",
      args: { series_id: "CPIAUCSL", limit: 12 },
    });
  });

  it("routes news prompts to web search with a finance query", () => {
    expect(parseGuiPromptIntent("Latest news headlines for AMD")).toEqual({
      type: "tool_prompt",
      toolName: "search_web",
      args: { query: "AMD financial news", category: "news", freshness: "day", limit: 5 },
    });
  });
});
