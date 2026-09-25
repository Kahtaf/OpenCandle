import { describe, expect, it } from "vitest";
import { DISCLAIMER_TEXT } from "../../../src/prompts/disclaimer.js";
import {
  extractFinancialNumbers,
  extractNumbersFromObject,
  scoreDataFaithfulness,
} from "../../evals/scorers/data-faithfulness.js";
import { scoreRiskDisclosure } from "../../evals/scorers/risk-disclosure.js";
import { scoreSavedMarketStateFidelity } from "../../evals/scorers/saved-market-state-fidelity.js";
import { scoreToolArguments } from "../../evals/scorers/tool-arguments.js";
import { scoreToolSelection } from "../../evals/scorers/tool-selection.js";
import { scoreWorkflowClassification } from "../../evals/scorers/workflow-classification.js";
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

  it("keeps a negative sign that precedes the dollar sign", () => {
    expect(extractFinancialNumbers("The change was -$2.50")).toEqual([-2.5]);
  });

  it("keeps a negative sign that follows the dollar sign", () => {
    expect(extractFinancialNumbers("The change was $-2.50")).toEqual([-2.5]);
  });

  it("keeps a positive sign that precedes the dollar sign", () => {
    expect(extractFinancialNumbers("The change was +$3.25")).toEqual([3.25]);
  });

  it("keeps a positive sign that follows the dollar sign", () => {
    expect(extractFinancialNumbers("The change was $+3.25")).toEqual([3.25]);
  });

  it("normalizes a financial Unicode minus before the dollar sign", () => {
    expect(extractFinancialNumbers("The change was \u2212$4.75")).toEqual([-4.75]);
  });

  it("preserves unsigned currency with commas and decimals", () => {
    expect(extractFinancialNumbers("AAPL closed at $1,234.56")).toEqual([1234.56]);
  });

  it("keeps the magnitude suffix on unsigned currency without an unsigned duplicate", () => {
    expect(extractFinancialNumbers("Revenue was $394B")).toEqual([394e9]);
  });

  it("keeps the sign and magnitude suffix without a sign-losing duplicate", () => {
    expect(extractFinancialNumbers("The raise was -$2.5B")).toEqual([-2.5e9]);
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
    expect(nums).toContain(185.5);
  });

  it("keeps a negative sign that precedes the dollar sign in strings", () => {
    const nums = extractNumbersFromObject({ formatted: "-$2.50" });
    expect(nums).toContain(-2.5);
    expect(nums).not.toContain(2.5);
  });

  it("keeps a negative sign that follows the dollar sign in strings", () => {
    expect(extractNumbersFromObject({ formatted: "$-2.50" })).toContain(-2.5);
  });

  it("keeps a positive sign on currency strings", () => {
    expect(extractNumbersFromObject({ formatted: "+$3.25" })).toContain(3.25);
  });

  it("normalizes a financial Unicode minus before the dollar sign in strings", () => {
    expect(extractNumbersFromObject({ formatted: "\u2212$4.75" })).toContain(-4.75);
  });

  it("does not drop other numeric evidence beside a signed currency string", () => {
    const nums = extractNumbersFromObject({ formatted: "-$2.50 (down 1.2%)" });
    expect(nums).toContain(-2.5);
    expect(nums).toContain(1.2);
  });

  it("extracts comma-grouped currency strings as one signed value", () => {
    expect(extractNumbersFromObject({ formatted: "$1,234.56" })).toContain(1234.56);
  });

  it("keeps the magnitude suffix on signed currency strings", () => {
    const nums = extractNumbersFromObject({ formatted: "-$2.5B" });
    expect(nums).toContain(-2.5e9);
    expect(nums).not.toContain(-2.5);
    expect(nums).not.toContain(2.5e9);
  });
});

describe("scoreDataFaithfulness", () => {
  it("scores 1.0 when all numbers grounded", () => {
    const trace = makeTrace({
      text: "AAPL is trading at $185.50",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { price: 185.5 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("flags ungrounded numbers", () => {
    const trace = makeTrace({
      text: "AAPL P/E of 28.5",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { price: 185.5 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("28.5");
  });

  it("allows values within 1% tolerance", () => {
    const trace = makeTrace({
      text: "Return of 12.1%",
      toolCalls: [{ name: "run_backtest", args: {}, result: { totalReturn: 12.0 } }],
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

  it("grounds a faithful negative change whose minus precedes the dollar sign", () => {
    const trace = makeTrace({
      text: "The change was -$4.75",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { change: -4.75 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("grounds a faithful negative change whose minus follows the dollar sign", () => {
    const trace = makeTrace({
      text: "The change was $-4.75",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { change: -4.75 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("fails when a positive currency sign is reversed versus negative tool evidence", () => {
    const trace = makeTrace({
      text: "The change was +$4.75",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { change: -4.75 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("4.75");
  });

  it("fails when a negative currency sign is reversed versus positive tool evidence", () => {
    const trace = makeTrace({
      text: "The change was -$4.75",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { change: 4.75 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("4.75");
  });

  it("does not ignore an incorrect dollar-then-minus amount", () => {
    const trace = makeTrace({
      text: "The change was $-9.25",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { change: -4.75 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("9.25");
  });

  it("preserves 1% tolerance for signed values", () => {
    const trace = makeTrace({
      text: "The change was -$4.73",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { change: -4.75 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(true);
  });

  it("grounds a signed currency amount that carries a magnitude suffix", () => {
    const trace = makeTrace({
      text: "The raise was -$2.5B",
      toolCalls: [{ name: "get_fundamentals", args: {}, result: { change: -2.5e9 } }],
    });
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

  it("checks custom responseContains patterns against OpenCandle disclaimer entries", () => {
    const trace = makeTrace({
      text: "AAPL looks strong based on the current analysis.",
      customEntries: [
        {
          customType: "opencandle-disclaimer",
          data: { text: DISCLAIMER_TEXT },
          timestamp: "2026-05-17T00:00:00.000Z",
        },
      ],
    });
    const result = scoreRiskDisclosure(trace, [
      /not\s+financial\s+advice|consult\s+.*(?:advisor|professional)|disclaimer/i,
    ]);
    expect(result.passed).toBe(true);
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

describe("scoreSavedMarketStateFidelity", () => {
  it("passes when route context carries saved state, avoids portfolio_builder, and final text quotes fixture values", () => {
    const trace = makeTrace({
      classification: {
        workflow: "general_finance_qa",
        confidence: 0.9,
        tier: "llm",
        entities: { symbols: ["SPY", "AAPL", "XLE"] },
      },
      router: {
        routeKind: "agent_task",
        workflow: "general_finance_qa",
      },
      planning: {
        structuredCheckIds: [],
        workspacePlaceholderIds: [],
        artifactPlaceholderIds: [],
        capabilityGapIds: [],
        evidenceRecords: [],
        structuredCheckResults: [],
        structuredCheckFailures: [],
        retryEligibility: { eligible: false, activeRetryAllowed: false, reasons: [] },
        taskFamily: "portfolio_review",
      },
      customEntries: [
        {
          customType: "opencandle-route-context",
          timestamp: "2026-07-04T00:00:00.000Z",
          data: {
            savedMarketStateSummary:
              "Portfolio lots:\n- SPY: 60 @ $480.00, cost basis $28800.00\n- AAPL: 40 @ $175.00\n- XLE: 100 @ $85.00",
          },
        },
      ],
      text: "Your SPY lot is 60 shares at $480.00, for a $28,800.00 cost basis.",
    });

    const result = scoreSavedMarketStateFidelity(trace, {
      requiredSummarySymbols: ["SPY", "AAPL", "XLE"],
      requiredSummaryValues: ["$480", "$175", "$85"],
      requiredFinalValues: ["60", "$480", "$28,800"],
      forbiddenWorkflow: "portfolio_builder",
      expectedTaskFamily: "portfolio_review",
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
  });

  it("fails with specific messages when saved-state evidence or fixture values are missing", () => {
    const trace = makeTrace({
      classification: {
        workflow: "portfolio_builder",
        confidence: 0.9,
        tier: "llm",
        entities: { symbols: [] },
      },
      text: "I can build a new portfolio.",
      customEntries: [
        {
          customType: "opencandle-route-context",
          timestamp: "2026-07-04T00:00:00.000Z",
          data: { routeKind: "workflow_dispatch" },
        },
      ],
    });

    const result = scoreSavedMarketStateFidelity(trace, {
      requiredSummarySymbols: ["SPY"],
      requiredSummaryValues: ["60", "$480"],
      requiredFinalValues: ["$480"],
      forbiddenWorkflow: "portfolio_builder",
      expectedTaskFamily: "portfolio_review",
    });

    expect(result.passed).toBe(false);
    expect(result.message).toContain("forbidden workflow portfolio_builder");
    expect(result.message).toContain("saved-state summary missing SPY");
    expect(result.message).toContain("saved-state summary missing 60");
    expect(result.message).toContain("final text missing $480");
  });
});
