import { describe, it, expect } from "vitest";
import { classifyIntent } from "../../../src/routing/classify-intent.js";

describe("classifyIntent", () => {
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
    });

    it("matches 'is AAPL attractive here?'", () => {
      const result = classifyIntent("is AAPL attractive here?");
      expect(result.workflow).toBe("single_asset_analysis");
      expect(result.entities.symbols).toEqual(["AAPL"]);
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

    it("matches 'build me a portfolio'", () => {
      const result = classifyIntent("build me a portfolio");
      expect(result.workflow).toBe("portfolio_builder");
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
  });

  describe("watchlist_or_tracking", () => {
    it("matches 'add NVDA to my watchlist'", () => {
      const result = classifyIntent("add NVDA to my watchlist");
      expect(result.workflow).toBe("watchlist_or_tracking");
      expect(result.tier).toBe("rule");
    });

    it("matches 'how are my predictions doing?'", () => {
      const result = classifyIntent("how are my predictions doing?");
      expect(result.workflow).toBe("watchlist_or_tracking");
    });

    it("matches 'show my portfolio'", () => {
      const result = classifyIntent("show my portfolio");
      expect(result.workflow).toBe("watchlist_or_tracking");
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
