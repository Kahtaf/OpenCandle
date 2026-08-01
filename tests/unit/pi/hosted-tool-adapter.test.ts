import { describe, expect, it } from "vitest";
import { getHostedOpenCandleToolDefinitions } from "../../../src/pi/hosted-tool-adapter.js";
import { getOpenCandleToolDefinitions } from "../../../src/pi/tool-adapter.js";

describe("hosted tool adapter", () => {
  it("registers only tools with a complete direct-browser provider path", () => {
    expect(getHostedOpenCandleToolDefinitions().map((tool) => tool.name)).toEqual([
      "get_stock_quote",
      "get_stock_history",
      "get_price_comparison",
      "get_crypto_price",
      "get_crypto_history",
      "get_company_overview",
      "get_financials",
      "get_earnings",
      "compute_dcf",
      "compare_companies",
      "get_event_probabilities",
    ]);
  });

  it("registers HTTP-backed tools only when their relay providers are negotiated", () => {
    const names = getHostedOpenCandleToolDefinitions({
      relayProviders: ["brave", "exa", "fear_greed", "fred", "tradingview", "yahoo"],
    }).map((tool) => tool.name);

    expect(names).toEqual([
      "search_ticker",
      "get_stock_quote",
      "get_stock_history",
      "get_price_comparison",
      "screen_stocks",
      "get_crypto_price",
      "get_crypto_history",
      "get_company_overview",
      "get_financials",
      "get_earnings",
      "compute_dcf",
      "compare_companies",
      "get_event_probabilities",
      "get_economic_data",
      "get_fear_greed",
      "get_technical_indicators",
      "backtest_strategy",
      "analyze_risk",
      "analyze_correlation",
      "analyze_holdings_overlap",
      "get_option_chain",
      "search_web",
      "get_sentiment_summary",
    ]);
    expect(names).not.toContain("get_reddit_sentiment");
    expect(names).not.toContain("get_twitter_sentiment");
    expect(names).not.toContain("manage_alerts");
  });

  it("does not change the native local tool composition", () => {
    const localNames = getOpenCandleToolDefinitions().map((tool) => tool.name);

    expect(localNames).toContain("get_event_probabilities");
    expect(localNames).toContain("get_stock_quote");
    expect(localNames).toContain("get_reddit_sentiment");
    expect(localNames.length).toBeGreaterThan(20);
  });
});
