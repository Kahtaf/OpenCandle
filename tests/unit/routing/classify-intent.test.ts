import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyIntent, hasFinanceSignals } from "../../../src/routing/classify-intent.js";

describe("classifyIntent", () => {
  it("is marked deprecated because LLM routing is the default classifier", () => {
    const source = readFileSync("src/routing/classify-intent.ts", "utf-8");
    expect(source).toMatch(
      /@deprecated\s+Use the LLM router \(`route`\) for new classification paths; keep this only for rules-mode fallback and deterministic safety nets\./,
    );
  });

  describe("single_asset_analysis", () => {
    it("matches 'analyze NVDA'", () => {
      const result = classifyIntent("analyze NVDA");
      expect(result.workflow).toBe("single_asset_analysis");
      expect(result.confidence).toBe(1.0);
      expect(result.tier).toBe("rule");
      expect(result.entities.symbols).toEqual(["NVDA"]);
    });

    it("matches 'full analysis of AAPL'", () => {
      const result = classifyIntent("full analysis of AAPL");
      expect(result.workflow).toBe("single_asset_analysis");
      expect(result.entities.symbols).toEqual(["AAPL"]);
    });

    it("matches 'deep dive on TSLA'", () => {
      const result = classifyIntent("deep dive on TSLA");
      expect(result.workflow).toBe("single_asset_analysis");
      expect(result.entities.symbols).toEqual(["TSLA"]);
    });

    it("matches 'analyze $NVDA' with dollar sign", () => {
      const result = classifyIntent("analyze $NVDA");
      expect(result.workflow).toBe("single_asset_analysis");
      expect(result.entities.symbols).toEqual(["NVDA"]);
    });

    it("matches case insensitively", () => {
      const result = classifyIntent("ANALYZE nvda");
      expect(result.workflow).toBe("single_asset_analysis");
      expect(result.entities.symbols).toEqual(["NVDA"]);
    });

    it("matches 'is AAPL attractive here?'", () => {
      const result = classifyIntent("is AAPL attractive here?");
      expect(result.workflow).toBe("single_asset_analysis");
      expect(result.entities.symbols).toEqual(["AAPL"]);
    });

    it("matches bull/bear case prompts for a single symbol", () => {
      const result = classifyIntent(
        "Give me the bull and bear case for PLTR, then force yourself to pick a side.",
      );
      expect(result.workflow).toBe("single_asset_analysis");
      expect(result.entities.symbols).toEqual(["PLTR"]);
    });
  });

  describe("portfolio_builder", () => {
    it("matches 'I have $10k to invest'", () => {
      const result = classifyIntent("I have $10k to invest");
      expect(result.workflow).toBe("portfolio_builder");
      expect(result.tier).toBe("rule");
      expect(result.entities.budget).toBe(10_000);
    });

    it("matches 'build me a diversified $10k starter portfolio'", () => {
      const result = classifyIntent(
        "build me a diversified $10k starter portfolio for today's market with 4 positions",
      );
      expect(result.workflow).toBe("portfolio_builder");
      expect(result.entities.budget).toBe(10_000);
    });

    it("matches 'invest $5000'", () => {
      const result = classifyIntent("how should I invest $5000");
      expect(result.workflow).toBe("portfolio_builder");
      expect(result.entities.budget).toBe(5_000);
    });

    it("matches 'what should I invest in' without budget", () => {
      const result = classifyIntent("what should I invest in?");
      expect(result.workflow).toBe("portfolio_builder");
    });

    it("matches ETF portfolio prompts with explicit budget and risk profile", () => {
      const result = classifyIntent(
        "Build a $25000 ETF portfolio for a conservative investor over 3 years.",
      );
      expect(result.workflow).toBe("portfolio_builder");
      expect(result.entities.budget).toBe(25_000);
      expect(result.entities.riskProfile).toBe("conservative");
    });

    it("matches 'build me a portfolio'", () => {
      const result = classifyIntent("build me a portfolio");
      expect(result.workflow).toBe("portfolio_builder");
    });

    it("does not mistake budget-backed portfolio creation for saved-state tracking", () => {
      const result = classifyIntent("create a $10k portfolio");
      expect(result.workflow).toBe("portfolio_builder");
      expect(result.entities.budget).toBe(10_000);
    });

    it("extracts risk profile when present", () => {
      const result = classifyIntent(
        "I'm conservative and prefer ETFs. What should I buy with $10k?",
      );
      expect(result.workflow).toBe("portfolio_builder");
      expect(result.entities.riskProfile).toBe("conservative");
      expect(result.entities.budget).toBe(10_000);
    });
  });

  describe("options_screener", () => {
    it("matches 'best MSFT calls a month out'", () => {
      const result = classifyIntent("best MSFT calls a month out");
      expect(result.workflow).toBe("options_screener");
      expect(result.tier).toBe("rule");
      expect(result.entities.symbols).toEqual(["MSFT"]);
      expect(result.entities.direction).toBe("bullish");
      expect(result.entities.dteHint).toBe("month");
    });

    it("matches 'show me safer TSLA puts for next month'", () => {
      const result = classifyIntent("show me safer TSLA puts for next month");
      expect(result.workflow).toBe("options_screener");
      expect(result.entities.symbols).toEqual(["TSLA"]);
      expect(result.entities.direction).toBe("bearish");
    });

    it("matches 'NVDA call options under $500 premium'", () => {
      const result = classifyIntent("NVDA call options under $500 premium");
      expect(result.workflow).toBe("options_screener");
      expect(result.entities.symbols).toEqual(["NVDA"]);
      expect(result.entities.direction).toBe("bullish");
    });

    it("matches 'option chain for SPY'", () => {
      const result = classifyIntent("option chain for SPY");
      expect(result.workflow).toBe("options_screener");
      expect(result.entities.symbols).toEqual(["SPY"]);
    });

    it("keeps option prompts on options_screener when sentiment is mentioned", () => {
      const result = classifyIntent("Find TSLA options sentiment");
      expect(result.workflow).toBe("options_screener");
      expect(result.entities.symbols).toEqual(["TSLA"]);
    });
  });

  describe("compare_assets", () => {
    it("matches 'compare AAPL MSFT GOOGL'", () => {
      const result = classifyIntent("compare AAPL MSFT GOOGL");
      expect(result.workflow).toBe("compare_assets");
      expect(result.tier).toBe("rule");
      expect(result.entities.symbols).toEqual(["AAPL", "MSFT", "GOOGL"]);
    });

    it("matches 'which is better, SPY or QQQ?'", () => {
      const result = classifyIntent("which is better, SPY or QQQ?");
      expect(result.workflow).toBe("compare_assets");
      expect(result.entities.symbols).toEqual(["SPY", "QQQ"]);
    });

    it("matches 'AAPL vs MSFT'", () => {
      const result = classifyIntent("AAPL vs MSFT");
      expect(result.workflow).toBe("compare_assets");
      expect(result.entities.symbols).toEqual(["AAPL", "MSFT"]);
    });

    it("keeps Mastercard MA as a ticker in plain comparisons", () => {
      const result = classifyIntent("compare V and MA");
      expect(result.workflow).toBe("compare_assets");
      expect(result.entities.symbols).toEqual(["V", "MA"]);
    });

    it("keeps multi-symbol sentiment comparisons on compare_assets", () => {
      const result = classifyIntent("Compare AAPL and MSFT sentiment");
      expect(result.workflow).toBe("compare_assets");
      expect(result.entities.symbols).toEqual(["AAPL", "MSFT"]);
    });

    it("does not mistake prose asking to call out risks for a call-options request", () => {
      const result = classifyIntent(
        "Compare NVDA and AMD for a 6-month swing trade. Use available market data, call out valuation and downside risks, and end with a cautious action plan.",
      );

      expect(result.workflow).toBe("compare_assets");
      expect(result.entities.symbols).toEqual(["NVDA", "AMD"]);
      expect(result.entities.direction).toBeUndefined();
    });

    it("routes ETF strategy tradeoff prompts as comparison instead of portfolio construction", () => {
      const result = classifyIntent(
        "If I have $5,000 for 10-15 years, should I prioritize VYM or SCHD, or something more growth-oriented like VOO or QQQ? What are the tradeoffs?",
      );

      expect(result.workflow).toBe("compare_assets");
      expect(result.entities.symbols).toEqual(["VYM", "SCHD", "VOO", "QQQ"]);
    });

    it("does not route lowercase asset-class comparisons as ticker comparisons", () => {
      const result = classifyIntent("compare bonds and cash");
      expect(result.workflow).not.toBe("compare_assets");
      expect(result.entities.symbols).toEqual([]);
    });

    it("does not treat moving-average MA usage as the Mastercard ticker", () => {
      const result = classifyIntent("compare the 20 day MA and 50 day MA for SPY");
      expect(result.entities.symbols).toEqual(["SPY"]);
    });
  });

  describe("watchlist_or_tracking", () => {
    it("matches 'add NVDA to my watchlist'", () => {
      const result = classifyIntent("add NVDA to my watchlist");
      expect(result.workflow).toBe("watchlist_or_tracking");
      expect(result.tier).toBe("rule");
    });

    it("matches 'show my portfolio'", () => {
      const result = classifyIntent("show my portfolio");
      expect(result.workflow).toBe("watchlist_or_tracking");
    });

    it("routes portfolio lot mutations before compare or builder workflows", () => {
      const result = classifyIntent(
        "Add 40 shares of ASTS to my portfolio at an average cost of 28 dollars USD.",
      );
      expect(result.workflow).toBe("watchlist_or_tracking");
      expect(result.entities.symbols).toEqual(["ASTS"]);
      expect(result.entities.budget).toBeUndefined();
    });

    it("matches owned-holdings portfolio risk prompts before compare routing", () => {
      const result = classifyIntent(
        "I own 40% NVDA, 25% MSFT, 20% AAPL, 15% cash. What is my biggest portfolio risk?",
      );
      expect(result.workflow).toBe("watchlist_or_tracking");
      expect(result.entities.symbols).toEqual(["NVDA", "MSFT", "AAPL"]);
    });
  });

  describe("general_finance_qa", () => {
    it("matches 'what is the fed funds rate?'", () => {
      const result = classifyIntent("what is the fed funds rate?");
      expect(result.workflow).toBe("general_finance_qa");
      expect(result.tier).toBe("rule");
    });

    it("matches 'what does delta mean?'", () => {
      const result = classifyIntent("what does delta mean?");
      expect(result.workflow).toBe("general_finance_qa");
    });

    it("matches 'explain RSI'", () => {
      const result = classifyIntent("explain RSI");
      expect(result.workflow).toBe("general_finance_qa");
    });

    it("matches 'how does options pricing work?'", () => {
      const result = classifyIntent("how does options pricing work?");
      expect(result.workflow).toBe("general_finance_qa");
    });

    it("matches SEC filing thesis prompts without treating SEC as a compared ticker", () => {
      const result = classifyIntent(
        "What recent SEC filings for COIN could change the investment thesis?",
      );
      expect(result.workflow).toBe("general_finance_qa");
      expect(result.entities.symbols).toEqual(["COIN"]);
    });

    it("matches backtest strategy prompts for the tool-backed general path", () => {
      const result = classifyIntent(
        "Backtest a simple moving-average strategy on SPY and tell me if it beats buy-and-hold.",
      );
      expect(result.workflow).toBe("general_finance_qa");
      expect(result.entities.symbols).toEqual(["SPY"]);
    });

    it("matches single-asset sentiment/price prompts for the tool-backed general path", () => {
      const result = classifyIntent(
        "Is Bitcoin sentiment getting overheated or improving? Compare price action and retail sentiment.",
      );
      expect(result.workflow).toBe("general_finance_qa");
      expect(result.entities.symbols).toEqual([]);
    });

    it("routes semiconductor market-structure research without treating AI as a ticker", () => {
      const result = classifyIntent(
        "Analyze the current market structure of the semiconductor industry and predict how emerging technologies like AI could reshape it over the next decade.",
      );
      expect(result.workflow).toBe("general_finance_qa");
      expect(result.entities.symbols).toEqual([]);
    });

    it("routes US monetary policy impact research to the general path", () => {
      const result = classifyIntent(
        "What are the potential impacts of the recent shifts in U.S. monetary policy on emerging markets? Consider factors like currency fluctuations, capital flows, and inflation.",
      );
      expect(result.workflow).toBe("general_finance_qa");
      expect(result.entities.symbols).toEqual([]);
    });

    it("routes macro risk discussion for a portfolio to the general path", () => {
      const result = classifyIntent(
        "What macro risks matter most for a balanced portfolio right now?",
      );

      expect(result.workflow).toBe("general_finance_qa");
      expect(result.entities.symbols).toEqual([]);
    });

    it("routes evaluation of an existing allocation to the general path", () => {
      const result = classifyIntent(
        "Critically evaluate a balanced portfolio with 60% equity and 40% fixed income for the next 12-18 months.",
      );

      expect(result.workflow).toBe("general_finance_qa");
      expect(result.entities.symbols).toEqual([]);
    });

    it("routes current portfolio exposure reviews to the general path", () => {
      const result = classifyIntent(
        "Does my current portfolio look too exposed if rates stay high for another year, and what would you change first?",
      );

      expect(result.workflow).toBe("general_finance_qa");
      expect(result.entities.symbols).toEqual([]);
    });

    it("does not treat broad bond-rate mechanics as portfolio construction", () => {
      const result = classifyIntent(
        "How would falling rates change bond prices over the next year?",
      );

      expect(result.workflow).toBe("unclassified");
      expect(result.entities.symbols).toEqual([]);
    });

    it("keeps explicit AI ticker prompts as single-asset analysis", () => {
      const result = classifyIntent("analyze AI");
      expect(result.workflow).toBe("single_asset_analysis");
      expect(result.entities.symbols).toEqual(["AI"]);
    });
  });

  describe("news queries → general_finance_qa", () => {
    it("matches 'any recent news about NVDA and AI chip exports'", () => {
      const result = classifyIntent("Any recent news about NVDA and AI chip exports?");
      expect(result.workflow).toBe("general_finance_qa");
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
      expect(result.entities.symbols).toEqual(["NVDA"]);
    });

    it("matches 'what's the latest news on semiconductor tariffs'", () => {
      const result = classifyIntent("What's the latest news on semiconductor tariffs?");
      expect(result.workflow).toBe("general_finance_qa");
    });

    it("matches 'TSLA recent announcements'", () => {
      const result = classifyIntent("TSLA recent announcements");
      expect(result.workflow).toBe("general_finance_qa");
    });

    it("matches 'what's happening with Boeing safety investigation'", () => {
      const result = classifyIntent("What's happening with the Boeing safety investigation?");
      expect(result.workflow).toBe("general_finance_qa");
    });

    it("does NOT match 'analyze NVDA' (still single_asset_analysis)", () => {
      const result = classifyIntent("analyze NVDA");
      expect(result.workflow).toBe("single_asset_analysis");
    });
  });

  describe("unclassified", () => {
    it("returns unclassified for 'hello'", () => {
      const result = classifyIntent("hello");
      expect(result.workflow).toBe("unclassified");
      expect(result.confidence).toBeLessThan(1.0);
    });

    it("returns unclassified for empty input", () => {
      const result = classifyIntent("");
      expect(result.workflow).toBe("unclassified");
    });

    it("returns unclassified for vague input", () => {
      const result = classifyIntent("thanks");
      expect(result.workflow).toBe("unclassified");
    });
  });

  describe("edge cases", () => {
    it("handles extra whitespace", () => {
      const result = classifyIntent("  analyze   NVDA  ");
      expect(result.workflow).toBe("single_asset_analysis");
    });

    it("handles mixed case", () => {
      const result = classifyIntent("Compare aapl and msft");
      expect(result.workflow).toBe("compare_assets");
    });
  });
});

describe("hasFinanceSignals", () => {
  it("detects finance vocabulary in prompts without resolvable tickers", () => {
    expect(hasFinanceSignals("Thoughts on the SpaceX IPO today? Worth getting exposure?")).toBe(
      true,
    );
    expect(hasFinanceSignals("Should I buy more semiconductor stocks before earnings?")).toBe(true);
    expect(hasFinanceSignals("How is the bond market reacting to the Fed?")).toBe(true);
    expect(hasFinanceSignals("Is now a good time to invest in clean energy ETFs?")).toBe(true);
  });

  it("stays quiet for non-finance prompts", () => {
    expect(hasFinanceSignals("write me a poem about autumn leaves")).toBe(false);
    expect(hasFinanceSignals("what's the weather in Toronto tomorrow")).toBe(false);
    expect(hasFinanceSignals("translate hello to french")).toBe(false);
  });
});
