import { describe, expect, it } from "vitest";
import type { EvalTrace } from "../../evals/types.js";
import type { ProductEvalCase } from "../../evals/product/types.js";
import { PRODUCT_EVAL_CASES, PRODUCT_SCENARIO_TEMPLATES } from "../../evals/product/cases.js";
import { scoreProductEvalCase, summarizeProductEvalResults } from "../../evals/product/scorer.js";

function makeTrace(overrides: Partial<EvalTrace> = {}): EvalTrace {
  return {
    prompt: "test prompt",
    classification: {
      workflow: "compare_assets",
      confidence: 0.9,
      tier: "llm",
      entities: { symbols: ["AAPL", "MSFT"], timeHorizon: "6mo" },
    },
    toolCalls: [],
    askUserTranscript: [],
    text: "",
    ...overrides,
  };
}

describe("product eval scoring", () => {
  const compareCase: ProductEvalCase = {
    id: "compare-assets-horizon-synthetic",
    family: "compare_assets",
    prompt: "Should I compare AAPL and MSFT for a 6 month investment horizon?",
    assertions: {
      expectedWorkflow: "compare_assets",
    },
    dimensions: [
      {
        id: "direct_answer",
        description: "Directly answers whether the comparison is valid.",
        requiredPatterns: [/reasonable to compare|should compare|valid to compare/i],
        mandatory: true,
      },
      {
        id: "horizon_fit",
        description: "Adapts evidence to the six-month horizon.",
        requiredPatterns: [/6[- ]?month|six[- ]?month|6mo/i, /catalyst|earnings|guidance|estimate|sentiment/i],
        mandatory: true,
      },
      {
        id: "evidence_selection",
        description: "Uses the relevant comparison evidence tools.",
        requiredToolNames: ["get_stock_quote", "compare_companies", "analyze_risk"],
      },
      {
        id: "missing_data_honesty",
        description: "Flags unavailable evidence.",
        requiredPatterns: [/unavailable|missing|not available|data gap/i],
      },
    ],
  };

  it("passes reusable dimensions when the trace answers the product behavior", () => {
    const trace = makeTrace({
      toolCalls: [
        { name: "get_stock_quote", args: { symbol: "AAPL" } },
        { name: "compare_companies", args: { symbols: ["AAPL", "MSFT"] } },
        { name: "analyze_risk", args: { symbol: "AAPL" } },
      ],
      text:
        "Yes, AAPL and MSFT are reasonable to compare for a 6-month horizon. " +
        "The most important evidence is near-term catalysts, earnings guidance, estimate revisions, and sentiment. " +
        "Some forward-looking data is unavailable, so treat it as a data gap.",
    });

    const result = scoreProductEvalCase(compareCase, trace);

    expect(result.score).toBe(1);
    expect(result.mandatoryFailure).toBe(false);
    expect(result.dimensions.every((dimension) => dimension.passed)).toBe(true);
  });

  it("fails mandatory dimensions when the answer is only a historical metric comparison", () => {
    const trace = makeTrace({
      toolCalls: [
        { name: "get_stock_quote", args: { symbol: "AAPL" } },
        { name: "analyze_risk", args: { symbol: "AAPL" } },
      ],
      text: "AAPL has a better Sharpe ratio and lower max drawdown than MSFT.",
    });

    const result = scoreProductEvalCase(compareCase, trace);

    expect(result.score).toBeLessThan(0.6);
    expect(result.mandatoryFailure).toBe(true);
    expect(result.dimensions.find((dimension) => dimension.id === "horizon_fit")?.passed).toBe(false);
  });

  it("aggregates scores by prompt family and dimension", () => {
    const passed = scoreProductEvalCase(compareCase, makeTrace({
      toolCalls: [
        { name: "get_stock_quote", args: {} },
        { name: "compare_companies", args: {} },
        { name: "analyze_risk", args: {} },
      ],
      text:
        "Yes, these are reasonable to compare for a 6-month horizon. " +
        "Focus on catalysts, earnings guidance, sentiment, and unavailable data gaps.",
    }));
    const failed = scoreProductEvalCase(
      { ...compareCase, id: "second-case", family: "single_asset" },
      makeTrace({ classification: { ...makeTrace().classification, workflow: "single_asset_analysis" } }),
    );

    const summary = summarizeProductEvalResults([passed, failed]);

    expect(summary.caseCount).toBe(2);
    expect(summary.byFamily.compare_assets.caseCount).toBe(1);
    expect(summary.byFamily.single_asset.caseCount).toBe(1);
    expect(summary.byDimension.horizon_fit.passed).toBe(1);
    expect(summary.byDimension.horizon_fit.failed).toBe(1);
  });
});

describe("product eval cases", () => {
  it("defines reusable scenario templates across OpenCandle prompt families", () => {
    expect(PRODUCT_SCENARIO_TEMPLATES.map((template) => template.family)).toEqual([
      "compare_assets",
      "single_asset",
      "portfolio",
      "options",
      "sentiment",
      "macro",
      "education",
    ]);
  });

  it("seeds every scenario template with at least two concrete cases", () => {
    for (const template of PRODUCT_SCENARIO_TEMPLATES) {
      const cases = PRODUCT_EVAL_CASES.filter((evalCase) => evalCase.templateId === template.id);
      expect(cases.length, template.id).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps dimensions reusable instead of binding them to one symbol pair", () => {
    const compareCases = PRODUCT_EVAL_CASES.filter((evalCase) => evalCase.templateId === "compare_assets_with_horizon");
    expect(compareCases.map((evalCase) => evalCase.prompt).join("\n")).toMatch(/AAPL|SPY|BTC/i);
    expect(compareCases.map((evalCase) => evalCase.prompt).join("\n")).toMatch(/MSFT|QQQ|GLD/i);
  });
});
