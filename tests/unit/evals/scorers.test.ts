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

  it("reads a compact currency range as two positive endpoints", () => {
    expect(extractFinancialNumbers("The range is $100-$200")).toEqual([100, 200]);
  });

  it("reads a spaced currency range as two positive endpoints", () => {
    expect(extractFinancialNumbers("The range is $100 - $200")).toEqual([100, 200]);
  });

  it("keeps the sign on each endpoint of a compact range", () => {
    expect(extractFinancialNumbers("-$100-$200")).toEqual([-100, 200]);
    expect(extractFinancialNumbers("$-100-$200")).toEqual([-100, 200]);
  });

  it("still reads a unary minus after a word as a loss", () => {
    expect(extractFinancialNumbers("The loss was -$200")).toEqual([-200]);
  });

  it("keeps a negative on the next line separate from the preceding currency amount", () => {
    expect(extractFinancialNumbers("$100\n-$200")).toEqual([100, -200]);
  });

  it("reads a Unicode en-dash currency range as two positive endpoints", () => {
    expect(extractFinancialNumbers("The range is $100\u2013$200")).toEqual([100, 200]);
  });

  it("keeps the sign on each endpoint of a suffixed currency range", () => {
    expect(extractFinancialNumbers("The range is $1.5M-$2M")).toEqual([1.5e6, 2e6]);
  });

  it("signs an unsigned percent negative when a decrease word is adjacent", () => {
    expect(extractFinancialNumbers("a decrease of 2.47%")).toEqual([-2.47]);
  });

  it("signs an unsigned percent negative for down, fell, dropped, declined, and loss wording", () => {
    expect(extractFinancialNumbers("down 2.47%")).toEqual([-2.47]);
    expect(extractFinancialNumbers("fell by 2.47%")).toEqual([-2.47]);
    expect(extractFinancialNumbers("dropped 2.47%")).toEqual([-2.47]);
    expect(extractFinancialNumbers("declined 2.47%")).toEqual([-2.47]);
    expect(extractFinancialNumbers("a loss of 2.47%")).toEqual([-2.47]);
  });

  it("keeps an unsigned percent positive for increase, up, gained, and rose wording", () => {
    expect(extractFinancialNumbers("an increase of 2.47%")).toEqual([2.47]);
    expect(extractFinancialNumbers("up 2.47%")).toEqual([2.47]);
    expect(extractFinancialNumbers("gained 2.47%")).toEqual([2.47]);
    expect(extractFinancialNumbers("rose 2.47%")).toEqual([2.47]);
  });

  it("leaves an unsigned percent positive when no direction word is adjacent", () => {
    expect(extractFinancialNumbers("The yield was 2.47%.")).toEqual([2.47]);
  });

  it("does not re-sign an unrelated downside phrase", () => {
    expect(extractFinancialNumbers("The downside risk leaves 2.47% of assets exposed")).toEqual([
      2.47,
    ]);
  });

  it("does not re-sign across a sentence boundary", () => {
    expect(extractFinancialNumbers("The stock is down. The yield is 2.47%.")).toEqual([2.47]);
  });

  it("signs a percent from a direction word that follows it", () => {
    expect(extractFinancialNumbers("2.47% decrease")).toEqual([-2.47]);
    expect(extractFinancialNumbers("2.47% decline")).toEqual([-2.47]);
  });

  it("prefers a preceding direction word over trailing wording", () => {
    expect(extractFinancialNumbers("up 2.47% down from yesterday")).toEqual([2.47]);
    expect(extractFinancialNumbers("down 2.47% up from yesterday")).toEqual([-2.47]);
  });

  it("does not treat a trailing level comparison as a direction", () => {
    expect(extractFinancialNumbers("2.47% down from yesterday")).toEqual([2.47]);
    expect(extractFinancialNumbers("2.47% up from 1.23%")).toEqual([2.47, 1.23]);
  });

  it("still signs a trailing change word that is not a level comparison", () => {
    expect(extractFinancialNumbers("a 2.47% decrease from last year")).toEqual([-2.47]);
    expect(extractFinancialNumbers("2.47% down today")).toEqual([-2.47]);
  });

  it("lets an explicit sign win over a contradictory direction word", () => {
    expect(extractFinancialNumbers("a decrease of +2.47%")).toEqual([2.47]);
    expect(extractFinancialNumbers("an increase of -2.47%")).toEqual([-2.47]);
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

  it("reads a compact currency range in strings", () => {
    expect(extractNumbersFromObject({ formatted: "$100-$200" })).toEqual([100, 200]);
  });

  it("reads a spaced currency range in strings", () => {
    expect(extractNumbersFromObject({ formatted: "$100 - $200" })).toEqual([100, 200]);
  });

  it("keeps the pre-existing sign on a bare-number sequence in strings", () => {
    expect(extractNumbersFromObject({ formatted: "100-200" })).toEqual([100, -200]);
    expect(extractNumbersFromObject({ formatted: "100 -200" })).toEqual([100, -200]);
    expect(extractNumbersFromObject({ formatted: "volume 1000 -$200" })).toEqual([1000, -200]);
  });

  it("keeps a negative on the next line separate from the preceding currency amount", () => {
    expect(extractNumbersFromObject({ formatted: "$100\n-$200" })).toEqual([100, -200]);
  });

  it("keeps a unary negative currency string after a word", () => {
    expect(extractNumbersFromObject({ formatted: "loss of -$200" })).toEqual([-200]);
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

  it("grounds a compact currency range against matching low/high tool evidence", () => {
    const trace = makeTrace({
      text: "The range is $100-$200",
      toolCalls: [{ name: "get_range", args: {}, result: { low: 100, high: 200 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("grounds a spaced currency range against matching low/high tool evidence", () => {
    const trace = makeTrace({
      text: "The range is $100 - $200",
      toolCalls: [{ name: "get_range", args: {}, result: { low: 100, high: 200 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("still grounds a unary negative loss after the range fix", () => {
    const trace = makeTrace({
      text: "The loss was -$240",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { change: -240 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("still fails a reversed sign after the range fix", () => {
    const trace = makeTrace({
      text: "The value was +$240",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { change: -240 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("240");
  });

  it("keeps a line-broken negative separate from the preceding currency amount", () => {
    const trace = makeTrace({
      text: "$100\n-$200",
      toolCalls: [{ name: "get_range", args: {}, result: { low: 100, change: -200 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("grounds a stated decrease against negative percent evidence", () => {
    const trace = makeTrace({
      text: "The change was a decrease of 2.47%",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { changePercent: -2.47 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("fails an increase statement against negative percent evidence", () => {
    const trace = makeTrace({
      text: "The change was an increase of 2.47%",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { changePercent: -2.47 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("2.47");
  });

  it("fails an unsigned percent without direction against negative evidence", () => {
    const trace = makeTrace({
      text: "The change was 2.47%",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { changePercent: -2.47 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("2.47");
  });

  it("fails a decrease statement against positive percent evidence", () => {
    const trace = makeTrace({
      text: "The change was a decrease of 2.47%",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { changePercent: 2.47 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("2.47");
  });

  it("does not re-sign an unrelated downside phrase in scoring", () => {
    const trace = makeTrace({
      text: "The downside risk leaves 2.47% of assets exposed",
      toolCalls: [{ name: "get_risk", args: {}, result: { exposure: 2.47 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("lets an explicit sign win over a contradictory direction word in scoring", () => {
    const trace = makeTrace({
      text: "The change was a decrease of +2.47%",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { changePercent: -2.47 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("2.47");
  });

  it("prefers a preceding direction word over trailing wording in scoring", () => {
    const upTrace = makeTrace({
      text: "up 2.47% down from yesterday",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { changePercent: 2.47 } }],
    });
    const upResult = scoreDataFaithfulness(upTrace);
    expect(upResult.passed).toBe(true);
    expect(upResult.score).toBe(1.0);

    const downTrace = makeTrace({
      text: "down 2.47% up from yesterday",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { changePercent: -2.47 } }],
    });
    const downResult = scoreDataFaithfulness(downTrace);
    expect(downResult.passed).toBe(true);
    expect(downResult.score).toBe(1.0);
  });

  it("grounds a positive yield level written as down from a higher level", () => {
    const trace = makeTrace({
      text: "The yield is 4% down from 5%",
      toolCalls: [{ name: "get_yield", args: {}, result: { yield: 4, previousYield: 5 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("grounds a positive yield level written as up from a lower level", () => {
    const trace = makeTrace({
      text: "The yield is 4% up from 3%",
      toolCalls: [{ name: "get_yield", args: {}, result: { yield: 4, previousYield: 3 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it("still fails when a trailing directional claim contradicts the evidence", () => {
    const trace = makeTrace({
      text: "The change was 2.47% down",
      toolCalls: [{ name: "get_stock_quote", args: {}, result: { changePercent: 2.47 } }],
    });
    const result = scoreDataFaithfulness(trace);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("2.47");
  });
});

describe("quote-accuracy diagnostic replay", () => {
  it("grounds the preserved AAPL quote trace whose decrease is stated in words", () => {
    // Inline replay of validation-output/eval-diagnostics/2026-09-25T02-49-29-850Z_quote-accuracy_42737-pcfcs3.json
    // (preserved live evidence; no live API call).
    const trace = makeTrace({
      prompt: "What's the current price of AAPL?",
      text: "The current price of AAPL is $335.92, a decrease of 0.33%. The market is closed as of 2026-09-24 16:00 ET.",
      toolCalls: [
        {
          name: "get_stock_quote",
          args: { symbol: "AAPL" },
          result: {
            content: [
              {
                type: "text",
                text: "AAPL: $335.92 (-0.33%)\nOpen: $336.72 | High: $338.91 | Low: $334.30\nVolume: 24,364,559 | Market Cap: N/A\n52W Range: $243.42 - $345.34\nAs of 2026-09-24 16:00 ET (market closed).",
              },
            ],
            details: {
              symbol: "AAPL",
              name: "Apple Inc.",
              price: 335.92,
              change: -1.099999999999966,
              changePercent: -0.3263901252151106,
              open: 336.7200012207031,
              high: 338.91,
              low: 334.3,
              previousClose: 337.02,
              volume: 24364559,
              marketCap: 0,
              pe: null,
              week52High: 345.34,
              week52Low: 243.42,
              extendedPrice: 335.91,
              extendedChange: -0.010009766,
              extendedChangePercent: -0.0029798062,
            },
          },
        },
      ],
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
