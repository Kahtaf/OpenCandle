import { describe, expect, it } from "vitest";
import { extractBudget, extractEntities } from "../../../src/routing/entity-extractor.js";

describe("extractEntities", () => {
  it("extracts portfolio catalog constraints deterministically", () => {
    const result = extractEntities(
      "Build me a portfolio for long-term growth. Constraints: $100,000 budget, balanced risk, 5y horizon, stocks only, 8 positions, max 15% per position.",
    );

    expect(result.assetScope).toBe("stocks_only");
    expect(result.positionCount).toBe(8);
    expect(result.maxSinglePositionPct).toBe(15);
  });
  describe("budget extraction", () => {
    it("extracts dollar amount with $ sign", () => {
      const result = extractEntities("I have $10,000 to invest");
      expect(result.budget).toBe(10_000);
    });

    it("extracts dollar amount without $ sign", () => {
      const result = extractEntities("I have 10000 dollars to invest");
      expect(result.budget).toBe(10_000);
    });

    it("extracts shorthand k notation", () => {
      const result = extractEntities("invest 10k in stocks");
      expect(result.budget).toBe(10_000);
    });

    it("extracts shorthand K notation uppercase", () => {
      const result = extractEntities("$5K portfolio");
      expect(result.budget).toBe(5_000);
    });

    it("returns undefined when no budget present", () => {
      const result = extractEntities("analyze NVDA");
      expect(result.budget).toBeUndefined();
    });

    it("does not treat a quoted price level as an investment budget", () => {
      const result = extractEntities("what about at $500?");
      expect(result.budget).toBeUndefined();
    });

    it("does not treat downside price levels as investment budgets", () => {
      const result = extractEntities("what if NVDA falls below $400?");
      expect(result.budget).toBeUndefined();
    });

    it("extracts max premium separately from general budget", () => {
      const result = extractEntities("MSFT call options under $500 premium");
      expect(result.maxPremium).toBe(500);
      expect(result.budget).toBeUndefined();
    });

    it("does not treat lowercase trading verbs as tickers in options contexts", () => {
      // "sell calls" matched the lowercase ticker-context pattern and minted a
      // SELL symbol, which then leaked into catalystSymbols (fixture 031).
      const result = extractEntities(
        "should I sell calls against my AMD shares for the next 1-2 weeks?",
      );
      expect(result.symbols).toEqual(["AMD"]);
      expect(result.heldSymbol).toBe("AMD");
      expect(result.catalystSymbols).toBeUndefined();

      const buyResult = extractEntities("thinking to buy puts on my NVDA position");
      expect(buyResult.symbols).toEqual(["NVDA"]);
    });

    it("does not treat cost basis as an investment budget", () => {
      const result = extractEntities(
        "I own AAPL with a $175 cost basis. What covered call should I sell?",
      );
      expect(result.costBasis).toBe(175);
      expect(result.budget).toBeUndefined();
    });

    it("does not treat non-budget dollar amounts as investment budgets", () => {
      expect(extractBudget("I own 100 shares of AAPL now worth $6,000")).toBeUndefined();
      expect(extractBudget("my position is valued at $12,500")).toBeUndefined();
      expect(extractBudget("it pays $2 per share in dividends")).toBeUndefined();
      expect(extractBudget("the stock is trading around $150")).toBeUndefined();
      expect(extractBudget("I am up $10k on NVDA")).toBeUndefined();
      expect(extractBudget("my position is worth $25k")).toBeUndefined();
      expect(extractBudget("I am up 10k on NVDA")).toBeUndefined();
      expect(extractBudget("my position is worth 25k")).toBeUndefined();
    });

    it("preserves explicit budget dollar amount extraction", () => {
      expect(extractBudget("I have $10,000 to invest")).toBe(10_000);
      expect(extractBudget("invest $5k in ETFs")).toBe(5_000);
    });
  });

  describe("symbol extraction", () => {
    it("extracts ticker with $ prefix", () => {
      const result = extractEntities("what about $MSFT calls");
      expect(result.symbols).toEqual(["MSFT"]);
    });

    it("extracts uppercase ticker in context", () => {
      const result = extractEntities("best MSFT calls a month out");
      expect(result.symbols).toEqual(["MSFT"]);
    });

    it("extracts multiple tickers", () => {
      const result = extractEntities("compare AAPL MSFT GOOGL");
      expect(result.symbols).toEqual(["AAPL", "MSFT", "GOOGL"]);
    });

    it("extracts lowercase tickers in explicit analysis and comparison contexts", () => {
      expect(extractEntities("ANALYZE nvda").symbols).toEqual(["NVDA"]);
      expect(extractEntities("Compare aapl and msft").symbols).toEqual(["AAPL", "MSFT"]);
    });

    it("does not extract lowercase asset-class or macro nouns as comparison tickers", () => {
      expect(extractEntities("compare bonds and cash").symbols).toEqual([]);
      expect(extractEntities("compare rates and cuts").symbols).toEqual([]);
    });

    it("extracts tickers separated by commas", () => {
      const result = extractEntities("compare AAPL, MSFT, and GOOGL");
      expect(result.symbols).toEqual(["AAPL", "MSFT", "GOOGL"]);
    });

    it("does not treat currency codes as tickers in cost-basis portfolio mutations", () => {
      const result = extractEntities(
        "Add 40 shares of ASTS to my portfolio at an average cost of 28 dollars USD.",
      );
      expect(result.symbols).toEqual(["ASTS"]);
    });

    it("extracts ticker with $ prefix and strips $", () => {
      const result = extractEntities("analyze $NVDA");
      expect(result.symbols).toEqual(["NVDA"]);
    });

    it("returns empty array when no symbols", () => {
      const result = extractEntities("what should I invest in?");
      expect(result.symbols).toEqual([]);
    });

    it("does not infer lowercase finance nouns as ticker symbols", () => {
      expect(extractEntities("what is the stock price").symbols).toEqual([]);
      expect(extractEntities("show me the options chain").symbols).toEqual([]);
    });

    it("does not match common English words as tickers", () => {
      const result = extractEntities("I have money to invest in ETFs");
      expect(result.symbols).not.toContain("I");
      expect(result.symbols).not.toContain("ETF");
    });

    it("does not treat macro/source/UI acronyms as tickers unless explicit", () => {
      expect(
        extractEntities("Use get_economic_data to show FRED CPI inflation data").symbols,
      ).toEqual([]);
      expect(extractEntities("render the options widget if the GUI supports it").symbols).toEqual(
        [],
      );
      expect(extractEntities("analyze $CPI as a stock").symbols).toEqual(["CPI"]);
    });

    it("does not extract finance acronym concepts as bare uppercase symbols", () => {
      expect(extractEntities("Compare these assets: IV, ASTS").symbols).toEqual(["ASTS"]);
      expect(extractEntities("What did the SEC say about TSLA filings?").symbols).toEqual(["TSLA"]);
      expect(extractEntities("How does FED policy affect TLT?").symbols).toEqual(["TLT"]);
      expect(extractEntities("Show CPI vs SPY YTD").symbols).toEqual(["SPY"]);
    });

    it("identifies the owned underlying and cost basis in catalyst-driven covered-call prompts", () => {
      const result = extractEntities(
        "NVDA earnings are today. If I have DRAM, what is the best covered call to sell right now? Cost basis is $51.",
      );

      expect(result.symbols).toEqual(["NVDA", "DRAM"]);
      expect((result as any).heldSymbol).toBe("DRAM");
      expect((result as any).catalystSymbols).toEqual(["NVDA"]);
      expect((result as any).costBasis).toBe(51);
      expect(result.dteHint).toBe("event_week");
    });

    it("identifies the owned underlying in catalyst-driven protective-put prompts", () => {
      const result = extractEntities(
        "NVDA earnings are today. I own 200 shares of AMD. What protective put should I buy for the next month?",
      );

      expect(result.symbols).toEqual(["NVDA", "AMD"]);
      expect(result.heldSymbol).toBe("AMD");
      expect(result.catalystSymbols).toEqual(["NVDA"]);
      expect(result.optionStrategy).toBe("protective_put");
      expect(result.shareQuantity).toBe(200);
      expect(result.dteHint).toBe("month");
    });
  });

  describe("direction extraction", () => {
    it("detects bullish from calls", () => {
      const result = extractEntities("best MSFT calls");
      expect(result.direction).toBe("bullish");
    });

    it("detects bearish from puts", () => {
      const result = extractEntities("safer TSLA puts next month");
      expect(result.direction).toBe("bearish");
    });

    it("returns undefined when no direction", () => {
      const result = extractEntities("analyze NVDA");
      expect(result.direction).toBeUndefined();
    });
  });

  describe("risk profile extraction", () => {
    it("detects conservative", () => {
      const result = extractEntities("I'm conservative, build me a portfolio");
      expect(result.riskProfile).toBe("conservative");
    });

    it("detects aggressive", () => {
      const result = extractEntities("aggressive growth portfolio");
      expect(result.riskProfile).toBe("aggressive");
    });

    it("detects balanced", () => {
      const result = extractEntities("a balanced portfolio for $10k");
      expect(result.riskProfile).toBe("balanced");
    });

    it("detects risk averse as conservative", () => {
      const result = extractEntities("I'm pretty risk averse");
      expect(result.riskProfile).toBe("conservative");
    });

    it("returns undefined when no risk profile", () => {
      const result = extractEntities("best MSFT calls");
      expect(result.riskProfile).toBeUndefined();
    });
  });

  describe("DTE hint extraction", () => {
    it("detects month out", () => {
      const result = extractEntities("calls a month out");
      expect(result.dteHint).toBe("month");
    });

    it("detects next month", () => {
      const result = extractEntities("puts for next month");
      expect(result.dteHint).toBe("month");
    });

    it("detects week/weekly", () => {
      const result = extractEntities("weekly AAPL puts");
      expect(result.dteHint).toBe("week");
    });

    it("detects LEAPS / long-dated", () => {
      const result = extractEntities("LEAPS on MSFT");
      expect(result.dteHint).toBe("leaps");
    });

    // Historical loss class: "1-2 weeks DTE preservation". A same-day
    // catalyst mention ("earnings are today") must not override the user's
    // explicit week-range DTE request into event_week/0-7 days.
    it("prefers an explicit week-range DTE over catalyst event-week inference", () => {
      const result = extractEntities(
        "I own 100 shares of DRAM at a $51 cost basis. NVDA earnings are today, but I want a covered call 1-2 weeks out. What strike and expiry should I look at?",
      );
      expect(result.dteHint).toBe("1-2 weeks");
    });

    it("extracts spelled-out and dashed week ranges", () => {
      expect(extractEntities("covered call one to two weeks out on AAPL").dteHint).toBe(
        "one-two weeks",
      );
      expect(extractEntities("puts 2–3 weeks out, earnings tonight").dteHint).toBe("2-3 weeks");
    });

    it("returns undefined when no DTE hint", () => {
      const result = extractEntities("MSFT calls");
      expect(result.dteHint).toBeUndefined();
    });
  });

  describe("option strategy extraction", () => {
    it("detects covered calls", () => {
      const result = extractEntities("Sell a covered call on MSFT");
      expect(result.optionStrategy).toBe("covered_call");
    });

    it("detects protective puts with share quantity and held underlying", () => {
      const result = extractEntities(
        "I own 200 shares of NVDA after a big rally. What's a reasonable protective put 30-45 days out that doesn't cost too much?",
      );

      expect(result.symbols).toEqual(["NVDA"]);
      expect(result.optionStrategy).toBe("protective_put");
      expect(result.direction).toBe("bearish");
      expect(result.heldSymbol).toBe("NVDA");
      expect(result.catalystSymbols).toBeUndefined();
      expect(result.shareQuantity).toBe(200);
      expect(result.dteHint).toBe("30-45 days");
    });

    it("detects lowercase held underlyings in protective-put prompts", () => {
      const result = extractEntities(
        "I own 200 shares of nvda after a big rally. What's a reasonable protective put 30-45 days out?",
      );

      expect(result.symbols).toEqual(["NVDA"]);
      expect(result.heldSymbol).toBe("NVDA");
      expect(result.optionStrategy).toBe("protective_put");
      expect(result.shareQuantity).toBe(200);
    });

    it("detects protective puts from generic hedge language", () => {
      const result = extractEntities("Need a put hedge to protect 500 shares of MSFT");

      expect(result.optionStrategy).toBe("protective_put");
      expect(result.shareQuantity).toBe(500);
    });
  });

  describe("cost basis extraction", () => {
    it("extracts a numeric cost basis", () => {
      const result = extractEntities("Sell a covered call on MSFT with cost basis 123.45");
      expect(result.costBasis).toBe(123.45);
    });

    it("extracts a dollar-prefixed cost basis", () => {
      const result = extractEntities("covered call on AAPL; cost basis: $1,234.56");
      expect(result.costBasis).toBe(1234.56);
    });
  });

  describe("time horizon extraction", () => {
    it("detects short term", () => {
      const result = extractEntities("short term trades");
      expect(result.timeHorizon).toBe("short");
    });

    it("detects long term", () => {
      const result = extractEntities("long term investments");
      expect(result.timeHorizon).toBe("long");
    });

    it("returns undefined when no horizon", () => {
      const result = extractEntities("analyze NVDA");
      expect(result.timeHorizon).toBeUndefined();
    });

    it("detects explicit multi-year horizon", () => {
      const result = extractEntities(
        "Build a $25000 ETF portfolio for a conservative investor over 3 years.",
      );
      expect(result.timeHorizon).toBe("3_years");
    });

    it("detects explicit month horizon", () => {
      const result = extractEntities("For the next 6 months, should I use BTC or GLD?");
      expect(result.timeHorizon).toBe("6mo");
    });
  });

  describe("asset scope extraction", () => {
    it("detects ETF-only scope", () => {
      const result = extractEntities(
        "Build a $25000 ETF portfolio for a conservative investor over 3 years.",
      );
      expect(result.assetScope).toBe("etf_focused");
    });

    it("detects an explicit US-stock scope", () => {
      const result = extractEntities(
        "Build a long-term growth portfolio with four US stocks and moderate risk.",
      );
      expect(result.assetScope).toBe("stocks_only");
    });
  });

  it("preserves an explicit maximum options horizon", () => {
    const result = extractEntities("Screen AAPL calls expiring within 60 days.");
    expect(result.dteHint).toBe("0-60 days");
  });

  describe("compare focus extraction", () => {
    it("detects sentiment focus", () => {
      const result = extractEntities("Compare AAPL and MSFT sentiment");
      expect(result.compareMetrics).toEqual(["sentiment"]);
    });

    it("detects macro hedge focus", () => {
      const result = extractEntities(
        "For the next 6 months, should I use BTC or GLD as a macro hedge?",
      );
      expect(result.compareMetrics).toEqual(["macro_hedge"]);
    });

    it("detects interest-rate comparison focus", () => {
      const result = extractEntities(
        "For the next 12 months, should I overweight SPY or QQQ if rates start falling?",
      );
      expect(result.compareMetrics).toEqual(["interest_rates"]);
    });

    it("detects ETF overlap comparison focus", () => {
      const result = extractEntities("Does buying QQQ on top of VOO create too much overlap?");
      expect(result.compareMetrics).toEqual(["overlap"]);
    });
  });
});

describe("extractBudget (exported for clarification parsing)", () => {
  it("extracts from '$15k and I'm aggressive'", () => {
    expect(extractBudget("$15k and I'm aggressive")).toBe(15_000);
  });

  it("extracts from 'around 25k and conservative'", () => {
    expect(extractBudget("around 25k and conservative")).toBe(25_000);
  });

  it("extracts from '5k max and ETFs only'", () => {
    expect(extractBudget("5k max and ETFs only")).toBe(5_000);
  });

  it("extracts from 'budget is $10,000'", () => {
    expect(extractBudget("budget is $10,000")).toBe(10_000);
  });

  it("extracts from '$50,000'", () => {
    expect(extractBudget("$50,000")).toBe(50_000);
  });

  it("extracts from 'about $2.5k'", () => {
    expect(extractBudget("about $2.5k")).toBe(2_500);
  });

  it("extracts from '10000 dollars total'", () => {
    expect(extractBudget("10000 dollars total")).toBe(10_000);
  });

  it("returns undefined for no money expression", () => {
    expect(extractBudget("I'm aggressive")).toBeUndefined();
  });
});
