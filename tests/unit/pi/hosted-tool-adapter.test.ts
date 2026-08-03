import { Value } from "@sinclair/typebox/value";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getHostedOpenCandleToolDefinitions } from "../../../src/pi/hosted-tool-adapter.js";
import { getOpenCandleToolDefinitions } from "../../../src/pi/tool-adapter.js";

const hasCredential = vi.hoisted(() => vi.fn(() => false));

vi.mock("../../../src/onboarding/providers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/onboarding/providers.js")>();
  return { ...actual, hasCredential };
});

describe("hosted tool adapter", () => {
  beforeEach(() => {
    hasCredential.mockReset();
    hasCredential.mockReturnValue(false);
  });

  it("registers only tools with a complete direct-browser provider path", () => {
    expect(getHostedOpenCandleToolDefinitions().map((tool) => tool.name)).toEqual([
      "get_crypto_price",
      "get_crypto_history",
      "get_event_probabilities",
    ]);
  });

  it("advertises only daily stock history until an intraday-capable relay is available", () => {
    hasCredential.mockReturnValue(true);
    const directHistory = getHostedOpenCandleToolDefinitions().find(
      (tool) => tool.name === "get_stock_history",
    );
    const relayedHistory = getHostedOpenCandleToolDefinitions({ relayProviders: ["yahoo"] }).find(
      (tool) => tool.name === "get_stock_history",
    );

    expect(directHistory).toBeDefined();
    expect(Value.Check(directHistory?.parameters, { symbol: "AAPL", interval: "1d" })).toBe(true);
    expect(Value.Check(directHistory?.parameters, { symbol: "AAPL", interval: "1m" })).toBe(false);
    expect(Value.Check(relayedHistory?.parameters, { symbol: "AAPL", interval: "1m" })).toBe(true);
  });

  it("advertises only daily price comparisons until an intraday-capable relay is available", () => {
    hasCredential.mockReturnValue(true);
    const directComparison = getHostedOpenCandleToolDefinitions().find(
      (tool) => tool.name === "get_price_comparison",
    );
    const relayedComparison = getHostedOpenCandleToolDefinitions({
      relayProviders: ["yahoo"],
    }).find((tool) => tool.name === "get_price_comparison");
    const dailyArgs = { symbols: ["AAPL", "MSFT"], range: "1mo", interval: "1wk" };
    const intradayArgs = { symbols: ["AAPL", "MSFT"], range: "1d", interval: "1m" };

    expect(directComparison).toBeDefined();
    expect(Value.Check(directComparison?.parameters, dailyArgs)).toBe(true);
    expect(Value.Check(directComparison?.parameters, intradayArgs)).toBe(false);
    expect(Value.Check(relayedComparison?.parameters, intradayArgs)).toBe(true);
  });

  it("advertises direct Alpha Vantage market tools only when its key is configured", () => {
    const withoutKey = getHostedOpenCandleToolDefinitions().map((tool) => tool.name);
    hasCredential.mockReturnValue(true);
    const withKey = getHostedOpenCandleToolDefinitions().map((tool) => tool.name);

    expect(withoutKey).not.toEqual(
      expect.arrayContaining([
        "get_stock_quote",
        "get_stock_history",
        "get_price_comparison",
        "get_company_overview",
        "get_financials",
        "get_earnings",
        "compare_companies",
      ]),
    );
    expect(withKey).toEqual(
      expect.arrayContaining([
        "get_stock_quote",
        "get_stock_history",
        "get_price_comparison",
        "get_company_overview",
        "get_financials",
        "get_earnings",
        "compare_companies",
      ]),
    );
  });

  it("does not advertise an API-key provider from relay negotiation alone", () => {
    const withoutKey = getHostedOpenCandleToolDefinitions({ relayProviders: ["lse"] }).map(
      (tool) => tool.name,
    );
    hasCredential.mockImplementation((provider) => provider === "lse");
    const withKey = getHostedOpenCandleToolDefinitions({ relayProviders: ["lse"] }).map(
      (tool) => tool.name,
    );

    expect(withoutKey).not.toEqual(
      expect.arrayContaining(["get_stock_history", "get_price_comparison"]),
    );
    expect(withKey).toEqual(
      expect.arrayContaining(["get_stock_history", "get_price_comparison", "get_financials"]),
    );
  });

  it("does not advertise DCF until its required Yahoo quote path is available", () => {
    const directNames = getHostedOpenCandleToolDefinitions().map((tool) => tool.name);
    const yahooNames = getHostedOpenCandleToolDefinitions({ relayProviders: ["yahoo"] }).map(
      (tool) => tool.name,
    );

    expect(directNames).not.toContain("compute_dcf");
    expect(yahooNames).toContain("compute_dcf");
  });

  it("restricts hosted stock screening to the TradingView markets accepted by the relay", () => {
    const screener = getHostedOpenCandleToolDefinitions({
      relayProviders: ["tradingview"],
    }).find((tool) => tool.name === "screen_stocks");

    expect(screener).toBeDefined();
    expect(Value.Check(screener?.parameters, { market: "america" })).toBe(true);
    expect(Value.Check(screener?.parameters, { market: "global" })).toBe(true);
    expect(Value.Check(screener?.parameters, { market: "germany" })).toBe(false);
  });

  it("registers HTTP-backed tools only when their relay providers are negotiated", () => {
    hasCredential.mockImplementation((provider) =>
      ["alpha_vantage", "brave", "fred"].includes(String(provider)),
    );
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

  it("narrows hosted web-search overrides to usable browser providers", () => {
    const withoutBraveKey = getHostedOpenCandleToolDefinitions({
      relayProviders: ["brave", "ddg", "exa"],
    }).find((tool) => tool.name === "search_web");
    expect(withoutBraveKey).toBeDefined();
    expect(Value.Check(withoutBraveKey?.parameters, { query: "markets", provider: "exa" })).toBe(
      true,
    );
    expect(Value.Check(withoutBraveKey?.parameters, { query: "markets", provider: "brave" })).toBe(
      false,
    );
    expect(Value.Check(withoutBraveKey?.parameters, { query: "markets", provider: "ddg" })).toBe(
      true,
    );

    hasCredential.mockImplementation((provider) => provider === "brave");
    const withBraveKey = getHostedOpenCandleToolDefinitions({
      relayProviders: ["brave", "ddg", "exa"],
    }).find((tool) => tool.name === "search_web");
    expect(Value.Check(withBraveKey?.parameters, { query: "markets", provider: "brave" })).toBe(
      true,
    );
  });

  it("binds implicit hosted search execution to the negotiated providers", async () => {
    hasCredential.mockImplementation((provider) => provider === "brave");
    const search = getHostedOpenCandleToolDefinitions({ relayProviders: ["brave", "ddg"] }).find(
      (tool) => tool.name === "search_web",
    );
    expect(search).toBeDefined();
    expect((search as any).__hostedAllowedProviders).toEqual(["brave", "ddg"]);

    const sentiment = getHostedOpenCandleToolDefinitions({ relayProviders: ["brave", "ddg"] }).find(
      (tool) => tool.name === "get_sentiment_summary",
    );
    expect((sentiment as any).__hostedAllowedProviders).toEqual(["brave", "ddg"]);
    expect((sentiment as any).__hostedEvidenceProviders).toEqual([]);

    const yahooSentiment = getHostedOpenCandleToolDefinitions({
      relayProviders: ["brave", "yahoo"],
    }).find((tool) => tool.name === "get_sentiment_summary");
    expect((yahooSentiment as any).__hostedEvidenceProviders).toEqual(["yahoo"]);

    hasCredential.mockImplementation((provider) => provider === "finnhub");
    const finnhubSentiment = getHostedOpenCandleToolDefinitions({
      relayProviders: ["ddg", "finnhub"],
    }).find((tool) => tool.name === "get_sentiment_summary");
    expect((finnhubSentiment as any).__hostedEvidenceProviders).toEqual(["finnhub"]);
  });

  it("does not change the native local tool composition", () => {
    const localTools = getOpenCandleToolDefinitions();
    const localNames = localTools.map((tool) => tool.name);
    const localHistory = localTools.find((tool) => tool.name === "get_stock_history");
    const localComparison = localTools.find((tool) => tool.name === "get_price_comparison");
    const localScreener = localTools.find((tool) => tool.name === "screen_stocks");

    expect(localNames).toContain("get_event_probabilities");
    expect(localNames).toContain("get_stock_quote");
    expect(localNames).toContain("get_reddit_sentiment");
    expect(localNames.length).toBeGreaterThan(20);
    expect(Value.Check(localHistory?.parameters, { symbol: "AAPL", interval: "1m" })).toBe(true);
    expect(
      Value.Check(localComparison?.parameters, {
        symbols: ["AAPL", "MSFT"],
        range: "1d",
        interval: "1m",
      }),
    ).toBe(true);
    expect(Value.Check(localScreener?.parameters, { market: "germany" })).toBe(true);
  });
});
