import { describe, it, expect } from "vitest";
import { scoreWorkflowClassification } from "../../evals/scorers/workflow-classification.js";
import { scoreToolSelection } from "../../evals/scorers/tool-selection.js";
import { scoreToolArguments } from "../../evals/scorers/tool-arguments.js";
import {
  scoreDataFaithfulness,
  extractFinancialNumbers,
  extractNumbersFromObject,
} from "../../evals/scorers/data-faithfulness.js";
import { scoreRiskDisclosure } from "../../evals/scorers/risk-disclosure.js";
import type { EvalTrace } from "../../evals/types.js";

function makeTrace(overrides: Partial<EvalTrace> = {}): EvalTrace {
  return {
    prompt: "test prompt",
    classification: {
      workflow: "single_asset_analysis",
      confidence: 0.95,
      tier: "rule",
      entities: { symbols: ["AAPL"] },
    },
    toolCalls: [],
    askUserTranscript: [],
    text: "",
    ...overrides,
  };
}

describe("scoreWorkflowClassification", () => {
  it("scores 1.0 on exact match", () => {
    const trace = makeTrace();
    const result = scoreWorkflowClassification(trace, "single_asset_analysis");
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("scores 0.0 on mismatch", () => {
    const trace = makeTrace();
    const result = scoreWorkflowClassification(trace, "portfolio_builder");
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
    expect(result.message).toContain("Expected portfolio_builder");
  });
});

describe("scoreToolSelection", () => {
  it("scores 1.0 when all required tools called", () => {
    const trace = makeTrace({
      toolCalls: [
        { name: "get_stock_quote", args: { symbol: "AAPL" } },
        { name: "get_technicals", args: { symbol: "AAPL" } },
      ],
    });
    const result = scoreToolSelection(trace, ["get_stock_quote", "get_technicals"]);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("scores partial when some required tools missing", () => {
    const trace = makeTrace({
      toolCalls: [{ name: "get_stock_quote", args: { symbol: "AAPL" } }],
    });
    const result = scoreToolSelection(trace, ["get_stock_quote", "get_technicals"]);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.5);
    expect(result.message).toContain("missing required: get_technicals");
  });

  it("scores 0.0 when forbidden tool called", () => {
    const trace = makeTrace({
      toolCalls: [
        { name: "get_stock_quote", args: {} },
        { name: "run_backtest", args: {} },
      ],
    });
    const result = scoreToolSelection(trace, ["get_stock_quote"], ["run_backtest"]);
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
  });

  it("scores 1.0 with no assertions", () => {
    const trace = makeTrace({ toolCalls: [{ name: "anything", args: {} }] });
    const result = scoreToolSelection(trace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });
});

describe("scoreToolArguments", () => {
  it("scores 1.0 when args match", () => {
    const trace = makeTrace({
      toolCalls: [{ name: "get_stock_quote", args: { symbol: "AAPL" } }],
    });
    const result = scoreToolArguments(trace, {
      get_stock_quote: { symbol: "AAPL" },
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("fails when tool not called", () => {
    const trace = makeTrace({ toolCalls: [] });
    const result = scoreToolArguments(trace, {
      get_stock_quote: { symbol: "AAPL" },
    });
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
  });

  it("fails when arg value mismatches", () => {
    const trace = makeTrace({
      toolCalls: [{ name: "get_stock_quote", args: { symbol: "MSFT" } }],
    });
    const result = scoreToolArguments(trace, {
      get_stock_quote: { symbol: "AAPL" },
    });
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.0);
  });
});

describe("extractFinancialNumbers", () => {
  it("extracts currency amounts", () => {
    expect(extractFinancialNumbers("AAPL is trading at $185.50")).toContain(185.5);
  });

  it("extracts percentages", () => {
    expect(extractFinancialNumbers("up 12.3% today")).toContain(12.3);
  });

  it("extracts multipliers", () => {
    expect(extractFinancialNumbers("P/E of 15.3x")).toContain(15.3);
  });

  it("extracts abbreviated large numbers", () => {
    const nums = extractFinancialNumbers("market cap of 2.8T and revenue 394B");
    expect(nums).toContain(2.8e12);
    expect(nums).toContain(394e9);
  });

  it("extracts metric patterns", () => {
    expect(extractFinancialNumbers("P/E of 28.5")).toContain(28.5);
    expect(extractFinancialNumbers("yield of 3.5")).toContain(3.5);
  });
});

describe("extractNumbersFromObject", () => {
  it("extracts from flat object", () => {
    const nums = extractNumbersFromObject({ price: 185.5, volume: 1000000 });
    expect(nums).toContain(185.5);
    expect(nums).toContain(1000000);
  });

  it("extracts from nested objects", () => {
    const nums = extractNumbersFromObject({ data: { inner: { value: 42 } } });
    expect(nums).toContain(42);
  });

  it("extracts from arrays", () => {
    const nums = extractNumbersFromObject([1, 2, 3]);
    expect(nums).toEqual([1, 2, 3]);
  });

  it("extracts numbers from strings", () => {
    const nums = extractNumbersFromObject({ formatted: "$185.50" });
    expect(nums).toContain(185.50);
  });
});

describe("scoreDataFaithfulness", () => {
  it("scores 1.0 when all numbers grounded", () => {
    const trace = makeTrace({
      text: "AAPL is trading at $185.50",
      toolCalls: [
        { name: "get_stock_quote", args: {}, result: { price: 185.5 } },
      ],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("flags ungrounded numbers", () => {
    const trace = makeTrace({
      text: "AAPL P/E of 28.5",
      toolCalls: [
        { name: "get_stock_quote", args: {}, result: { price: 185.5 } },
      ],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("28.5");
  });

  it("allows values within 1% tolerance", () => {
    const trace = makeTrace({
      text: "Return of 12.1%",
      toolCalls: [
        { name: "run_backtest", args: {}, result: { totalReturn: 12.0 } },
      ],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(true);
  });

  it("scores 1.0 when no financial numbers in response", () => {
    const trace = makeTrace({ text: "Here is your analysis." });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });
});

describe("scoreRiskDisclosure", () => {
  it("passes when disclaimer present and no prohibited language", () => {
    const trace = makeTrace({
      text: "AAPL looks strong. This is not financial advice. Consult a professional.",
    });
    const result = scoreRiskDisclosure(trace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("fails when no disclaimer", () => {
    const trace = makeTrace({ text: "Buy AAPL now, it's going up." });
    const result = scoreRiskDisclosure(trace);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("No risk disclaimer");
  });

  it("fails on prohibited language", () => {
    const trace = makeTrace({
      text: "This is a guaranteed returns opportunity. Not financial advice.",
    });
    const result = scoreRiskDisclosure(trace);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("Prohibited language");
  });

  it("checks custom responseContains patterns", () => {
    const trace = makeTrace({ text: "Not financial advice." });
    const result = scoreRiskDisclosure(trace, ["risk factors"]);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("Missing required");
  });

  it("checks custom responseNotContains patterns", () => {
    const trace = makeTrace({ text: "Buy now! Not financial advice." });
    const result = scoreRiskDisclosure(trace, undefined, [/buy now/i]);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("Contains prohibited");
  });

  it("skips built-in disclaimer check when custom patterns provided", () => {
    const trace = makeTrace({ text: "All investments carry risk." });
    // No built-in disclaimer match, but custom pattern matches
    const result = scoreRiskDisclosure(trace, [/carry\s+risk/i]);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });
});
