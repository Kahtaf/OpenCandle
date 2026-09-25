import { describe, expect, it } from "vitest";
import { PRODUCT_EVAL_CASES, PRODUCT_SCENARIO_TEMPLATES } from "../../evals/product/cases.js";
import { productEvalExitCode } from "../../evals/product/reporting.js";
import { scoreProductEvalCase, summarizeProductEvalResults } from "../../evals/product/scorer.js";
import type {
  ProductEvalCase,
  ProductEvalCaseResult,
  ProductEvalReport,
} from "../../evals/product/types.js";
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

// Fixtures are constructed explicitly per case, not derived from one another
// by spreading a "valid" base. Each report declares its own summary counts, so
// an invalid fixture cannot accidentally inherit a consistent summary.
function caseResult(input: {
  id: string;
  passed: boolean | undefined;
  mandatoryFailure: boolean | undefined;
}): ProductEvalCaseResult {
  return {
    id: input.id,
    family: "single_asset",
    prompt: `prompt for ${input.id}`,
    score: input.passed === true ? 1 : 0,
    passed: input.passed as boolean,
    mandatoryFailure: input.mandatoryFailure as boolean,
    dimensions: [],
  };
}

function reportFixture(input: {
  results: ProductEvalCaseResult[];
  caseCount: number;
  passed: number;
  failed: number;
}): ProductEvalReport {
  return {
    generatedAt: "2026-07-05T00:00:00.000Z",
    aggregate: input.caseCount > 0 ? input.passed / input.caseCount : 0,
    caseCount: input.caseCount,
    passed: input.passed,
    failed: input.failed,
    byFamily: {},
    byDimension: {},
    results: input.results,
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

  // A mandatory dimension failure is not the only way a case can be wrong: an
  // emitted non-mandatory dimension (for example evidence_use or
  // missing_data_honesty) can fail while the weighted score still clears 0.8.
  // The case must still block; `mandatoryFailure` stays as a diagnostic subtype.
  const nonMandatoryCase: ProductEvalCase = {
    id: "non-mandatory-masking-synthetic",
    family: "single_asset",
    prompt: "isolated product scorer fixture",
    dimensions: [
      {
        id: "direct_answer",
        description: "Answers directly.",
        requiredPatterns: [/\bhold\b/i],
        mandatory: true,
      },
      {
        id: "risk_framing",
        description: "Names risk.",
        requiredPatterns: [/\brisks?\b/i],
        mandatory: true,
      },
      {
        id: "evidence_use",
        description: "Uses concrete evidence.",
        requiredPatterns: [/\bpositive catalyst\b/i],
        weight: 0.25,
      },
    ],
  };

  it("fails a partially failed non-mandatory dimension even when the weighted score clears the threshold", () => {
    const result = scoreProductEvalCase(
      nonMandatoryCase,
      makeTrace({ text: "I would hold here; downside risk is elevated." }),
    );

    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.mandatoryFailure).toBe(false);
    expect(
      result.dimensions.filter((dimension) => !dimension.passed).map((dimension) => dimension.id),
    ).toEqual(["evidence_use"]);
    expect(result.passed).toBe(false);
  });

  it("passes the same case when every emitted dimension passes", () => {
    const result = scoreProductEvalCase(
      nonMandatoryCase,
      makeTrace({
        text: "I would hold here; downside risk is elevated and the positive catalyst supports it.",
      }),
    );

    expect(result.mandatoryFailure).toBe(false);
    expect(result.dimensions.every((dimension) => dimension.passed)).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("propagates a non-mandatory dimension failure to a failing product eval exit code", () => {
    const result = scoreProductEvalCase(
      nonMandatoryCase,
      makeTrace({ text: "I would hold here; downside risk is elevated." }),
    );
    const summary = summarizeProductEvalResults([result]);

    expect(productEvalExitCode({ ...summary, results: [result] })).toBe(1);
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

  it("recognizes direct comparative verdicts and sentiment ratings", () => {
    const compareCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "compare-assets-aapl-msft-6mo",
    );
    const sentimentCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "sentiment-market-ai-stocks",
    );
    if (!compareCase || !sentimentCase) throw new Error("missing product eval case");

    const comparison = scoreProductEvalCase(
      compareCase,
      makeTrace({
        text: "For this six-month comparison, MSFT appears more attractive than AAPL.",
      }),
    );
    const sentiment = scoreProductEvalCase(
      sentimentCase,
      makeTrace({ text: "Sentiment for AI stocks is leaning bullish." }),
    );
    const resilientComparison = scoreProductEvalCase(
      compareCase,
      makeTrace({
        text: "BTC is positioned as a slightly more resilient option compared to GLD.",
      }),
    );
    const preferredComparison = scoreProductEvalCase(
      compareCase,
      makeTrace({ text: "Bitcoin is preferred over gold for this six-month hedge." }),
    );
    const suitableComparison = scoreProductEvalCase(
      compareCase,
      makeTrace({ text: "GLD is the more suitable choice over Bitcoin for this macro hedge." }),
    );

    expect(
      comparison.dimensions.find((dimension) => dimension.id === "direct_answer")?.passed,
    ).toBe(true);
    expect(sentiment.dimensions.find((dimension) => dimension.id === "direct_answer")?.passed).toBe(
      true,
    );
    expect(
      resilientComparison.dimensions.find((dimension) => dimension.id === "direct_answer")?.passed,
    ).toBe(true);
    expect(
      preferredComparison.dimensions.find((dimension) => dimension.id === "direct_answer")?.passed,
    ).toBe(true);
    expect(
      suitableComparison.dimensions.find((dimension) => dimension.id === "direct_answer")?.passed,
    ).toBe(true);
  });

  it("recognizes direct macro impact and risk conclusions", () => {
    const ratesCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "macro-rates-growth-stocks",
    );
    const riskCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "macro-inflation-portfolio-risk",
    );
    if (!ratesCase || !riskCase) throw new Error("missing macro eval cases");

    const rates = scoreProductEvalCase(
      ratesCase,
      makeTrace({
        text: "Positive impact: falling rates benefit growth stocks, but recession risk can hurt.",
      }),
    );
    const risks = scoreProductEvalCase(
      riskCase,
      makeTrace({
        text: "The most significant macro risks are persistent inflation and recession downside.",
      }),
    );

    expect(rates.dimensions.find((dimension) => dimension.id === "direct_answer")?.passed).toBe(
      true,
    );
    expect(risks.dimensions.find((dimension) => dimension.id === "direct_answer")?.passed).toBe(
      true,
    );
  });

  it("recognizes a complete bull-bear thesis without forcing a trade call", () => {
    const bullBearCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "single-asset-tsla-bull-bear",
    );
    if (!bullBearCase) throw new Error("missing bull-bear eval case");

    const result = scoreProductEvalCase(
      bullBearCase,
      makeTrace({
        classification: { ...makeTrace().classification, workflow: "single_asset_analysis" },
        toolCalls: [{ name: "get_stock_quote", args: { symbol: "TSLA" } }],
        text:
          "Bull case: earnings growth and improving margins support the valuation. " +
          "Bear case: price competition creates downside and volatility risk. " +
          "What would change the thesis: sustained margin expansion or a demand miss.",
      }),
    );

    expect(result.dimensions.find((dimension) => dimension.id === "direct_answer")?.passed).toBe(
      true,
    );
  });

  it("recognizes macro-hedge horizon analysis without options or earnings language", () => {
    const macroHedgeCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "compare-assets-btc-gld-macro-hedge",
    );
    if (!macroHedgeCase) throw new Error("missing macro hedge eval case");

    const result = scoreProductEvalCase(
      macroHedgeCase,
      makeTrace({
        classification: {
          ...makeTrace().classification,
          entities: {
            symbols: ["BTC", "GLD"],
            timeHorizon: "6mo",
            compareMetrics: ["macro_hedge"],
          },
        },
        text: "For the next 6 months, GLD is the steadier macro hedge during liquidity stress, while BTC is the higher-volatility debasement hedge.",
      }),
    );

    expect(result.dimensions.find((dimension) => dimension.id === "horizon_fit")?.passed).toBe(
      true,
    );
    expect(result.dimensions.find((dimension) => dimension.id === "tool_selection")?.passed).toBe(
      false,
    );

    const toolBackedResult = scoreProductEvalCase(
      macroHedgeCase,
      makeTrace({
        classification: {
          ...makeTrace().classification,
          entities: {
            symbols: ["BTC", "GLD"],
            timeHorizon: "6mo",
            compareMetrics: ["macro_hedge"],
          },
        },
        toolCalls: [
          { name: "get_crypto_price", args: { symbol: "BTC" } },
          { name: "get_stock_quote", args: { symbol: "GLD" } },
        ],
        text: "GLD is the more suitable macro hedge for the next 6 months during liquidity stress.",
      }),
    );
    expect(
      toolBackedResult.dimensions.find((dimension) => dimension.id === "tool_selection")?.passed,
    ).toBe(true);
  });

  it("recognizes an options candidate described by its day count inside the target window", () => {
    const optionsCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "options-aapl-covered-call",
    );
    if (!optionsCase) throw new Error("missing options eval case");

    const result = scoreProductEvalCase(
      optionsCase,
      makeTrace({
        classification: {
          ...makeTrace().classification,
          workflow: "options_screener",
          entities: { symbols: ["AAPL"], dteHint: "30d" },
        },
        toolCalls: [{ name: "get_option_chain", args: { symbol: "AAPL" } }],
        text: "Sell the covered call only if live liquidity is sound. It has a 36-day period, with assignment and downside risk.",
      }),
    );

    expect(result.dimensions.find((dimension) => dimension.id === "horizon_fit")?.passed).toBe(
      true,
    );
  });

  it("recognizes a prose DTE window and table-style DTE values", () => {
    const optionsCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "options-aapl-covered-call",
    );
    if (!optionsCase) throw new Error("missing options eval case");

    const result = scoreProductEvalCase(
      optionsCase,
      makeTrace({
        classification: {
          ...makeTrace().classification,
          workflow: "options_screener",
          entities: { symbols: ["AAPL"], dteHint: "30d" },
        },
        toolCalls: [{ name: "get_option_chain", args: { symbol: "AAPL" } }],
        text:
          "Target DTE window: 25 to 45 days. | Strike | Expiry | DTE | Premium |\n" +
          "| $305 | 2026-09-18 | 36 | $9.10 | Assignment and downside risk apply.",
      }),
    );

    expect(result.dimensions.find((dimension) => dimension.id === "horizon_fit")?.passed).toBe(
      true,
    );
  });

  it("requires missing-data disclosure only when a tool reports an observed gap", () => {
    const comparisonCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "compare-assets-aapl-msft-6mo",
    );
    if (!comparisonCase) throw new Error("missing comparison eval case");

    const available = scoreProductEvalCase(
      comparisonCase,
      makeTrace({
        toolCalls: [
          {
            name: "get_stock_quote",
            args: { symbol: "AAPL" },
            result: { content: [{ type: "text", text: "AAPL tracking error: 0.1%" }] },
            isError: false,
          },
        ],
        text: "MSFT appears more attractive for this 6-month comparison.",
      }),
    );
    const unavailable = scoreProductEvalCase(
      comparisonCase,
      makeTrace({
        toolCalls: [
          {
            name: "get_stock_quote",
            args: { symbol: "AAPL" },
            result: { content: [{ type: "text", text: "Stock quote unavailable for AAPL" }] },
            isError: true,
          },
        ],
        text: "MSFT appears more attractive for this 6-month comparison.",
      }),
    );

    expect(
      available.dimensions.find((dimension) => dimension.id === "missing_data_honesty")?.passed,
    ).toBe(true);
    expect(
      unavailable.dimensions.find((dimension) => dimension.id === "missing_data_honesty")?.passed,
    ).toBe(false);
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

  it("accepts the preserved live NVDA answer's past-tense recommendation", () => {
    const nvdaCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "single-asset-nvda-recommendation",
    );
    if (!nvdaCase) throw new Error("missing single-asset nvda eval case");

    const result = scoreProductEvalCase(
      nvdaCase,
      makeTrace({
        classification: {
          ...makeTrace().classification,
          workflow: "general_finance_qa",
          entities: { symbols: ["NVDA"] },
        },
        toolCalls: [{ name: "get_stock_quote", args: { symbol: "NVDA" } }],
        // Faithful excerpt of the 2026-09-25T00:24 live answer.
        text:
          "Given the current market context for NVDA, a **Neutral to Cautious** stance is recommended. " +
          "Valuation models suggest overvaluation and risk metrics are elevated, so downside risk matters.",
      }),
    );

    expect(result.dimensions.find((dimension) => dimension.id === "direct_answer")?.passed).toBe(
      true,
    );
  });

  it("accepts a recommendation verb in unrelated symbol and text", () => {
    const nvdaCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "single-asset-nvda-recommendation",
    );
    if (!nvdaCase) throw new Error("missing single-asset nvda eval case");

    const result = scoreProductEvalCase(
      nvdaCase,
      makeTrace({
        classification: {
          ...makeTrace().classification,
          workflow: "general_finance_qa",
          entities: { symbols: ["MSFT"] },
        },
        toolCalls: [{ name: "get_stock_quote", args: { symbol: "MSFT" } }],
        text: "For MSFT, holding is recommended because valuation and downside risk are elevated.",
      }),
    );

    expect(result.dimensions.find((dimension) => dimension.id === "direct_answer")?.passed).toBe(
      true,
    );
  });

  it("does not treat the noun 'recommendation' alone as a direct answer", () => {
    const nvdaCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "single-asset-nvda-recommendation",
    );
    if (!nvdaCase) throw new Error("missing single-asset nvda eval case");

    const result = scoreProductEvalCase(
      nvdaCase,
      makeTrace({
        classification: {
          ...makeTrace().classification,
          workflow: "general_finance_qa",
          entities: { symbols: ["NVDA"] },
        },
        toolCalls: [{ name: "get_stock_quote", args: { symbol: "NVDA" } }],
        text: "A recommendation cannot be given without more information about your goals and risk tolerance.",
      }),
    );

    expect(result.dimensions.find((dimension) => dimension.id === "direct_answer")?.passed).toBe(
      false,
    );
  });

  it("documents that a bare 'no' token still satisfies direct_answer (pre-existing limitation)", () => {
    const nvdaCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "single-asset-nvda-recommendation",
    );
    if (!nvdaCase) throw new Error("missing single-asset nvda eval case");

    const result = scoreProductEvalCase(
      nvdaCase,
      makeTrace({
        classification: {
          ...makeTrace().classification,
          workflow: "general_finance_qa",
          entities: { symbols: ["NVDA"] },
        },
        toolCalls: [{ name: "get_stock_quote", args: { symbol: "NVDA" } }],
        text: "No recommendation can be given without more information about your goals and risk tolerance.",
      }),
    );

    // The pre-existing "no" alternative in the direct-answer regex matches
    // here even though this is an explicit refusal, not a stance. Recorded as a
    // known limitation rather than widened in this fix.
    expect(result.dimensions.find((dimension) => dimension.id === "direct_answer")?.passed).toBe(
      true,
    );
  });

  it("still fails a single-asset answer that only lists considerations without a stance", () => {
    const nvdaCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "single-asset-nvda-recommendation",
    );
    if (!nvdaCase) throw new Error("missing single-asset nvda eval case");

    const result = scoreProductEvalCase(
      nvdaCase,
      makeTrace({
        classification: {
          ...makeTrace().classification,
          workflow: "general_finance_qa",
          entities: { symbols: ["NVDA"] },
        },
        toolCalls: [{ name: "get_stock_quote", args: { symbol: "NVDA" } }],
        text: "NVDA has many considerations. Your decision depends on your goals, risk tolerance, and time horizon, so weigh the evidence carefully.",
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

  it("accepts ticker-weight portfolio tables and a stated multi-year income horizon", () => {
    const portfolioCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "portfolio-income-conservative",
    );
    if (!portfolioCase) throw new Error("missing income portfolio eval case");

    const result = scoreProductEvalCase(
      portfolioCase,
      makeTrace({
        classification: { ...makeTrace().classification, workflow: "portfolio_builder" },
        toolCalls: [{ name: "get_stock_quote", args: { symbol: "BND" } }],
        text:
          "This allocation is designed for a five-year conservative income objective with capital preservation and yield stability.\n\n" +
          "| Ticker | Weight | Amount | Role |\n" +
          "| BND | 60% | $60,000 | Core income |\n" +
          "| VIG | 40% | $40,000 | Dividend growth |\n" +
          "Risks include duration losses and equity drawdowns.",
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

  it("recognizes source-gap impact and macro offset language as risk framing", () => {
    const sentimentCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "sentiment-market-ai-stocks",
    );
    const macroCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "macro-rates-growth-stocks",
    );
    if (!sentimentCase || !macroCase) throw new Error("missing eval case");

    const sentiment = scoreProductEvalCase(
      sentimentCase,
      makeTrace({
        toolCalls: [{ name: "get_sentiment_summary", args: { query: "AI stocks" } }],
        text: "Sentiment is bullish, but Twitter is unavailable. This missing-source gap could impact the overall signal.",
      }),
    );
    const macro = scoreProductEvalCase(
      macroCase,
      makeTrace({
        text: "Falling rates can support growth valuations. Common traps include ignoring a recession, which can offset the valuation benefit as earnings decline.",
      }),
    );

    expect(sentiment.dimensions.find((dimension) => dimension.id === "risk_framing")?.passed).toBe(
      true,
    );
    expect(macro.dimensions.find((dimension) => dimension.id === "risk_framing")?.passed).toBe(
      true,
    );
  });

  it("accepts the full saved sentiment answer's noisy/incomplete-evidence caveat as risk framing", () => {
    const sentimentCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "sentiment-market-ai-stocks",
    );
    if (!sentimentCase) throw new Error("missing sentiment eval case");

    const result = scoreProductEvalCase(
      sentimentCase,
      makeTrace({
        toolCalls: [{ name: "get_sentiment_summary", args: { query: "AI stocks" } }],
        // Verbatim 2026-09-25 live answer preserved in
        // validation-output/sentiment-failed-answer.txt. risk_framing previously
        // failed on the generic keyword pattern alone even though the answer
        // names source/coverage uncertainty.
        text:
          '**Sentiment for "AI stocks" is currently Leaning Bullish (+0.07) based on an aggregate of Twitter, Reddit, and Web/News sentiment from the last 24 hours.**\n\n' +
          "**Detailed Breakdown:**\n\n" +
          "*   **Twitter:** +0.07 (Leaning Bullish) from 40 records\n" +
          "*   **Reddit:** +0.07 (Leaning Bullish) from 95 records\n" +
          "*   **Web/News:** +0.25 (Leaning Bullish) from 4 records\n\n" +
          "The overall confidence in this aggregate sentiment is high (0.71), though many records were neutral or lacked keyword sentiment evidence.\n\n" +
          "**Key Drivers:**\n\n" +
          '*   **Positive:** Terms like "buy," "long," and "calls" were frequently associated with bullish sentiment.\n' +
          '*   **Negative:** Terms such as "sell," "short," and "bubble" contributed to bearish sentiment.\n' +
          "*   **Mixed:** A significant portion of the evidence showed offsetting bullish and bearish signals.\n\n" +
          "**Data gaps:**\n" +
          'The sentiment summary incorporates data from Twitter, Reddit, and general web/news sources, which are the primary sentiment data sources available through OpenCandle\'s tools. There are no other distinct, actively missing sentiment tools that could contribute to this specific "AI stocks" query. However, sentiment data can be noisy, and while these sources provide a good overview, they may not capture the entirety of market sentiment or less prominent discussions.',
      }),
    );

    expect(result.dimensions.find((dimension) => dimension.id === "risk_framing")?.passed).toBe(
      true,
    );
    expect(result.dimensions.every((dimension) => dimension.passed)).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("accepts independently worded noisy sentiment coverage caveats as risk framing", () => {
    const sentimentCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "sentiment-market-ai-stocks",
    );
    if (!sentimentCase) throw new Error("missing sentiment eval case");

    const result = scoreProductEvalCase(
      sentimentCase,
      makeTrace({
        toolCalls: [{ name: "get_sentiment_summary", args: { query: "AI stocks" } }],
        text: "Sentiment sources are noisy and may not fully reflect the broader market.",
      }),
    );

    expect(result.dimensions.find((dimension) => dimension.id === "risk_framing")?.passed).toBe(
      true,
    );
  });

  it("still fails sentiment answers that lack a coverage caveat or any risk framing", () => {
    const sentimentCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "sentiment-market-ai-stocks",
    );
    if (!sentimentCase) throw new Error("missing sentiment eval case");

    const plainBullish = scoreProductEvalCase(
      sentimentCase,
      makeTrace({
        toolCalls: [{ name: "get_sentiment_summary", args: { query: "AI stocks" } }],
        text: "Sentiment for AI stocks is leaning bullish across Twitter and Reddit.",
      }),
    );
    const neutralNoise = scoreProductEvalCase(
      sentimentCase,
      makeTrace({
        toolCalls: [{ name: "get_sentiment_summary", args: { query: "AI stocks" } }],
        text: "Sentiment is neutral; the market noise is unrelated to this question.",
      }),
    );
    const steadyPositive = scoreProductEvalCase(
      sentimentCase,
      makeTrace({
        toolCalls: [{ name: "get_sentiment_summary", args: { query: "AI stocks" } }],
        text: "Sentiment for AI stocks is mildly positive, with steady discussion volume.",
      }),
    );
    // Affirmative complete-coverage phrasing: "noisy" alone plus a coverage noun
    // must not count without an explicit negative coverage verb.
    const noisyCompleteCoverage = scoreProductEvalCase(
      sentimentCase,
      makeTrace({
        toolCalls: [{ name: "get_sentiment_summary", args: { query: "AI stocks" } }],
        text: "Sentiment data is noisy but captures the full picture.",
      }),
    );

    for (const result of [plainBullish, neutralNoise, steadyPositive, noisyCompleteCoverage]) {
      expect(result.dimensions.find((dimension) => dimension.id === "risk_framing")?.passed).toBe(
        false,
      );
      expect(result.passed).toBe(false);
    }
  });

  it("accepts the full saved source-divergence answer's missing-source gap explanation", () => {
    const sentimentCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "sentiment-market-ai-stocks",
    );
    if (!sentimentCase) throw new Error("missing sentiment eval case");

    const result = scoreProductEvalCase(
      sentimentCase,
      makeTrace({
        toolCalls: [{ name: "get_sentiment_summary", args: { query: "AI stocks" } }],
        // Verbatim live answer preserved in
        // validation-output/sentiment-source-divergence.txt.
        text:
          'Sentiment around "AI stocks" is currently **Leaning Bullish** with an aggregate score of +0.07 based on 103 records from Reddit and Web/News over the last 24 hours.\n\n' +
          "**Key Drivers:**\n" +
          '*   **Positive:** "buy", "long", "calls"\n' +
          '*   **Negative:** "sell", "short", "bubble"\n\n' +
          "**Missing Sources:**\n" +
          "*   **Twitter:** Twitter sentiment is unavailable due to a Twitter API error (HTTP 404). This is a significant data gap as Twitter can provide real-time public sentiment that may differ from other sources.\n\n" +
          "**Data gaps**:\n" +
          "*   Twitter: Twitter sentiment unavailable (Twitter API error (HTTP 404): Twitter API error 404: ).",
      }),
    );

    expect(result.dimensions.find((dimension) => dimension.id === "risk_framing")?.passed).toBe(
      true,
    );
    expect(result.dimensions.every((dimension) => dimension.passed)).toBe(true);
    expect(result.passed).toBe(true);
  });

  it("accepts an independent missing-source divergence explanation as risk framing", () => {
    const sentimentCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "sentiment-market-ai-stocks",
    );
    if (!sentimentCase) throw new Error("missing sentiment eval case");

    const result = scoreProductEvalCase(
      sentimentCase,
      makeTrace({
        toolCalls: [{ name: "get_sentiment_summary", args: { query: "AI stocks" } }],
        text: "Reddit is unavailable, and its sentiment may diverge from the available sources.",
      }),
    );

    expect(result.dimensions.find((dimension) => dimension.id === "risk_framing")?.passed).toBe(
      true,
    );
  });

  it("still fails a bare missing-source note and a fully covered bullish answer", () => {
    const sentimentCase = PRODUCT_EVAL_CASES.find(
      (evalCase) => evalCase.id === "sentiment-market-ai-stocks",
    );
    if (!sentimentCase) throw new Error("missing sentiment eval case");

    const missingOnly = scoreProductEvalCase(
      sentimentCase,
      makeTrace({
        toolCalls: [{ name: "get_sentiment_summary", args: { query: "AI stocks" } }],
        text: "Twitter sentiment is unavailable right now.",
      }),
    );
    const allCovered = scoreProductEvalCase(
      sentimentCase,
      makeTrace({
        toolCalls: [{ name: "get_sentiment_summary", args: { query: "AI stocks" } }],
        text: "All sources returned data; sentiment for AI stocks is bullish.",
      }),
    );
    // An unrelated "may differ from other …" clause must not be read as a
    // sentiment source-divergence explanation.
    const unrelatedDifference = scoreProductEvalCase(
      sentimentCase,
      makeTrace({
        toolCalls: [{ name: "get_sentiment_summary", args: { query: "AI stocks" } }],
        text: "Twitter is unavailable. Shipping times may differ from other estimates.",
      }),
    );

    for (const result of [missingOnly, allCovered, unrelatedDifference]) {
      expect(result.dimensions.find((dimension) => dimension.id === "risk_framing")?.passed).toBe(
        false,
      );
      expect(result.passed).toBe(false);
    }
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

  it("passes only an internally consistent product eval report with completed cases", () => {
    const valid = reportFixture({
      results: [
        caseResult({ id: "case-a", passed: true, mandatoryFailure: false }),
        caseResult({ id: "case-b", passed: true, mandatoryFailure: false }),
      ],
      caseCount: 2,
      passed: 2,
      failed: 0,
    });

    expect(productEvalExitCode(valid)).toBe(0);
  });

  it("fails a product eval report with a nonzero failed count", () => {
    const invalid = reportFixture({
      results: [
        caseResult({ id: "case-a", passed: true, mandatoryFailure: false }),
        caseResult({ id: "case-b", passed: false, mandatoryFailure: false }),
      ],
      caseCount: 2,
      passed: 1,
      failed: 1,
    });

    expect(productEvalExitCode(invalid)).toBe(1);
  });

  it("fails an empty product eval report instead of reading zero failures as success", () => {
    const invalid = reportFixture({ results: [], caseCount: 0, passed: 0, failed: 0 });

    expect(productEvalExitCode(invalid)).toBe(1);
  });

  it("fails a report whose failed count hides a failed result", () => {
    const invalid = reportFixture({
      results: [
        caseResult({ id: "case-a", passed: false, mandatoryFailure: false }),
        caseResult({ id: "case-b", passed: true, mandatoryFailure: false }),
      ],
      caseCount: 2,
      passed: 2,
      failed: 0,
    });

    expect(productEvalExitCode(invalid)).toBe(1);
  });

  it("fails a report whose counts are inconsistent with its results", () => {
    const results = [
      caseResult({ id: "case-a", passed: true, mandatoryFailure: false }),
      caseResult({ id: "case-b", passed: true, mandatoryFailure: false }),
    ];

    expect(
      productEvalExitCode(reportFixture({ results, caseCount: 3, passed: 2, failed: 0 })),
    ).toBe(1);
    expect(
      productEvalExitCode(reportFixture({ results, caseCount: 2, passed: 1, failed: 0 })),
    ).toBe(1);
    expect(
      productEvalExitCode(reportFixture({ results, caseCount: 2, passed: 2, failed: 1 })),
    ).toBe(1);
  });

  it("fails a report with a result that has no completed pass/fail outcome", () => {
    const invalid = reportFixture({
      results: [
        caseResult({ id: "case-a", passed: true, mandatoryFailure: false }),
        caseResult({ id: "case-b", passed: undefined, mandatoryFailure: false }),
      ],
      caseCount: 2,
      passed: 2,
      failed: 0,
    });

    expect(productEvalExitCode(invalid)).toBe(1);
  });

  it("fails a report with an empty or whitespace-only result id", () => {
    const invalid = reportFixture({
      results: [
        caseResult({ id: "case-a", passed: true, mandatoryFailure: false }),
        caseResult({ id: "   ", passed: true, mandatoryFailure: false }),
      ],
      caseCount: 2,
      passed: 2,
      failed: 0,
    });

    expect(productEvalExitCode(invalid)).toBe(1);
  });

  it("fails a report with duplicate result ids", () => {
    const invalid = reportFixture({
      results: [
        caseResult({ id: "case-a", passed: true, mandatoryFailure: false }),
        caseResult({ id: "case-a", passed: true, mandatoryFailure: false }),
      ],
      caseCount: 2,
      passed: 2,
      failed: 0,
    });

    expect(productEvalExitCode(invalid)).toBe(1);
  });

  it("fails a mandatory dimension failure even when the passed flag is incorrectly true", () => {
    const invalid = reportFixture({
      results: [caseResult({ id: "case-a", passed: true, mandatoryFailure: true })],
      caseCount: 1,
      passed: 1,
      failed: 0,
    });

    expect(productEvalExitCode(invalid)).toBe(1);
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
