import { describe, expect, it } from "vitest";
import { PRODUCT_EVAL_CASES, PRODUCT_SCENARIO_TEMPLATES } from "../../evals/product/cases.js";
import { productEvalExitCode } from "../../evals/product/reporting.js";
import { scoreProductEvalCase, summarizeProductEvalResults } from "../../evals/product/scorer.js";
import type { ProductEvalCase } from "../../evals/product/types.js";
import type { EvalTrace } from "../../evals/types.js";

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
        requiredPatterns: [
          /6[- ]?month|six[- ]?month|6mo/i,
          /catalyst|earnings|guidance|estimate|sentiment/i,
        ],
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
    expect(result.dimensions.find((dimension) => dimension.id === "horizon_fit")?.passed).toBe(
      false,
    );
  });

  it("aggregates scores by prompt family and dimension", () => {
    const passed = scoreProductEvalCase(
      compareCase,
      makeTrace({
        toolCalls: [
          { name: "get_stock_quote", args: {} },
          { name: "compare_companies", args: {} },
          { name: "analyze_risk", args: {} },
        ],
        text:
          "Yes, these are reasonable to compare for a 6-month horizon. " +
          "Focus on catalysts, earnings guidance, sentiment, and unavailable data gaps.",
      }),
    );
    const failed = scoreProductEvalCase(
      { ...compareCase, id: "second-case", family: "single_asset" },
      makeTrace({
        classification: { ...makeTrace().classification, workflow: "single_asset_analysis" },
      }),
    );

    const summary = summarizeProductEvalResults([passed, failed]);

    expect(summary.caseCount).toBe(2);
    expect(summary.byFamily.compare_assets.caseCount).toBe(1);
    expect(summary.byFamily.single_asset.caseCount).toBe(1);
    expect(summary.byDimension.horizon_fit.passed).toBe(1);
    expect(summary.byDimension.horizon_fit.failed).toBe(1);
  });

  it("passes a direct decision answer that uses hold/prefer language", () => {
    const singleAssetCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "single-asset-nvda-recommendation",
    );
    if (!singleAssetCase) throw new Error("missing single asset eval case");

    const result = scoreProductEvalCase(
      singleAssetCase,
      makeTrace({
        classification: { ...makeTrace().classification, workflow: "single_asset_analysis" },
        toolCalls: [{ name: "get_stock_quote", args: { symbol: "NVDA" } }],
        text:
          "Hold NVDA rather than add aggressively here. Price momentum and earnings evidence are mixed, " +
          "so I would prefer waiting for a better entry while watching downside risk.",
      }),
    );

    expect(result.dimensions.find((dimension) => dimension.id === "direct_answer")?.passed).toBe(
      true,
    );
    expect(result.passed).toBe(true);
  });

  it("does not count a commitment heading alone as a direct answer", () => {
    const portfolioCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "portfolio-balanced-50k",
    );
    if (!portfolioCase) throw new Error("missing portfolio eval case");

    const result = scoreProductEvalCase(
      portfolioCase,
      makeTrace({
        classification: { ...makeTrace().classification, workflow: "portfolio_builder" },
        toolCalls: [{ name: "get_stock_quote", args: { symbol: "VOO" } }],
        text:
          "Commitment: This draft portfolio allocates $50,000 across diversified ETFs for a 3 year horizon. " +
          "It balances growth and stability, names duration and volatility risk, and includes an invalidation condition.",
      }),
    );

    expect(result.dimensions.find((dimension) => dimension.id === "direct_answer")?.passed).toBe(
      false,
    );
  });

  it("counts a concrete portfolio allocation table as a direct construction answer", () => {
    const portfolioCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "portfolio-balanced-50k",
    );
    if (!portfolioCase) throw new Error("missing portfolio eval case");

    const result = scoreProductEvalCase(
      portfolioCase,
      makeTrace({
        classification: { ...makeTrace().classification, workflow: "portfolio_builder" },
        toolCalls: [{ name: "get_stock_quote", args: { symbol: "VOO" } }],
        text:
          "**Draft Portfolio Allocation**\n\n" +
          "| Symbol | Allocation % | Dollar Amount | Role |\n" +
          "| VOO | 20% | $10,000 | Core equity |\n" +
          "| BND | 40% | $20,000 | Core fixed income |\n" +
          "Why this fits the horizon: this is appropriate for a 3-year horizon with stability and downside protection.",
      }),
    );

    expect(result.dimensions.find((dimension) => dimension.id === "direct_answer")?.passed).toBe(
      true,
    );
    expect(result.dimensions.find((dimension) => dimension.id === "horizon_fit")?.passed).toBe(
      true,
    );
  });

  it("counts explicit portfolio-construction language as a direct answer", () => {
    const portfolioCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "portfolio-balanced-50k",
    );
    if (!portfolioCase) throw new Error("missing portfolio eval case");

    const result = scoreProductEvalCase(
      portfolioCase,
      makeTrace({
        classification: { ...makeTrace().classification, workflow: "portfolio_builder" },
        toolCalls: [{ name: "get_stock_quote", args: { symbol: "VOO" } }],
        text:
          "Bottom line: I would build a $50,000 diversified ETF portfolio for a 3 year horizon. " +
          "It balances growth and stability, names duration and volatility risk, and includes an invalidation condition.",
      }),
    );

    expect(result.dimensions.find((dimension) => dimension.id === "direct_answer")?.passed).toBe(
      true,
    );
    expect(result.dimensions.find((dimension) => dimension.id === "horizon_fit")?.passed).toBe(
      true,
    );
  });

  it("recognizes 30-day option horizons but not incomplete/caution wording alone as risk framing", () => {
    const optionsCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "options-aapl-covered-call",
    );
    const sentimentCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "sentiment-market-ai-stocks",
    );
    if (!optionsCase || !sentimentCase) throw new Error("missing eval case");

    const options = scoreProductEvalCase(
      optionsCase,
      makeTrace({
        classification: { ...makeTrace().classification, workflow: "options_screener" },
        toolCalls: [{ name: "get_option_chain", args: { symbol: "AAPL" } }],
        text: "Screen these 30-day covered calls by DTE, time decay, premium, delta, and downside risk.",
      }),
    );
    const sentiment = scoreProductEvalCase(
      sentimentCase,
      makeTrace({
        toolCalls: [{ name: "get_sentiment_summary", args: { query: "AI stocks" } }],
        text: "Bottom line: sentiment is leaning bearish, but Twitter and Reddit are missing, so the picture is incomplete and should be treated with caution.",
      }),
    );

    expect(options.dimensions.find((dimension) => dimension.id === "horizon_fit")?.passed).toBe(
      true,
    );
    expect(sentiment.dimensions.find((dimension) => dimension.id === "risk_framing")?.passed).toBe(
      false,
    );
  });

  it("recognizes option expiry windows and sentiment confidence downgrades without fixed keyword prompts", () => {
    const optionsCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "options-aapl-covered-call",
    );
    const sentimentCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "sentiment-market-ai-stocks",
    );
    if (!optionsCase || !sentimentCase) throw new Error("missing eval case");

    const options = scoreProductEvalCase(
      optionsCase,
      makeTrace({
        classification: { ...makeTrace().classification, workflow: "options_screener" },
        toolCalls: [{ name: "get_option_chain", args: { symbol: "AAPL" } }],
        text:
          "Here are covered call candidates targeting roughly one month (32 days) to expiration. " +
          "The table includes premium, delta, open interest, and assignment risk.",
      }),
    );
    const sentiment = scoreProductEvalCase(
      sentimentCase,
      makeTrace({
        toolCalls: [{ name: "get_sentiment_summary", args: { query: "AI stocks" } }],
        text:
          "Sentiment summary for AI stocks is unavailable because no sources returned data. " +
          "Missing sources: Twitter, Reddit, and web/news. Their absence significantly downgrades confidence.",
      }),
    );

    expect(options.dimensions.find((dimension) => dimension.id === "horizon_fit")?.passed).toBe(
      true,
    );
    expect(sentiment.dimensions.find((dimension) => dimension.id === "risk_framing")?.passed).toBe(
      true,
    );
  });

  it("recognizes plural risk headings in education answers", () => {
    const educationCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "education-options-greeks",
    );
    if (!educationCase) throw new Error("missing education eval case");

    const result = scoreProductEvalCase(
      educationCase,
      makeTrace({
        text:
          "Bottom line: delta is price sensitivity and theta is time decay. " +
          "Main risks: option buyers can lose money if the move is too slow, and sellers face assignment risks.",
      }),
    );

    expect(result.dimensions.find((dimension) => dimension.id === "risk_framing")?.passed).toBe(
      true,
    );
  });

  it("scores E5 ambiguous cases with exactly one focused ask_user and no guessed symbol", () => {
    const ambiguousCallsCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "ask-vs-guess-ambiguous-sell-my-calls",
    );
    if (!ambiguousCallsCase) throw new Error("missing E5 ambiguous calls eval case");

    const result = scoreProductEvalCase(
      ambiguousCallsCase,
      makeTrace({
        classification: {
          ...makeTrace().classification,
          workflow: "options_screener",
          entities: { symbols: [] },
        },
        askUserTranscript: [
          { question: "Which call position do you mean: NVDA or AMD?", answer: "the NVDA calls" },
        ],
        text: "Which call position should I evaluate? Selling calls can lock in gains but carries timing risk.",
      }),
    );

    expect(
      result.dimensions.find((dimension) => dimension.id === "ask_instead_of_guess"),
    ).toMatchObject({
      passed: true,
    });
    expect(
      result.dimensions.find((dimension) => dimension.id === "ambiguous_calls_no_guess"),
    ).toMatchObject({ passed: true });
  });

  it("fails E5 ambiguous cases when the agent over-asks or guesses a seeded option symbol", () => {
    const ambiguousCallsCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "ask-vs-guess-ambiguous-sell-my-calls",
    );
    if (!ambiguousCallsCase) throw new Error("missing E5 ambiguous calls eval case");

    const result = scoreProductEvalCase(
      ambiguousCallsCase,
      makeTrace({
        classification: {
          ...makeTrace().classification,
          workflow: "options_screener",
          entities: { symbols: ["NVDA"] },
        },
        askUserTranscript: [
          { question: "Which calls?", answer: "NVDA" },
          { question: "What expiry?", answer: "January" },
        ],
        toolCalls: [{ name: "get_option_chain", args: { symbol: "NVDA" } }],
        text: "I will assume you meant NVDA calls.",
      }),
    );

    expect(
      result.dimensions.find((dimension) => dimension.id === "ask_instead_of_guess"),
    ).toMatchObject({ passed: false });
    expect(
      result.dimensions.find((dimension) => dimension.id === "ambiguous_calls_no_guess"),
    ).toMatchObject({ passed: false });
  });

  it("scores E5 resolvable twins with zero ask_user and correct prior-turn symbol resolution", () => {
    const resolvableBanksCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "ask-vs-guess-prior-turn-compare-the-banks",
    );
    if (!resolvableBanksCase) throw new Error("missing E5 resolvable banks eval case");

    const result = scoreProductEvalCase(
      resolvableBanksCase,
      makeTrace({
        classification: {
          ...makeTrace().classification,
          workflow: "compare_assets",
          entities: { symbols: ["JPM", "BAC"] },
        },
        askUserTranscript: [],
        toolCalls: [
          { name: "get_stock_quote", args: { symbol: "JPM" } },
          { name: "get_stock_quote", args: { symbol: "BAC" } },
        ],
        text: "Compare JPM and BAC directly. Both carry rate, credit, deposit beta, and recession downside risks.",
      }),
    );

    expect(
      result.dimensions.find((dimension) => dimension.id === "no_unneeded_clarification"),
    ).toMatchObject({ passed: true });
    expect(
      result.dimensions.find((dimension) => dimension.id === "prior_turn_banks_resolution"),
    ).toMatchObject({ passed: true });
  });

  it("maps failed product eval reports to a failing process exit code", () => {
    expect(productEvalExitCode({ failed: 0 })).toBe(0);
    expect(productEvalExitCode({ failed: 1 })).toBe(1);
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
    const compareCases = PRODUCT_EVAL_CASES.filter(
      (evalCase) => evalCase.templateId === "compare_assets_with_horizon",
    );
    expect(compareCases.map((evalCase) => evalCase.prompt).join("\n")).toMatch(/AAPL|SPY|BTC/i);
    expect(compareCases.map((evalCase) => evalCase.prompt).join("\n")).toMatch(/MSFT|QQQ|GLD/i);
  });

  it("defines E5 ask-vs-guess cases as paired ambiguous and resolvable twins", () => {
    const e5Cases = PRODUCT_EVAL_CASES.filter((evalCase) =>
      evalCase.id.startsWith("ask-vs-guess-"),
    );

    expect(e5Cases.map((evalCase) => evalCase.id).sort()).toEqual([
      "ask-vs-guess-ambiguous-compare-the-banks",
      "ask-vs-guess-ambiguous-sell-my-calls",
      "ask-vs-guess-prior-turn-compare-the-banks",
      "ask-vs-guess-prior-turn-sell-my-calls",
    ]);
    expect(e5Cases.every((evalCase) => evalCase.tier === "opt-in")).toBe(true);
    expect(
      e5Cases.filter((evalCase) => evalCase.prompts && evalCase.prompts.length > 1),
    ).toHaveLength(2);
    expect(
      e5Cases.filter(
        (evalCase) => evalCase.setup?.marketStateFixture === "e5_two_option_positions",
      ),
    ).toHaveLength(2);
  });
});
