import { describe, it, expect } from "vitest";
import { extractEntities, extractBudget } from "../../../src/routing/entity-extractor.js";

describe("extractEntities", () => {
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

    it("extracts max premium separately from general budget", () => {
      const result = extractEntities("MSFT call options under $500 premium");
      expect(result.maxPremium).toBe(500);
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

    it("extracts tickers separated by commas", () => {
      const result = extractEntities("compare AAPL, MSFT, and GOOGL");
      expect(result.symbols).toEqual(["AAPL", "MSFT", "GOOGL"]);
    });

    it("extracts ticker with $ prefix and strips $", () => {
      const result = extractEntities("analyze $NVDA");
      expect(result.symbols).toEqual(["NVDA"]);
    });

    it("returns empty array when no symbols", () => {
      const result = extractEntities("what should I invest in?");
      expect(result.symbols).toEqual([]);
    });

    it("does not match common English words as tickers", () => {
      const result = extractEntities("I have money to invest in ETFs");
      expect(result.symbols).not.toContain("I");
      expect(result.symbols).not.toContain("ETF");
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

    it("returns undefined when no DTE hint", () => {
      const result = extractEntities("MSFT calls");
      expect(result.dteHint).toBeUndefined();
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
